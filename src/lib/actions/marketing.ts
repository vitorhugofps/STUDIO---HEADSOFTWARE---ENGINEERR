'use server';

import { revalidatePath } from 'next/cache';
import { db, logActivity } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateJSON, generateText } from '@/lib/ai/claude';
import { PROMPTS, STUDIO_SYSTEM, clientBrief } from '@/lib/ai/prompts';
import { getSecret, readConfig } from '@/lib/config';
import { addDays, brl, brlCents, fmtDate, monthLabel, num, sum, token as makeToken, todayISO } from '@/lib/utils';
import type { BrandKit, Campaign, Client, ContentItem, DB, VideoProject } from '@/lib/db/types';

/* ------------------------------------------------------------------ */
/* Helpers internos (não exportados: arquivos 'use server' só exportam actions) */
/* ------------------------------------------------------------------ */

const fail = (error: string) => ({ ok: false as const, error });

function obj(v: unknown): Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
}
function arr<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v);
}
function numOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function normHex(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
  return fallback;
}
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}
function daysIn(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function clientName(c: Client): string {
  return c.company || c.contact_name;
}
function splitList(v: unknown): string[] {
  return String(v || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function isoDay(offset: number): string {
  return addDays(new Date(), offset).toISOString().slice(0, 10);
}

async function latestKit(d: DB, clientId: string): Promise<BrandKit | null> {
  const [kit] = await d.list('brand_kits', { where: { client_id: clientId }, orderBy: 'version', desc: true, limit: 1 });
  return kit || null;
}

async function briefFor(d: DB, client: Client, withKit = true) {
  const [ctx] = await d.list('client_contexts', { where: { client_id: client.id }, orderBy: 'version', desc: true, limit: 1 });
  const kit = withKit ? await latestKit(d, client.id) : null;
  return { brief: clientBrief(client, ctx || null, null, kit), ctx: ctx || null, kit };
}

/** Soma as métricas diárias das campanhas do cliente nos últimos `days` dias. */
async function aggregateMetrics(d: DB, clientId: string, days: number) {
  const campaigns = await d.list('campaigns', { where: { client_id: clientId } });
  const ids = campaigns.map((c) => c.id);
  const since = isoDay(-(days - 1));
  const rows = ids.length ? (await d.list('campaign_metrics_daily', { where: { campaign_id: ids }, orderBy: 'day' })).filter((m) => m.day >= since) : [];
  const spend = sum(rows, (m) => m.spend);
  const reach = sum(rows, (m) => m.reach);
  const impressions = sum(rows, (m) => m.impressions);
  const clicks = sum(rows, (m) => m.clicks);
  const results = sum(rows, (m) => m.results);
  const perCampaign = campaigns
    .map((c) => {
      const r = rows.filter((m) => m.campaign_id === c.id);
      const s = sum(r, (m) => m.spend);
      const res = sum(r, (m) => m.results);
      return { nome: c.name, status: c.status, gasto: Math.round(s), resultados: res, custo_por_resultado: res ? Number((s / res).toFixed(2)) : null };
    })
    .filter((c) => c.gasto > 0 || c.resultados > 0);
  return {
    campaigns,
    rows,
    spend,
    reach,
    impressions,
    clicks,
    results,
    costPerResult: results ? spend / results : 0,
    perCampaign,
  };
}

/* ------------------------------------------------------------------ */
/* CAMPANHA · insights                                                 */
/* ------------------------------------------------------------------ */

type Insight = { achado: string; evidencia: string; acao: string; modulo: string };

function insightsExample(data: Record<string, any>): { insights: Insight[] } {
  const cost = Number(data.custo_por_resultado_brl || 0);
  const spend = Number(data.investimento_brl || 0);
  const results = Number(data.resultados || 0);
  const posts = obj(data.conteudo);
  const vids = obj(data.videos);
  return {
    insights: [
      {
        achado: results
          ? `Cada resultado custou ${brlCents(cost)} nos últimos 30 dias. Esse é o número para proteger antes de aumentar verba.`
          : 'Ainda não há resultado medido nas campanhas dos últimos 30 dias.',
        evidencia: results ? `${brl(spend)} investidos para ${num(results)} resultados` : 'resultados: 0 no período',
        acao: results ? 'Fixe esse custo como teto, pause o criativo mais caro da semana e leve a verba para o mais barato.' : 'Conecte a conta de anúncios e confira o pixel antes de subir a primeira campanha.',
        modulo: 'trafego',
      },
      {
        achado: `${num(posts.aprovadas || 0)} de ${num(posts.total || 0)} peças do mês estão aprovadas. O que está parado em rascunho não gera alcance.`,
        evidencia: `${num(posts.aprovadas || 0)} aprovadas, ${num(posts.em_aprovacao || 0)} em aprovação, ${num(posts.rascunho || 0)} em rascunho`,
        acao: 'Envie o lote para aprovação hoje e feche as pendências do cliente em até 48 horas.',
        modulo: 'feed',
      },
      {
        achado: `${num(vids.total || 0)} vídeos estão no pipeline. Reel que sai do roteiro sem material bruto trava na edição.`,
        evidencia: `${num(vids.edicao || 0)} em edição, ${num(vids.roteiro || 0)} em roteiro, ${num(vids.entregue || 0)} entregues`,
        acao: 'Suba o material bruto de cada roteiro no mesmo dia da captação e envie o Reel pronto para a fila do Yuri.',
        modulo: 'videos',
      },
    ],
  };
}

export async function generateInsightsAction(clientId: string) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const client = await d.get('clients', clientId);
  if (!client) return fail('Cliente não encontrado.');

  const agg = await aggregateMetrics(d, clientId, 30);
  const [items, videos] = await Promise.all([d.list('content_items', { where: { client_id: clientId } }), d.list('video_projects', { where: { client_id: clientId } })]);
  const count = <T extends { status: string }>(list: T[], s: string) => list.filter((x) => x.status === s).length;
  const data = {
    periodo: 'últimos 30 dias',
    investimento_brl: Math.round(agg.spend),
    alcance: agg.reach,
    cliques: agg.clicks,
    resultados: agg.results,
    custo_por_resultado_brl: Number(agg.costPerResult.toFixed(2)),
    campanhas: agg.perCampaign,
    conteudo: {
      total: items.length,
      aprovadas: items.filter((i) => ['aprovado', 'agendado', 'publicado'].includes(i.status)).length,
      em_aprovacao: count(items, 'em_aprovacao'),
      rascunho: count(items, 'rascunho'),
    },
    videos: { total: videos.length, roteiro: count(videos, 'roteiro'), edicao: count(videos, 'edicao'), entregue: count(videos, 'entregue') },
  };

  const example = insightsExample(data);
  const r = await generateJSON<{ insights: Insight[] }>({
    agent: 'Marketing · Insights',
    tier: 'copy',
    system: STUDIO_SYSTEM,
    user: PROMPTS.insights(clientName(client), data),
    example,
    db: d,
    clientId,
    maxTokens: 1800,
  });
  const insights = arr<Insight>(r.data?.insights).length ? arr<Insight>(r.data.insights) : example.insights;
  const row = await d.insert('research_reports', {
    client_id: clientId,
    kind: 'insights',
    title: `Insights · ${clientName(client)} · ${fmtDate(new Date())}`,
    findings: { insights, is_example: r.isExample, generated_at: new Date().toISOString() },
    sources: [],
  } as any);
  await logActivity(d, { actor_id: user.id, actor_name: 'Agente de Marketing', action: `gerou insights de ${clientName(client)}${r.isExample ? ' (exemplo)' : ''}`, entity: 'research_reports', entity_id: row.id });
  revalidatePath('/marketing');
  return { ok: true as const, id: row.id, isExample: r.isExample };
}

/* ------------------------------------------------------------------ */
/* BRAND                                                               */
/* ------------------------------------------------------------------ */

type BrandMode = BrandKit['mode'];
const BRAND_MODES: BrandMode[] = ['zero', 'rebranding', 'refresh', 'importado'];
const STEP_FIELD: Record<number, 'diagnosis' | 'strategy' | 'verbal' | 'visual' | 'applications'> = { 1: 'diagnosis', 2: 'strategy', 3: 'verbal', 4: 'visual', 5: 'applications' };

/** Editar um kit aprovado volta a versão para rascunho e abre a versão seguinte. */
function touch(kit: BrandKit, patch: Record<string, unknown>) {
  if (kit.status === 'aprovado') return { ...patch, status: 'rascunho', version: kit.version + 1, approved_at: null };
  return patch;
}

function applyLocks(section: string, old: Record<string, any>, next: Record<string, any>, locked: string[]) {
  const out = { ...next };
  for (const key of locked) {
    if (!key.startsWith(section + '.')) continue;
    const k = key.slice(section.length + 1);
    if (k in old) out[k] = old[k];
  }
  return out;
}

function tokensFromDirection(dir: Record<string, any>, fallbackAccent: string) {
  const p = obj(dir.paleta);
  const t = obj(dir.tipografia);
  const dark = normHex(p.neutra_escura, '#0a0a0a');
  const light = normHex(p.neutra_clara, '#f5f5f3');
  return {
    bg: dark,
    surface: mixHex(dark, light, 0.08),
    text: light,
    text2: mixHex(light, dark, 0.38),
    accent: normHex(p.destaque, fallbackAccent),
    accent2: normHex(p.secundaria, normHex(p.primaria, fallbackAccent)),
    primary: normHex(p.primaria, fallbackAccent),
    font_display: str(t.display, 'Barlow Condensed'),
    font_text: str(t.texto, 'Instrument Sans'),
    radius: '14px',
    spacing: '4/8',
  };
}

function brandExample(step: number, client: Client, kit: BrandKit): Record<string, any> {
  const name = clientName(client);
  const segment = (client.segment || 'negócio local').toLowerCase();
  const city = client.city || 'sua cidade';
  const accent = normHex(client.brand_color, '#ff5b1f');
  switch (step) {
    case 1:
      return {
        percepcao_atual: `${name} é lembrada como ${segment} de ${city}, mas ainda sem uma ideia central que a separe de quem faz o mesmo.`,
        pontos_fortes: ['Relacionamento direto com o público local', 'Material real de set, palco ou atendimento para usar', 'Nome já conhecido na cidade'],
        incoerencias: ['Cada rede fala de um jeito', 'Logo, cores e fontes mudam de peça para peça', 'A promessa do site não aparece no Instagram'],
        territorios_concorrentes: ['Preço baixo', 'Tradição genérica', 'Foto de banco de imagem'],
        oportunidades: ['Ocupar o território de prova real: bastidor, número e cliente', 'Fixar três cores e duas fontes', 'Criar uma assinatura curta e repetível'],
      };
    case 2:
      return {
        proposito: `Fazer ${name} ser escolhida porque o público a vê fazendo, não porque ela diz que faz.`,
        posicionamento: `${name}: ${segment} com prova à vista.`,
        proposta_valor: 'Entrega combinada, processo visível e acompanhamento do início ao fim.',
        publico: `Quem decide a contratação em ${city} e compara três opções antes de chamar.`,
        personas: [
          { nome: 'Decisor prático', dor: 'Já foi mal atendido e não quer repetir', desejo: 'Prazo claro e alguém que responde' },
          { nome: 'Indicador', dor: 'Teme indicar e se queimar', desejo: 'Algo que possa mostrar sem explicar' },
        ],
        arquetipo: 'Criador com mão na massa',
        pilares: ['Prova real', 'Processo visível', 'Prazo cumprido', 'Voz próxima'],
        contraponto: 'Contra a promessa sem prova e o discurso genérico do setor.',
        assinatura: 'Feito à vista.',
        linha_campanha: 'Veja como é feito.',
        alternativas: {
          posicionamento: [`${name}: ${segment} com prova à vista.`, `${name}: o que a gente promete, você confere.`, `${name}: processo aberto, resultado medido.`],
          assinatura: ['Feito à vista.', 'Prova antes de promessa.', 'Do ponto ao resultado.'],
        },
      };
    case 3:
      return {
        tom: { formal_proximo: 70, serio_divertido: 35, tecnico_simples: 70, contido_ousado: 55 },
        descricao_tom: 'Próximo, direto e seguro. Frases curtas, uma ideia por frase, número no lugar do adjetivo.',
        vocabulario_proprio: ['à vista', 'prova', 'prazo', 'passo a passo'],
        proibidos: ['melhor', 'incrível', 'top', 'experiência única', 'alavancar'],
        bordoes: ['Veja como é feito.', 'Combinado e cumprido.'],
        ctas: { venda: 'Chame no WhatsApp', salvar: 'Salve para consultar depois', envio: 'Envie para quem precisa', palavra_chave: 'Comente QUERO' },
        fala_assim: ['Entrego dia 12. Se atrasar, aviso antes.', 'São 3 etapas. A primeira começa amanhã.'],
        nao_fala_assim: ['Somos referência em excelência.', 'Uma experiência única para você.'],
      };
    case 4:
      return {
        direcoes: [
          {
            nome: 'Palco',
            conceito: 'Contraste alto, luz de set e uma cor de ação. Parece bastidor, não folheto.',
            paleta: { primaria: accent, secundaria: mixHex(accent, '#000000', 0.35), neutra_escura: '#0a0a0a', neutra_clara: '#f5f5f3', destaque: accent, proporcao: '60/20/15/5' },
            tipografia: { display: 'Barlow Condensed', texto: 'Instrument Sans', licenca: 'Google Fonts, uso livre' },
            grafismo: 'Barra grossa de cor no topo e numeração de cena nos cantos.',
            fotografia: 'Luz lateral dura, fundo escuro, rosto em primeiro plano.',
            motion: 'Corte seco com texto entrando em duas batidas.',
            logo: { tipo: 'logotipo', conceito: 'Nome em caixa alta condensada com barra de cor', versoes: ['horizontal', 'vertical', 'símbolo', 'mono'] },
            exemplo_post: { headline: 'Veja como é feito', apoio: `Bastidor de ${name}` },
          },
          {
            nome: 'Editorial',
            conceito: 'Fundo claro, tipografia grande e muito respiro. Lê como revista.',
            paleta: { primaria: '#1b1b1b', secundaria: '#8a8a85', neutra_escura: '#141414', neutra_clara: '#f4f1ea', destaque: accent, proporcao: '60/25/10/5' },
            tipografia: { display: 'Fraunces', texto: 'DM Sans', licenca: 'Google Fonts, uso livre' },
            grafismo: 'Filete fino e legenda numerada em cada peça.',
            fotografia: 'Luz natural, enquadramento fechado, cor neutra.',
            motion: 'Fade lento com texto em linha única.',
            logo: { tipo: 'monograma', conceito: 'Iniciais em serifa com ponto de cor', versoes: ['horizontal', 'vertical', 'símbolo', 'mono'] },
            exemplo_post: { headline: 'Processo aberto', apoio: 'Três etapas, uma data' },
          },
          {
            nome: 'Mineral',
            conceito: 'Cores terrosas e formas simples. Passa solidez sem parecer frio.',
            paleta: { primaria: '#2f4a3c', secundaria: '#b88a4a', neutra_escura: '#101512', neutra_clara: '#efeadf', destaque: '#d9a441', proporcao: '55/25/15/5' },
            tipografia: { display: 'Bricolage Grotesque', texto: 'Inter', licenca: 'Google Fonts, uso livre' },
            grafismo: 'Círculo recortado e textura de papel leve.',
            fotografia: 'Tons quentes, profundidade rasa, mãos em ação.',
            motion: 'Deslize curto com easing suave.',
            logo: { tipo: 'símbolo', conceito: 'Forma geométrica ligada à inicial', versoes: ['horizontal', 'vertical', 'símbolo', 'mono'] },
            exemplo_post: { headline: 'Prazo é promessa', apoio: 'Combinado e cumprido' },
          },
        ],
      };
    case 5:
      return {
        aplicacoes: [
          { peca: 'post 4:5', descricao: 'Capa com gancho em até 12 palavras e barra de cor no topo.', texto_exemplo: 'Veja como é feito.' },
          { peca: 'carrossel', descricao: 'Capa, três cards e card final só com a chamada.', texto_exemplo: 'Card 2 funciona sozinho.' },
          { peca: 'story', descricao: 'Texto grande no centro e botão de ação na base.', texto_exemplo: 'Última semana.' },
          { peca: 'capa de Reel', descricao: 'Rosto em primeiro plano e título em duas linhas.', texto_exemplo: 'Antes e depois, sem filtro.' },
          { peca: 'assinatura de e-mail', descricao: 'Nome, cargo, WhatsApp e a assinatura da marca.', texto_exemplo: name },
          { peca: 'proposta', descricao: 'Capa escura, páginas claras e números em destaque.', texto_exemplo: 'Proposta para ' + name },
        ],
        regras_uso: ['Máximo de duas fontes por peça', 'Cor de destaque em um elemento por vez', 'Logo sempre sobre fundo com contraste mínimo de 4,5 para 1'],
      };
    default: {
      const dirs = arr(obj(kit.visual).direcoes);
      const chosen = obj(dirs[Number(obj(kit.visual).escolhida)] ?? dirs[0]);
      const tokens = Object.keys(chosen).length ? tokensFromDirection(chosen, accent) : { bg: '#0a0a0a', surface: '#171717', text: '#f5f5f3', text2: '#a3a3a0', accent, accent2: mixHex(accent, '#000000', 0.35), font_display: 'Barlow Condensed', font_text: 'Instrument Sans', radius: '14px', spacing: '4/8' };
      return {
        capitulos: [
          { titulo: 'Quem somos', conteudo: `${name} é ${segment} em ${city}. O propósito e o posicionamento definidos nas etapas anteriores orientam todas as peças.` },
          { titulo: 'Como falamos', conteudo: 'Frases curtas, uma ideia por frase e número no lugar do adjetivo. O vocabulário proibido fica na lista da etapa verbal.' },
          { titulo: 'Cores', conteudo: 'Duas neutras e uma de destaque. A cor de destaque aparece em um elemento por vez, nunca em mais de 15% da peça.' },
          { titulo: 'Tipografia', conteudo: 'Uma fonte para títulos e outra para texto corrido. Títulos em caixa alta quando a direção visual pedir.' },
          { titulo: 'Fotografia e vídeo', conteudo: 'Material real acima de gerado. Luz e enquadramento seguem a direção escolhida.' },
          { titulo: 'Aplicações', conteudo: 'Post 4:5, carrossel, story, capa de Reel e documentos seguem as regras da etapa 5.' },
        ],
        tokens,
        skill_md: `# Marca ${name}\n\nUse os tokens do BrandKit.\n- Fundo: ${tokens.bg}\n- Texto: ${tokens.text}\n- Destaque: ${tokens.accent}\n- Fontes: ${tokens.font_display} e ${tokens.font_text}\n\nRegras:\n- Frases curtas, sem vocabulário proibido.\n- Um elemento de destaque por peça.\n- Material real acima de gerado.`,
      };
    }
  }
}

export async function createBrandKitAction(clientId: string, mode: BrandMode) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  if (!BRAND_MODES.includes(mode)) return fail('Modo inválido.');
  const d = await db();
  const client = await d.get('clients', clientId);
  if (!client) return fail('Cliente não encontrado.');
  const last = await latestKit(d, clientId);
  const kit = await d.insert('brand_kits', { client_id: clientId, mode, version: (last?.version || 0) + 1, step: 1, status: 'rascunho', locked_fields: [] } as any);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `iniciou o BrandKit v${kit.version} de ${clientName(client)} (${mode})`, entity: 'brand_kits', entity_id: kit.id });
  revalidatePath('/marketing/brand');
  revalidatePath('/marketing');
  return { ok: true as const, id: kit.id };
}

export async function setBrandModeAction(kitId: string, mode: BrandMode) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  if (!BRAND_MODES.includes(mode)) return fail('Modo inválido.');
  const d = await db();
  const kit = await d.get('brand_kits', kitId);
  if (!kit) return fail('BrandKit não encontrado.');
  await d.update('brand_kits', kitId, { mode } as any);
  revalidatePath('/marketing/brand');
  return { ok: true as const };
}

export async function generateBrandStepAction(kitId: string, step: number) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  if (!Number.isInteger(step) || step < 1 || step > 6) return fail('Etapa inválida.');
  const d = await db();
  const kit = await d.get('brand_kits', kitId);
  if (!kit) return fail('BrandKit não encontrado.');
  const client = await d.get('clients', kit.client_id);
  if (!client) return fail('Cliente não encontrado.');
  const [ctx] = await d.list('client_contexts', { where: { client_id: client.id }, orderBy: 'version', desc: true, limit: 1 });
  const locked = arr<string>(kit.locked_fields);

  const upTo = (n: number) => {
    const o: Record<string, unknown> = { modo: kit.mode, travados: locked };
    const fields = ['diagnosis', 'strategy', 'verbal', 'visual'] as const;
    fields.slice(0, Math.max(0, n - 1)).forEach((f) => {
      if (kit[f]) o[f] = kit[f];
    });
    if (n === 6 && kit.applications) o.applications = { ...obj(kit.applications), manual: undefined };
    if (kit.tokens) o.tokens = kit.tokens;
    return JSON.stringify(o).slice(0, 9000);
  };

  const example = brandExample(step, client, kit);
  const r = await generateJSON<Record<string, any>>({
    agent: `Brand · Etapa ${step}`,
    tier: 'strategy',
    system: STUDIO_SYSTEM,
    user: PROMPTS.brandStep(step, clientBrief(client, ctx || null, null, null), upTo(step)),
    example,
    db: d,
    clientId: client.id,
    maxTokens: step === 4 || step === 6 ? 5000 : 3200,
  });
  const data = obj(r.data);
  const flag = r.isExample ? { _example: true } : {};
  const nextStep = Math.min(6, Math.max(kit.step || 1, step + 1));
  let patch: Record<string, unknown>;

  if (step === 6) {
    const tokens = applyLocks('tokens', obj(kit.tokens), { ...obj(example.tokens), ...obj(data.tokens) }, locked);
    const apps = obj(kit.applications);
    patch = {
      tokens,
      applications: { ...apps, manual: { capitulos: arr(data.capitulos).length ? data.capitulos : example.capitulos, skill_md: str(data.skill_md, example.skill_md), ...flag } },
      step: 6,
    };
  } else {
    const field = STEP_FIELD[step];
    const merged = applyLocks(field, obj(kit[field]), { ...data, ...flag }, locked);
    // Etapa 5 preserva o manual já gerado
    if (step === 5 && obj(kit.applications).manual) merged.manual = obj(kit.applications).manual;
    patch = { [field]: merged, step: nextStep };
  }

  await d.update('brand_kits', kitId, touch(kit, patch) as any);
  await logActivity(d, { actor_id: user.id, actor_name: 'Agente de Marca', action: `gerou a etapa ${step} do BrandKit de ${clientName(client)}${r.isExample ? ' (exemplo)' : ''}`, entity: 'brand_kits', entity_id: kitId });
  revalidatePath('/marketing/brand');
  revalidatePath('/marketing');
  return { ok: true as const, step, isExample: r.isExample };
}

export async function chooseDirectionAction(kitId: string, index: number) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const kit = await d.get('brand_kits', kitId);
  if (!kit) return fail('BrandKit não encontrado.');
  const client = await d.get('clients', kit.client_id);
  const dirs = arr(obj(kit.visual).direcoes);
  const dir = dirs[index];
  if (!dir) return fail('Direção não encontrada.');
  const locked = arr<string>(kit.locked_fields);
  const tokens = applyLocks('tokens', obj(kit.tokens), { ...obj(kit.tokens), ...tokensFromDirection(obj(dir), normHex(client?.brand_color, '#ff5b1f')) }, locked);
  await d.update('brand_kits', kitId, touch(kit, { visual: { ...obj(kit.visual), escolhida: index }, tokens, step: Math.max(kit.step || 1, 5) }) as any);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `escolheu a direção "${str(obj(dir).nome, String(index + 1))}" no BrandKit`, entity: 'brand_kits', entity_id: kitId });
  revalidatePath('/marketing/brand');
  revalidatePath('/marketing/feed');
  return { ok: true as const };
}

/** Edição manual dos campos principais. Campos travados são ignorados. */
export async function updateBrandFieldAction(kitId: string, fd: FormData) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const kit = await d.get('brand_kits', kitId);
  if (!kit) return fail('BrandKit não encontrado.');
  const locked = arr<string>(kit.locked_fields);
  const strategy = { ...obj(kit.strategy) };
  const verbal = { ...obj(kit.verbal) };
  const tokens = { ...obj(kit.tokens) };
  const skipped: string[] = [];
  const open = (key: string) => {
    if (locked.includes(key)) {
      skipped.push(key);
      return false;
    }
    return fd.has(key.split('.')[1]);
  };

  if (open('strategy.posicionamento')) strategy.posicionamento = String(fd.get('posicionamento') || '').trim();
  if (open('strategy.assinatura')) strategy.assinatura = String(fd.get('assinatura') || '').trim();
  if (open('verbal.tom')) {
    const tom = String(fd.get('tom') || '').trim();
    verbal.descricao_tom = tom;
    if (typeof verbal.tom === 'string') verbal.tom = tom;
  }
  if (open('verbal.proibidos')) verbal.proibidos = splitList(fd.get('proibidos'));
  for (const k of ['bg', 'surface', 'text', 'accent', 'accent2']) {
    if (open(`tokens.${k}`)) tokens[k] = normHex(fd.get(k), str(tokens[k], '#000000'));
  }
  for (const k of ['font_display', 'font_text']) {
    if (open(`tokens.${k}`)) tokens[k] = String(fd.get(k) || '').trim();
  }

  const patch: Record<string, unknown> = { strategy, verbal, tokens };
  await d.update('brand_kits', kitId, touch(kit, patch) as any);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: 'editou campos do BrandKit', entity: 'brand_kits', entity_id: kitId });
  revalidatePath('/marketing/brand');
  revalidatePath('/marketing/feed');
  return { ok: true as const, skipped };
}

export async function toggleLockAction(kitId: string, field: string) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const kit = await d.get('brand_kits', kitId);
  if (!kit) return fail('BrandKit não encontrado.');
  const locked = arr<string>(kit.locked_fields);
  const next = locked.includes(field) ? locked.filter((f) => f !== field) : [...locked, field];
  await d.update('brand_kits', kitId, { locked_fields: next } as any);
  revalidatePath('/marketing/brand');
  return { ok: true as const, locked: next.includes(field) };
}

export async function setBrandStatusAction(kitId: string, status: BrandKit['status']) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  if (!['rascunho', 'em_aprovacao', 'aprovado'].includes(status)) return fail('Status inválido.');
  const d = await db();
  const kit = await d.get('brand_kits', kitId);
  if (!kit) return fail('BrandKit não encontrado.');
  const client = await d.get('clients', kit.client_id);
  const patch: Record<string, unknown> = { status, approved_at: status === 'aprovado' ? new Date().toISOString() : null };
  await d.update('brand_kits', kitId, patch as any);
  const verb = status === 'aprovado' ? 'aprovou' : status === 'em_aprovacao' ? 'enviou para aprovação' : 'voltou para rascunho';
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `${verb} o BrandKit v${kit.version} de ${client ? clientName(client) : 'cliente'}`, entity: 'brand_kits', entity_id: kitId });
  revalidatePath('/marketing/brand');
  revalidatePath('/marketing');
  return { ok: true as const };
}
