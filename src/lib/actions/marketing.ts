'use server';

import { revalidatePath } from 'next/cache';
import { db, logActivity } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateJSON, generateText } from '@/lib/ai/claude';
import { PROMPTS, STUDIO_SYSTEM, clientBrief } from '@/lib/ai/prompts';
import { STUDIO_DEFAULTS, getSecret, readConfig } from '@/lib/config';
import { addDays, brl, brlCents, fmtDate, num, sum, token as makeToken, todayISO } from '@/lib/utils';
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
/** "2026-10" vira "outubro de 2026" */
function monthLong(key: string): string {
  const [y, m] = String(key).split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(y, (m || 1) - 1, 1));
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

/* ------------------------------------------------------------------ */
/* CRIAÇÃO DE FEED                                                     */
/* ------------------------------------------------------------------ */

type FeedItemRaw = {
  day?: number;
  format?: string;
  series?: string;
  hook?: string;
  headline?: string;
  support?: string;
  cta?: string;
  cards?: string[];
  caption?: string;
  alt_text?: string;
  hashtags?: string[];
  tone?: string;
};
type FeedPlanRaw = { series: { name: string; goal: string; format: string }[]; items: FeedItemRaw[] };

const ITEM_STATUSES: ContentItem['status'][] = ['rascunho', 'revisado', 'em_aprovacao', 'aprovado', 'ajustar', 'agendado', 'publicado'];

function normalizeFormat(f: unknown): ContentItem['format'] {
  const s = str(f).toLowerCase();
  if (s.includes('carross')) return 'carrossel';
  if (s.includes('stor')) return 'story';
  if (s.includes('reel') || s.includes('capa')) return 'capa_reel';
  return 'post_4x5';
}

function feedExample(client: Client): FeedPlanRaw {
  const name = clientName(client);
  const segment = (client.segment || 'seu setor').toLowerCase();
  const wa = 'Chame no WhatsApp';
  const cap = (cena: string, corte: string, chamada: string) => `${cena}\n\n${corte}\n\n${chamada}`;
  return {
    series: [
      { name: 'PROVA', goal: 'Prova: trabalhos reais e prazo cumprido', format: 'Carrossel 4:5' },
      { name: 'BASTIDOR', goal: 'Confiança: set, processo e equipe', format: 'Post 4:5' },
      { name: 'EM 60 SEGUNDOS', goal: 'Educativo: uma dica por peça', format: 'Carrossel 4:5' },
      { name: 'AGENDA', goal: 'Oferta: datas e vagas reais', format: 'Story 9:16' },
    ],
    items: [
      {
        day: 2, format: 'carrossel', series: 'PROVA', hook: 'Três trabalhos entregues antes do prazo', headline: 'Entregue antes do prazo', support: `Três trabalhos recentes de ${name}`, cta: wa, tone: 'escuro',
        cards: ['Trabalho 1: o que foi pedido e o que saiu', 'Trabalho 2: o que mudou depois de pronto', 'Trabalho 3: prazo combinado e dia da entrega'],
        caption: cap(`3 trabalhos entregues antes do prazo combinado, direto do set de ${name}.`, 'Cada card mostra o pedido, o resultado e a data. Sem filtro, sem promessa.', '👉🏻 Toque no link da bio e chame no WhatsApp.'),
        alt_text: `Carrossel de três trabalhos recentes de ${name}, com pedido, resultado e data de entrega.`, hashtags: ['#prova', `#${(client.city || 'brasil').toLowerCase().replace(/\s+/g, '')}`],
      },
      {
        day: 5, format: 'post_4x5', series: 'BASTIDOR', hook: '6h da manhã, o dia começa antes do cliente chegar', headline: 'O dia começa às 6h', support: 'Bastidor real, sem filtro', cta: 'Salve para acompanhar', tone: 'claro', cards: [],
        caption: cap('6h da manhã, antes de abrir: o set já está montado.', 'É nesse horário que o prazo do cliente é decidido, não na hora da entrega.', '👉🏻 Salve este post e acompanhe o bastidor da semana.'),
        alt_text: `Foto de bastidor de ${name} com a equipe montando o set ao amanhecer.`, hashtags: ['#bastidor', '#processo'],
      },
      {
        day: 8, format: 'story', series: 'AGENDA', hook: 'Agenda do mês: [N] datas livres', headline: 'Agenda aberta', support: '[N] datas livres neste mês', cta: 'Toque para reservar', tone: 'escuro', cards: [],
        caption: cap('Agenda do mês aberta: [N] datas livres.', 'Reserva feita pelo WhatsApp, com data e escopo combinados antes.', '👉🏻 Toque e reserve a sua.'),
        alt_text: 'Story com a agenda do mês e o botão para reservar pelo WhatsApp.', hashtags: ['#agenda'],
      },
      {
        day: 11, format: 'carrossel', series: 'EM 60 SEGUNDOS', hook: `3 perguntas antes de contratar ${segment}`, headline: '3 perguntas antes de contratar', support: `Guia rápido para quem procura ${segment}`, cta: 'Salve e consulte depois', tone: 'claro',
        cards: ['Pergunta 1: qual é o prazo e o que acontece se atrasar?', 'Pergunta 2: o que está incluso e o que é cobrado à parte?', 'Pergunta 3: posso ver um trabalho parecido já entregue?'],
        caption: cap(`3 perguntas que evitam dor de cabeça antes de contratar ${segment}.`, 'Prazo, escopo e prova. Se a resposta for vaga, desconfie.', '👉🏻 Salve este guia e envie para quem está comparando orçamentos.'),
        alt_text: 'Carrossel com três perguntas para fazer antes de contratar o serviço.', hashtags: ['#dica', '#guia'],
      },
      {
        day: 14, format: 'post_4x5', series: 'PROVA', hook: 'O pedido do cliente e o que saiu do set', headline: 'Pedido e resultado', support: 'Lado a lado, sem edição de promessa', cta: wa, tone: 'escuro', cards: [],
        caption: cap('O pedido do cliente de um lado, o resultado do outro.', 'Mostramos o antes e o depois porque é o que decide a contratação.', '👉🏻 Toque no link da bio e peça o seu.'),
        alt_text: 'Imagem dividida com o pedido do cliente à esquerda e o resultado entregue à direita.', hashtags: ['#antesedepois', '#prova'],
      },
      {
        day: 17, format: 'carrossel', series: 'BASTIDOR', hook: 'Do briefing à entrega em 4 passos', headline: 'Do briefing à entrega', support: 'O processo, passo a passo', cta: 'Envie para quem precisa', tone: 'claro',
        cards: ['Passo 1: conversa e briefing por escrito', 'Passo 2: roteiro e aprovação', 'Passo 3: produção e entrega no prazo'],
        caption: cap('4 passos entre o primeiro contato e a entrega final.', 'Cada passo tem data e responsável. Você sempre sabe o que vem depois.', '👉🏻 Envie para quem está pensando em contratar.'),
        alt_text: 'Carrossel com os quatro passos do processo, do briefing à entrega.', hashtags: ['#processo', '#passoapasso'],
      },
      {
        day: 21, format: 'story', series: 'EM 60 SEGUNDOS', hook: 'Pergunta do dia: qual prazo você considera justo?', headline: 'Qual prazo é justo?', support: 'Responda na enquete', cta: 'Vote agora', tone: 'claro', cards: [],
        caption: cap('Pergunta do dia: qual prazo você considera justo?', 'As respostas orientam o próximo calendário.', '👉🏻 Vote na enquete do story.'),
        alt_text: 'Story com enquete sobre prazo justo de entrega.', hashtags: [],
      },
      {
        day: 25, format: 'post_4x5', series: 'AGENDA', hook: 'Últimas [N] vagas do mês', headline: 'Últimas vagas do mês', support: 'Reserva até [DATA]', cta: wa, tone: 'escuro', cards: [],
        caption: cap('Últimas [N] vagas do mês, com reserva até [DATA].', 'Depois dessa data, a agenda segue para o mês seguinte.', '👉🏻 Toque no link da bio e garanta a sua vaga.'),
        alt_text: 'Post com o aviso de últimas vagas do mês e a data limite de reserva.', hashtags: ['#vagas'],
      },
    ],
  };
}

function itemText(item: Pick<ContentItem, 'hook' | 'art' | 'caption'>): string {
  const a = obj(item.art);
  return [item.hook, a.headline, a.support, a.cta, ...arr<string>(a.cards), item.caption].filter(Boolean).join('\n');
}

const FORBIDDEN_WORDS = ['alavancar', 'potencializar', 'turbinar', 'sinergia', 'disruptivo', 'viralizar', 'engajamento garantido', 'elevar sua marca', 'melhor', 'top', 'incrível', '360º', 'full service', 'de impacto', 'contar histórias'];

function heuristicChecks(item: ContentItem) {
  const a = obj(item.art);
  const text = itemText(item);
  const low = text.toLowerCase();
  const found = FORBIDDEN_WORDS.filter((w) => new RegExp(`(?<![\\p{L}\\d])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d])`, 'iu').test(low));
  const firstLine = (item.caption || '').split('\n')[0] || '';
  const longCard = arr<string>(a.cards).find((c) => c.trim().split(/\s+/).length > 12);
  const tags = arr<string>(item.hashtags);
  return [
    { label: 'Vocabulário proibido', ok: found.length === 0, detail: found.length ? `Encontrado: ${found.join(', ')}` : 'Nenhuma palavra da lista' },
    { label: 'Sem travessões', ok: !/[—–]/.test(text), detail: /[—–]/.test(text) ? 'Troque travessões por ponto, vírgula ou dois-pontos' : 'Ok' },
    { label: 'Primeira linha até 125 caracteres', ok: !!firstLine && firstLine.length <= 125, detail: `${firstLine.length} caracteres` },
    { label: 'Número ou [N] na primeira linha', ok: /\d|\[N\]/.test(firstLine), detail: /\d|\[N\]/.test(firstLine) ? 'Ok' : 'Inclua um número real na primeira linha' },
    { label: 'Até 3 hashtags', ok: tags.length <= 3, detail: `${tags.length} hashtags` },
    { label: 'Cards com até 12 palavras', ok: !longCard, detail: longCard ? `Longo demais: "${longCard.slice(0, 40)}…"` : 'Ok' },
    { label: 'Chamada definida', ok: !!str(a.cta).trim(), detail: str(a.cta).trim() ? str(a.cta) : 'Falta a chamada da arte' },
    { label: 'Texto alternativo', ok: !!str(item.alt_text).trim(), detail: str(item.alt_text).trim() ? 'Ok' : 'Descreva a imagem para acessibilidade' },
    { label: 'Sem [N] pendente', ok: !/\[(N|DATA)\]/.test(text), detail: /\[(N|DATA)\]/.test(text) ? 'Preencha os dados marcados antes de enviar' : 'Ok' },
  ];
}

export async function createContentPlanAction(fd: FormData) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const clientId = String(fd.get('client_id') || '');
  const month = String(fd.get('month') || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('Informe o mês no formato AAAA-MM.');
  const d = await db();
  const client = await d.get('clients', clientId);
  if (!client) return fail('Cliente não encontrado.');
  const goal = String(fd.get('goal') || '').trim() || 'recorrência e contratação';
  const quantity = Math.min(40, Math.max(1, Math.round(numOr(fd.get('quantity'), 20))));
  const mix = {
    prova: numOr(fd.get('mix_prova'), 30),
    educativo: numOr(fd.get('mix_educativo'), 25),
    bastidor: numOr(fd.get('mix_bastidor'), 20),
    opiniao: numOr(fd.get('mix_opiniao'), 15),
    oferta: numOr(fd.get('mix_oferta'), 10),
  };
  const { brief, kit } = await briefFor(d, client);
  const mixText = Object.entries(mix)
    .map(([k, v]) => `${k} ${v}%`)
    .join(', ');

  const example = feedExample(client);
  const r = await generateJSON<FeedPlanRaw>({
    agent: 'Conteúdo · Plano do mês',
    tier: 'copy',
    system: STUDIO_SYSTEM,
    user: PROMPTS.feedPlan(brief, month, `${goal}. Mix desejado: ${mixText}`, quantity),
    example,
    db: d,
    clientId,
    maxTokens: Math.min(12000, 1500 + quantity * 380),
  });
  const series = arr<{ name: string; goal: string; format: string }>(r.data?.series).length ? arr<{ name: string; goal: string; format: string }>(r.data.series) : example.series;
  const rawItems = arr<FeedItemRaw>(r.data?.items).length ? arr<FeedItemRaw>(r.data.items) : example.items;

  const plan = await d.insert('content_plans', { client_id: clientId, month, goal, mix, series, status: 'rascunho' } as any);
  const maxDay = daysIn(month);
  let created = 0;
  for (let i = 0; i < Math.min(rawItems.length, quantity); i++) {
    const it = rawItems[i];
    const day = Math.min(maxDay, Math.max(1, Math.round(numOr(it.day, i + 1))));
    const tone = str(it.tone).toLowerCase().startsWith('cl') ? 'claro' : str(it.tone).toLowerCase().startsWith('es') ? 'escuro' : i % 2 === 0 ? 'escuro' : 'claro';
    const tags = arr<string>(it.hashtags)
      .map((h) => (h.startsWith('#') ? h : `#${h}`))
      .slice(0, 3);
    await d.insert('content_items', {
      plan_id: plan.id,
      client_id: clientId,
      format: normalizeFormat(it.format),
      series: str(it.series) || null,
      hook: str(it.hook) || str(it.headline) || `Peça ${i + 1}`,
      art: { headline: str(it.headline) || str(it.hook), support: str(it.support), cta: str(it.cta), cards: arr<string>(it.cards).map(String), palette: tone, tone },
      caption: str(it.caption) || null,
      alt_text: str(it.alt_text) || null,
      hashtags: tags,
      scheduled_at: new Date(`${month}-${String(day).padStart(2, '0')}T12:00:00-03:00`).toISOString(),
      status: 'rascunho',
      version: 1,
    } as any);
    created++;
  }
  await logActivity(d, { actor_id: user.id, actor_name: 'Agente de Conteúdo', action: `planejou ${created} peças de ${monthLong(month)} para ${clientName(client)}${r.isExample ? ' (exemplo)' : ''}${kit ? '' : ' sem BrandKit'}`, entity: 'content_plans', entity_id: plan.id });
  revalidatePath('/marketing/feed');
  revalidatePath('/marketing');
  return { ok: true as const, id: plan.id, created, isExample: r.isExample };
}

export async function setItemStatusAction(id: string, status: ContentItem['status']) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  if (!ITEM_STATUSES.includes(status)) return fail('Status inválido.');
  const d = await db();
  const item = await d.get('content_items', id);
  if (!item) return fail('Peça não encontrada.');
  await d.update('content_items', id, { status, version: status === 'ajustar' ? item.version + 1 : item.version } as any);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `marcou a peça "${item.hook.slice(0, 50)}" como ${status.replace('_', ' ')}`, entity: 'content_items', entity_id: id });
  revalidatePath('/marketing/feed');
  revalidatePath('/marketing');
  return { ok: true as const };
}

export async function createApprovalBatchAction(planId: string) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const plan = await d.get('content_plans', planId);
  if (!plan) return fail('Plano não encontrado.');
  const client = await d.get('clients', plan.client_id);
  const items = (await d.list('content_items', { where: { plan_id: planId }, orderBy: 'scheduled_at' })).filter((i) => i.status === 'rascunho' || i.status === 'revisado');
  if (!items.length) return fail('Nenhuma peça em rascunho ou revisada neste plano.');
  const publicToken = makeToken(20);
  const batch = await d.insert('approval_batches', {
    client_id: plan.client_id,
    title: `Feed ${client ? clientName(client) : ''} · ${monthLong(plan.month)}`,
    item_type: 'content',
    item_ids: items.map((i) => i.id),
    public_token: publicToken,
    status: 'aberto',
    expires_at: addDays(new Date(), 7).toISOString(),
  } as any);
  for (const i of items) await d.update('content_items', i.id, { status: 'em_aprovacao' } as any);
  await d.update('content_plans', planId, { status: 'em_aprovacao' } as any);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `enviou ${items.length} peças de ${client ? clientName(client) : 'cliente'} para aprovação`, entity: 'approval_batches', entity_id: batch.id });
  revalidatePath('/marketing/feed');
  revalidatePath('/marketing');
  return { ok: true as const, token: publicToken, path: `/aprovar/${publicToken}`, count: items.length };
}

export async function reviewItemAction(itemId: string) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const item = await d.get('content_items', itemId);
  if (!item) return fail('Peça não encontrada.');
  const client = await d.get('clients', item.client_id);
  const kit = client ? await latestKit(d, client.id) : null;
  const checks = heuristicChecks(item);
  const failed = checks.filter((c) => !c.ok);
  const fallback = failed.length
    ? `Ajustar ${failed.length} ponto(s) antes de enviar:\n${failed.map((c) => `- ${c.label}: ${c.detail}`).join('\n')}`
    : 'Peça dentro do checklist da marca. Pode seguir para aprovação.';
  const verbal = obj(kit?.verbal);
  const r = await generateText({
    agent: 'Conteúdo · Revisão',
    tier: 'copy',
    system: STUDIO_SYSTEM,
    user: `Revise a peça abaixo contra o checklist da marca ${client ? clientName(client) : ''}.
Checklist: vocabulário proibido; sem travessões; primeira linha da legenda com até 125 caracteres, palavra-chave e número; até 3 hashtags; até 12 palavras por card; chamada clara; texto alternativo descritivo; nenhum número inventado.
Proibidos da marca: ${arr<string>(verbal.proibidos).join(', ') || 'seguir a lista do Studio'}.
Tom da marca: ${str(verbal.descricao_tom) || str(verbal.tom) || 'direto e próximo'}.
PEÇA (${item.format}, série ${item.series || '-'}):
${itemText(item)}
Responda em lista curta: OK ou AJUSTAR por item e, se precisar, a legenda corrigida.`,
    fallback,
    db: d,
    clientId: item.client_id,
    maxTokens: 900,
  });
  return { ok: true as const, text: r.data, isExample: r.isExample, checks };
}

/* ------------------------------------------------------------------ */
/* CRIAÇÃO DE VÍDEOS                                                   */
/* ------------------------------------------------------------------ */

type ScriptRaw = {
  title?: string;
  target_duration_s?: number;
  blocks: { t: string; label: string; speech: string; screen?: string; visual?: string }[];
  shot_list?: { block: string; source: string; note: string }[];
  audio?: { trilha?: string; sfx?: string[]; assinatura?: string };
  captacao?: string[];
  hook_variants?: string[];
};

const VIDEO_STATUSES: VideoProject['status'][] = ['rascunho', 'roteiro', 'edicao', 'revisao', 'aprovado', 'entregue'];
const RAW_KINDS = ['video_bruto', 'drive_link', 'referencia'];

function clock(sec: number, long: boolean) {
  if (!long) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function scriptExample(client: Client, vp: VideoProject, rawNames: string[]): ScriptRaw {
  const name = clientName(client);
  const segment = (client.segment || 'o serviço').toLowerCase();
  const dir = obj(vp.direction);
  const total = Math.max(15, Math.round(numOr(vp.target_duration_s, vp.line === 'reels' ? 40 : 180)));
  const long = vp.line === 'horizontal' && total >= 90;
  const cuts = vp.line === 'reels' ? [0, 3, Math.round(total * 0.375), Math.round(total * 0.8), total] : [0, Math.round(total * 0.08), Math.round(total * 0.4), Math.round(total * 0.8), total];
  const t = (i: number) => `${clock(cuts[i], long)}-${clock(cuts[i + 1], long)}`;
  const source = rawNames.length ? `Material bruto: ${rawNames.slice(0, 3).join(', ')}` : 'Material bruto do cliente [a enviar]';
  const objetivo = str(dir.objetivo) || 'contratação';
  const reels = vp.line === 'reels';
  const blocks = reels
    ? [
        { t: t(0), label: 'Gancho', speech: `Antes de contratar ${segment}, faça esta pergunta.`, screen: 'FAÇA ESTA PERGUNTA', visual: 'Plano fechado no rosto, luz lateral, fundo escuro. Marca na primeira cena.' },
        { t: t(1), label: 'Prova', speech: 'Aqui está o trabalho pronto, entregue no prazo que foi combinado.', screen: 'PRAZO COMBINADO', visual: 'Cortes do material bruto: set, entrega e cliente recebendo.' },
        { t: t(2), label: 'Como funciona', speech: 'São três etapas: conversa, roteiro e produção. Cada uma com data marcada.', screen: '3 ETAPAS', visual: 'Três planos rápidos, um por etapa, com o número na tela.' },
        { t: t(3), label: 'Chamada', speech: `Quer ver como fica o seu? Chame ${name} no WhatsApp.`, screen: 'CHAME NO WHATSAPP', visual: 'Logo e contato sobre frame escuro. Último quadro com a chamada.' },
      ]
    : [
        { t: t(0), label: 'Abertura', speech: `Esta é a história de ${name} e do que ela entrega para ${objetivo}.`, screen: name.toUpperCase(), visual: 'Plano aberto de apresentação, trilha entrando em fade.' },
        { t: t(1), label: 'Capítulo 1 · O problema', speech: 'Antes de resolver, é preciso entender o que estava travando.', screen: 'CAPÍTULO 1', visual: 'Entrevista em plano médio com b-roll do dia a dia.' },
        { t: t(2), label: 'Capítulo 2 · A solução', speech: 'Aqui está o processo, passo a passo, do primeiro contato à entrega.', screen: 'CAPÍTULO 2', visual: 'Motion graphics com as etapas e planos de execução.' },
        { t: t(3), label: 'Fechamento', speech: 'Se faz sentido para você, o próximo passo é uma conversa.', screen: 'PRÓXIMO PASSO', visual: 'Plano final, logo, contato e legenda de encerramento.' },
      ];
  return {
    title: vp.title,
    target_duration_s: total,
    blocks,
    shot_list: blocks.map((b, i) => ({ block: b.label, source: i === 0 ? 'Captar: plano novo, 3 takes com a mesma frase' : source, note: i === 0 ? 'Gravar na mesma luz do resto do vídeo' : 'Usar planos de até 2 segundos' })),
    audio: { trilha: str(dir.trilha) || 'Batida seca, sem vocal, volume abaixo da fala', sfx: ['whoosh curto nos cortes', 'clique no número em destaque'], assinatura: 'Selo sonoro de 1 segundo no último quadro' },
    captacao: ['Plano fechado do rosto com a frase do gancho', 'Plano detalhe das mãos em ação', 'Plano geral do local para abrir e fechar'],
    hook_variants: [`Você sabe quanto custa contratar ${segment} errado?`, 'O erro que todo mundo comete na primeira contratação.', `Em ${Math.min(total, 40)} segundos eu mostro como é feito.`, 'Isto é o que ninguém te conta antes de fechar.'],
  };
}

async function buildScript(d: DB, vp: VideoProject) {
  const client = await d.get('clients', vp.client_id);
  if (!client) return { ok: false as const, error: 'Cliente não encontrado.' };
  const { brief } = await briefFor(d, client);
  const assets = (await d.list('assets', { where: { client_id: vp.client_id } })).filter((a) => RAW_KINDS.includes(a.kind));
  const names = assets.slice(0, 25).map((a) => a.name);
  const fullBrief = `${brief}\nMATERIAL BRUTO DISPONÍVEL:\n${names.length ? names.map((n) => `- ${n}`).join('\n') : '- nenhum enviado ainda'}`;
  const direction = obj(vp.direction);
  const example = scriptExample(client, vp, names);
  const r = await generateJSON<ScriptRaw>({
    agent: `Vídeo · Roteiro ${vp.line === 'reels' ? 'Reel' : 'horizontal'}`,
    tier: 'copy',
    system: STUDIO_SYSTEM,
    user: PROMPTS.script(fullBrief, vp.line, direction),
    example,
    db: d,
    clientId: vp.client_id,
    maxTokens: vp.line === 'reels' ? 3000 : 5000,
  });
  const data = r.data;
  const blocks = arr<ScriptRaw['blocks'][number]>(data?.blocks).length ? arr<ScriptRaw['blocks'][number]>(data.blocks) : example.blocks;
  const shot = arr<NonNullable<ScriptRaw['shot_list']>[number]>(data?.shot_list).length ? arr<NonNullable<ScriptRaw['shot_list']>[number]>(data.shot_list) : example.shot_list!;
  const hooks = arr<string>(data?.hook_variants).length ? arr<string>(data.hook_variants) : example.hook_variants!;
  await d.update('video_projects', vp.id, {
    script: { blocks },
    shot_list: shot,
    direction: { ...direction, hook_variants: hooks, audio: data?.audio || example.audio, captacao: arr<string>(data?.captacao).length ? data.captacao : example.captacao, _example: r.isExample },
    target_duration_s: Math.round(numOr(data?.target_duration_s, numOr(vp.target_duration_s, 0))) || vp.target_duration_s || null,
    status: vp.status === 'rascunho' ? 'roteiro' : vp.status,
  } as any);
  return { ok: true as const, isExample: r.isExample };
}

export async function createVideoProjectAction(fd: FormData) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const clientId = String(fd.get('client_id') || '');
  const line = String(fd.get('line') || 'reels') === 'horizontal' ? 'horizontal' : 'reels';
  const title = String(fd.get('title') || '').trim();
  if (!title) return fail('Dê um título ao vídeo.');
  const d = await db();
  const client = await d.get('clients', clientId);
  if (!client) return fail('Cliente não encontrado.');
  const direction: Record<string, unknown> = {};
  for (const k of ['objetivo', 'publico', 'plataforma', 'tom', 'referencias', 'ritmo', 'legenda', 'trilha', 'sfx', 'vfx', 'cor', 'motion']) {
    const v = String(fd.get(k) || '').trim();
    if (v) direction[k] = v;
  }
  const target = Math.max(0, Math.round(numOr(fd.get('duracao'), line === 'reels' ? 40 : 180)));
  const vp = await d.insert('video_projects', {
    client_id: clientId,
    line,
    title,
    direction,
    target_duration_s: target || null,
    aspect: line === 'reels' ? '9:16' : '16:9',
    status: 'rascunho',
    source_asset_ids: [],
  } as any);
  let isExample: boolean | undefined;
  if (fd.get('gerar_roteiro')) {
    const res = await buildScript(d, vp);
    if (res.ok) isExample = res.isExample;
  }
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `abriu o vídeo "${title}" de ${clientName(client)}`, entity: 'video_projects', entity_id: vp.id });
  revalidatePath('/marketing/videos');
  revalidatePath('/marketing');
  return { ok: true as const, id: vp.id, line, isExample };
}

export async function regenerateScriptAction(videoId: string) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const vp = await d.get('video_projects', videoId);
  if (!vp) return fail('Vídeo não encontrado.');
  const res = await buildScript(d, vp);
  if (!res.ok) return res;
  await logActivity(d, { actor_id: user.id, actor_name: 'Agente de Vídeo', action: `gerou o roteiro de "${vp.title}"${res.isExample ? ' (exemplo)' : ''}`, entity: 'video_projects', entity_id: videoId });
  revalidatePath('/marketing/videos');
  return { ok: true as const, isExample: res.isExample };
}

export async function setVideoStatusAction(id: string, status: VideoProject['status']) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  if (!VIDEO_STATUSES.includes(status)) return fail('Status inválido.');
  const d = await db();
  const vp = await d.get('video_projects', id);
  if (!vp) return fail('Vídeo não encontrado.');
  await d.update('video_projects', id, { status } as any);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `moveu "${vp.title}" para ${status}`, entity: 'video_projects', entity_id: id });
  revalidatePath('/marketing/videos');
  revalidatePath('/marketing');
  return { ok: true as const };
}

export async function sendToYuriAction(videoId: string) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const vp = await d.get('video_projects', videoId);
  if (!vp) return fail('Vídeo não encontrado.');
  const client = await d.get('clients', vp.client_id);
  const existing = (await d.list('jobs', { where: { client_id: vp.client_id } })).find((j) => obj(j.input).video_project_id === videoId && (j.status === 'fila' || j.status === 'rodando'));
  if (existing) return fail('Este vídeo já está na fila do Yuri.');
  const kind = vp.line === 'reels' ? 'render_reel' : 'edit_horizontal';
  const job = await d.insert('jobs', {
    kind,
    runner: 'local_yuri',
    client_id: vp.client_id,
    project_id: vp.project_id || null,
    input: { video_project_id: videoId, title: vp.title, line: vp.line, aspect: vp.aspect },
    status: 'fila',
    progress: 0,
    log: vp.line === 'reels' ? 'roteiro, legenda e trilha prontos para o render' : 'rough cut e XML para abrir no Premiere',
  } as any);
  const yuri = (await d.list('profiles')).find((p) => p.username.toUpperCase() === 'YURI');
  if (yuri) {
    await d.insert('notifications', {
      user_id: yuri.id,
      kind: 'job',
      title: `${client ? clientName(client) : 'Cliente'}: "${vp.title}" entrou na sua fila`,
      link: `/marketing/videos?v=${vp.line === 'reels' ? 'reels' : 'horizontal'}&vp=${videoId}`,
    } as any);
  }
  if (vp.status === 'rascunho' || vp.status === 'roteiro') await d.update('video_projects', videoId, { status: 'edicao' } as any);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `enviou "${vp.title}" para a fila do Yuri`, entity: 'jobs', entity_id: job.id });
  revalidatePath('/marketing/videos');
  revalidatePath('/marketing');
  return { ok: true as const, jobId: job.id, notified: !!yuri };
}

/* ------------------------------------------------------------------ */
/* TRÁFEGO                                                             */
/* ------------------------------------------------------------------ */

export type CampaignPayload = {
  client_id: string;
  name: string;
  objective: 'mensagens' | 'leads' | 'vendas' | 'trafego_perfil' | 'visualizacoes' | 'engajamento';
  oferta: { texto: string; preco: string; oferta_real: string; destino: 'whatsapp' | 'url'; url: string; whatsapp: string; mensagem: string };
  funnel: 'TOPO' | 'FUNDO' | 'AMBOS';
  geo: { cidade: string; raio_km: number; idade_min: number; idade_max: number };
  budget: { total: number; daily: number };
  starts_on: string;
  ends_on: string;
  asset_ids: string[];
  content_ids: string[];
  kits: number;
};

const OBJECTIVE_LABEL: Record<string, string> = {
  mensagens: 'Mensagens no WhatsApp',
  leads: 'Leads',
  vendas: 'Vendas no site',
  trafego_perfil: 'Tráfego para o perfil',
  visualizacoes: 'Visualizações de vídeo',
  engajamento: 'Engajamento',
};
const META_OBJECTIVE: Record<string, string> = {
  mensagens: 'OUTCOME_ENGAGEMENT',
  leads: 'OUTCOME_LEADS',
  vendas: 'OUTCOME_SALES',
  trafego_perfil: 'OUTCOME_TRAFFIC',
  visualizacoes: 'OUTCOME_ENGAGEMENT',
  engajamento: 'OUTCOME_ENGAGEMENT',
};

async function creativeNames(d: DB, camp: Campaign) {
  const ids = arr<string>(camp.creative_ids);
  if (!ids.length) return { names: [] as string[], hasVideo: false, hasCarousel: false };
  const [assets, items] = await Promise.all([d.list('assets', { where: { client_id: camp.client_id } }), d.list('content_items', { where: { client_id: camp.client_id } })]);
  const a = assets.filter((x) => ids.includes(x.id));
  const c = items.filter((x) => ids.includes(x.id));
  return {
    names: [...a.map((x) => `${x.name} (${x.kind})`), ...c.map((x) => `peça: ${x.hook}`)],
    hasVideo: a.some((x) => x.mime?.startsWith('video') || x.kind === 'video_bruto'),
    hasCarousel: c.some((x) => x.format === 'carrossel'),
  };
}

function campaignSummary(camp: Campaign, creatives: string[]) {
  return {
    nome: camp.name,
    objetivo: OBJECTIVE_LABEL[str(camp.objective)] || camp.objective,
    funil: camp.funnel,
    oferta: camp.offer,
    praca: camp.geo,
    verba: camp.budget,
    periodo: { inicio: camp.starts_on, fim: camp.ends_on },
    criativos_disponiveis: creatives,
  };
}

function kitZeroExample(client: Client, camp: Campaign, creatives: string[], kitsN: number) {
  const name = clientName(client);
  const offer = obj(camp.offer);
  const geo = obj(camp.geo);
  const budget = obj(camp.budget);
  const funnel = camp.funnel || 'FUNDO';
  const pick = (i: number) => (funnel === 'AMBOS' ? (i % 2 === 0 ? 'FUNDO' : 'TOPO') : funnel);
  const missing: string[] = [];
  if (!str(offer.preco)) missing.push('Preço ou faixa de preço real');
  if (!str(offer.oferta_real)) missing.push('Oferta real com prazo ou vagas (escassez só com data real)');
  if (!creatives.length) missing.push('Vídeo ou foto real do serviço, sem banco de imagem');
  missing.push('Depoimento autorizado por escrito', 'Pixel instalado e domínio verificado');
  const base = [
    { persona: 'Decisor que compara três orçamentos', angulo: 'Dor Imediata', consciencia: 3, hook_formato: 'Pergunta direta', promessa: `Resposta clara de ${name} sobre prazo e preço, sem enrolar.` },
    { persona: 'Indicador cauteloso', angulo: 'Prova Social', consciencia: 4, hook_formato: 'Dado ou estatística', promessa: 'Trabalho real entregue, com data e cliente autorizado.' },
    { persona: 'Quem ainda não conhece a marca', angulo: 'Curiosidade/Revelação', consciencia: 2, hook_formato: 'Narrativa', promessa: 'Mostrar o bastidor de como o trabalho é feito.' },
    { persona: 'Cliente que já comprou antes', angulo: 'Quebra de Objeção', consciencia: 5, hook_formato: 'Afirmação polêmica', promessa: 'Responder a dúvida que mais trava a recompra.' },
    { persona: 'Quem tem prazo apertado', angulo: 'Urgência/Escassez', consciencia: 4, hook_formato: 'Comando direto', promessa: 'Agenda e vagas reais, com data de corte.' },
    { persona: 'Quem quer mudar de fornecedor', angulo: 'Transformação/Identidade', consciencia: 3, hook_formato: 'Narrativa', promessa: 'Antes e depois de quem trocou.' },
  ];
  const n = Math.min(base.length, Math.max(1, kitsN));
  return {
    briefing: [
      `Objetivo: ${OBJECTIVE_LABEL[str(camp.objective)] || str(camp.objective)}`,
      `Oferta: ${str(offer.texto) || '[N] oferta a definir'}${str(offer.preco) ? ` · ${str(offer.preco)}` : ''}`,
      `Destino: ${offer.destino === 'url' ? str(offer.url) || 'URL a definir' : `WhatsApp ${str(offer.whatsapp) || '[N]'}`}`,
      `Praça: ${str(geo.cidade) || str(client.city) || '[N]'}, raio de ${num(numOr(geo.raio_km, 40))} km, ${num(numOr(geo.idade_min, 18))} a ${num(numOr(geo.idade_max, 65))} anos`,
      `Verba: ${brl(numOr(budget.total, 0))} no total, ${brl(numOr(budget.daily, 0))} por dia`,
      `Período: ${camp.starts_on ? fmtDate(camp.starts_on) : '[N]'} a ${camp.ends_on ? fmtDate(camp.ends_on) : '[N]'}`,
      `Criativos reais: ${creatives.length ? creatives.slice(0, 4).join('; ') : 'nenhum selecionado'}`,
    ],
    faltando: missing,
    kits: base.slice(0, n).map((k, i) => ({ n: i + 1, ...k, funil: pick(i) })),
    estrutura: `Uma campanha com orçamento no nível da campanha (CBO) e 2 conjuntos amplos em ${str(geo.cidade) || str(client.city) || 'a praça definida'}, posicionamentos Advantage+. Um criativo por kit para o algoritmo separar os públicos pelo anúncio, não pela segmentação.`,
  };
}

function kitsExample(client: Client, camp: Campaign, kitZero: Record<string, any>, format: string) {
  const name = clientName(client);
  const first = obj(arr(kitZero.kits)[0]);
  const offer = obj(camp.offer);
  const city = str(obj(camp.geo).cidade) || str(client.city) || 'sua cidade';
  const cta = offer.destino === 'url' ? 'Toque em "Saiba mais" e veja os detalhes.' : 'Toque em "Enviar mensagem" e fale no WhatsApp.';
  const checklist = (a: string, b: string, c: string) => `✓ ${a}\n✓ ${b}\n✓ ${c}`;
  const parte1 =
    format.startsWith('reels')
      ? { hook_falado: `Antes de contratar em ${city}, faça esta pergunta.`, texto_na_tela: 'FAÇA ESTA PERGUNTA', desenvolvimento: 'Mostre o trabalho pronto e o prazo combinado em três planos.', cta_falada: 'Toque no botão e chame no WhatsApp.', ultimo_frame: 'Logo, contato e a chamada' }
      : format.startsWith('carrossel')
        ? { cards: ['Capa: a pergunta que decide a contratação', 'Card 2: prazo combinado e cumprido', 'Card 3: o que está incluso', 'Card final: só a chamada'] }
        : { headline_principal: 'Prazo combinado e cumprido', complementar: `Veja como ${name} entrega`, cta_arte: 'Chame no WhatsApp' };
  return {
    kits: [
      {
        n: 1,
        angulo: str(first.angulo, 'Dor Imediata'),
        funil: str(first.funil, camp.funnel === 'TOPO' ? 'TOPO' : 'FUNDO'),
        consciencia: numOr(first.consciencia, 3),
        persona: str(first.persona, 'Decisor que compara orçamentos'),
        parte1,
        titulos: ['Prazo combinado, prazo cumprido', `Orçamento claro em ${city}`, 'Veja o trabalho pronto antes'],
        descricoes: [
          { hook: 'Pergunta direta', texto: `Você já pagou por um serviço e o prazo não foi cumprido?\n\n${checklist('Prazo escrito antes de começar', 'Escopo e valor combinados', 'Entrega com data')}\n\n👉🏻 ${cta}` },
          { hook: 'Afirmação polêmica', texto: `Orçamento sem prazo não é orçamento.\n\n${checklist('Etapas com data', 'Responsável em cada etapa', 'Acompanhamento até a entrega')}\n\n👉🏻 ${cta}` },
          { hook: 'Dado ou estatística', texto: `3 etapas, 3 datas, 1 responsável: é assim que ${name} trabalha.\n\n${checklist('Conversa e briefing', 'Roteiro aprovado por você', 'Produção e entrega')}\n\n👉🏻 ${cta}` },
          { hook: 'Comando direto', texto: `Peça o orçamento hoje e receba o prazo por escrito.\n\n${checklist('Resposta no mesmo dia útil', 'Valor fechado, sem surpresa', 'Trabalho real como referência')}\n\n👉🏻 ${cta}` },
          { hook: 'Narrativa', texto: `Um cliente chegou com o prazo apertado. A gente combinou a data, cumpriu e mostrou o resultado.\n\n${checklist('Combinado por escrito', 'Entregue no dia', 'Autorizado para divulgação')}\n\n👉🏻 ${cta}` },
        ],
        pareamento: ['T1 + D1: pergunta e título falam da mesma dor', 'T2 + D2: afirmação reforça o orçamento claro', 'T3 + D5: título promete ver o trabalho, narrativa mostra'],
      },
    ],
    sugestao_subida: 'Suba o kit 1 como primeiro anúncio da campanha, com os 3 títulos e as 5 descrições no teste dinâmico. Mantenha os demais kits fora até ter 3 dias de dado. Verba de teste: 30% do total.',
  };
}

export async function createCampaignAction(p: CampaignPayload) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  if (!p?.client_id) return fail('Cliente não informado.');
  if (!OBJECTIVE_LABEL[p.objective]) return fail('Escolha o objetivo da campanha.');
  const d = await db();
  const client = await d.get('clients', p.client_id);
  if (!client) return fail('Cliente não encontrado.');
  const kitsN = Math.min(6, Math.max(3, Math.round(numOr(p.kits, 3))));
  const total = Math.max(0, numOr(p.budget?.total, 0));
  const days = p.starts_on && p.ends_on ? Math.max(1, Math.round((new Date(p.ends_on).getTime() - new Date(p.starts_on).getTime()) / 864e5) + 1) : 30;
  const daily = numOr(p.budget?.daily, 0) || Math.round((total / days) * 100) / 100;
  const name = p.name?.trim() || `${OBJECTIVE_LABEL[p.objective]} · ${clientName(client)} · ${monthLong(todayISO().slice(0, 7))}`;
  const creative_ids = [...arr<string>(p.asset_ids), ...arr<string>(p.content_ids)];

  const camp = await d.insert('campaigns', {
    client_id: p.client_id,
    name,
    objective: p.objective,
    funnel: p.funnel || 'FUNDO',
    offer: { ...p.oferta },
    geo: { ...p.geo },
    budget: { total, daily, currency: 'BRL' },
    starts_on: p.starts_on || null,
    ends_on: p.ends_on || null,
    creative_ids,
    kits: [],
    status: 'rascunho',
  } as any);

  const { brief } = await briefFor(d, client);
  const cr = await creativeNames(d, camp);
  const summary = campaignSummary(camp, cr.names);
  const example = kitZeroExample(client, camp, cr.names, kitsN);
  const r = await generateJSON<Record<string, any>>({
    agent: 'Tráfego · Kit Zero',
    tier: 'strategy',
    system: STUDIO_SYSTEM,
    user: PROMPTS.kitZero(brief, summary, kitsN),
    example,
    db: d,
    clientId: p.client_id,
    maxTokens: 3500,
  });
  const kitZero = { ...obj(r.data), kits: arr(obj(r.data).kits).length ? obj(r.data).kits : example.kits, briefing: arr(obj(r.data).briefing).length ? obj(r.data).briefing : example.briefing, faltando: arr(obj(r.data).faltando), is_example: r.isExample, kits_pedidos: kitsN };
  await d.update('campaigns', camp.id, { kit_zero: kitZero, status: 'kit_zero' } as any);
  await logActivity(d, { actor_id: user.id, actor_name: 'Agente de Tráfego', action: `montou o Kit Zero da campanha "${name}"${r.isExample ? ' (exemplo)' : ''}`, entity: 'campaigns', entity_id: camp.id });
  revalidatePath('/marketing/trafego');
  revalidatePath('/marketing');
  return { ok: true as const, id: camp.id, isExample: r.isExample };
}

export async function generateKitsAction(campaignId: string) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const camp = await d.get('campaigns', campaignId);
  if (!camp) return fail('Campanha não encontrada.');
  if (!camp.kit_zero) return fail('Gere o Kit Zero antes dos kits.');
  const client = await d.get('clients', camp.client_id);
  if (!client) return fail('Cliente não encontrado.');
  const { brief } = await briefFor(d, client);
  const cr = await creativeNames(d, camp);
  const format = cr.hasVideo ? 'reels (vídeo vertical 9:16)' : cr.hasCarousel ? 'carrossel 4:5' : 'feed (imagem 4:5)';
  const kitZero = obj(camp.kit_zero);
  const n = arr(kitZero.kits).length || 3;
  const example = kitsExample(client, camp, kitZero, format);
  const r = await generateJSON<Record<string, any>>({
    agent: 'Tráfego · Kits completos',
    tier: 'copy',
    system: STUDIO_SYSTEM,
    user: PROMPTS.kits(brief, campaignSummary(camp, cr.names), kitZero, format),
    example,
    db: d,
    clientId: camp.client_id,
    maxTokens: Math.min(14000, 1800 + n * 1500),
  });
  const kits = arr(obj(r.data).kits).length ? arr(obj(r.data).kits) : example.kits;
  const structure = { ...obj(camp.structure), sugestao_subida: str(obj(r.data).sugestao_subida, example.sugestao_subida), formato: format, kits_example: r.isExample };
  await d.update('campaigns', campaignId, { kits, structure, status: 'pronta' } as any);
  await logActivity(d, { actor_id: user.id, actor_name: 'Agente de Tráfego', action: `gerou ${kits.length} kit(s) da campanha "${camp.name}"${r.isExample ? ' (exemplo)' : ''}`, entity: 'campaigns', entity_id: campaignId });
  revalidatePath('/marketing/trafego');
  return { ok: true as const, count: kits.length, isExample: r.isExample };
}

export async function publishCampaignAction(id: string) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const accessToken = getSecret('metaAccessToken');
  if (!accessToken) return fail('Conecte o token da Meta em Configurações. Enquanto isso, exporte a estrutura e suba manualmente.');
  const d = await db();
  const camp = await d.get('campaigns', id);
  if (!camp) return fail('Campanha não encontrada.');
  const client = await d.get('clients', camp.client_id);
  const acct = (client?.meta_ad_account_id || '').trim();
  if (!acct) return fail('Informe a conta de anúncios Meta do cliente (act_…) na conexão antes de publicar.');
  const account = acct.startsWith('act_') ? acct : `act_${acct}`;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${account}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: camp.name, objective: META_OBJECTIVE[str(camp.objective)] || 'OUTCOME_TRAFFIC', status: 'PAUSED', special_ad_categories: '[]', access_token: accessToken }),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || json.error || !json.id) return fail(`A Meta recusou a criação: ${json.error?.message || `erro ${res.status}`}`);
    await d.update('campaigns', id, { meta_campaign_id: json.id, status: 'pausada' } as any);
    await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `publicou "${camp.name}" pausada no Meta (${json.id})`, entity: 'campaigns', entity_id: id });
    revalidatePath('/marketing/trafego');
    revalidatePath('/marketing');
    return { ok: true as const, metaId: json.id };
  } catch (e) {
    return fail(`Não foi possível falar com a Meta: ${(e as Error).message}`);
  }
}

export async function saveMetaConnectionAction(clientId: string, fd: FormData) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const client = await d.get('clients', clientId);
  if (!client) return fail('Cliente não encontrado.');
  const read = (k: string) => String(fd.get(k) || '').trim();
  const checks = Object.fromEntries(['partner_access', 'billing_active', 'pixel_ok', 'domain_verified', 'page_linked'].map((k) => [k, fd.get(`check_${k}`) === '1']));
  const config = { business_id: read('business_id'), page_id: read('page_id'), instagram_id: read('instagram_id'), pixel_id: read('pixel_id'), whatsapp: read('whatsapp'), checks };
  const adAccount = fd.has('ad_account_id') ? read('ad_account_id') : client.meta_ad_account_id || '';
  if (fd.has('ad_account_id')) await d.update('clients', clientId, { meta_ad_account_id: adAccount || null } as any);
  const ready = Object.values(checks).every(Boolean) && !!adAccount;
  const [existing] = await d.list('integrations', { where: { client_id: clientId, provider: 'meta', scope: 'cliente' }, limit: 1 });
  const patch = { config, status: ready ? 'conectado' : 'pendente', connected_at: ready ? new Date().toISOString() : null };
  if (existing) await d.update('integrations', existing.id, patch as any);
  else await d.insert('integrations', { provider: 'meta', scope: 'cliente', client_id: clientId, ...patch } as any);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `atualizou a conexão Meta de ${clientName(client)}`, entity: 'integrations', entity_id: existing?.id });
  revalidatePath('/marketing/trafego');
  revalidatePath('/marketing', 'layout');
  return { ok: true as const, ready };
}

function audienceExample(client: Client) {
  const name = clientName(client);
  const segment = (client.segment || 'o setor').toLowerCase();
  const city = client.city || 'a cidade';
  return {
    personas: [
      { nome: 'Decisor prático', faixa_etaria: '30 a 50 anos', dores: ['Já foi mal atendido e perdeu dinheiro', 'Não sabe se o prazo será cumprido'], desejos: ['Preço e prazo por escrito', 'Alguém que responda no mesmo dia'], objecoes: ['É caro?', 'E se atrasar?'] },
      { nome: 'Indicador cauteloso', faixa_etaria: '25 a 45 anos', dores: ['Medo de indicar e se queimar', 'Falta de prova para mostrar'], desejos: ['Trabalho real que possa repassar', 'Referência de quem já contratou'], objecoes: ['Tem cliente que posso consultar?'] },
      { nome: 'Quem ainda compara', faixa_etaria: '22 a 40 anos', dores: ['Muita opção igual', 'Promessas genéricas'], desejos: ['Ver o processo antes de decidir'], objecoes: ['Qual é a diferença entre vocês e os outros?'] },
    ],
    angulos_saturados: [`Qualidade e excelência em ${segment}`, 'Preço baixo como único argumento', 'Foto de banco de imagem com sorriso genérico', 'Frases como "somos referência"'],
    praca_sugerida: { cidade: client.city || 'Uberlândia', raio_km: 40, justificativa: `Começar em ${city} com raio de 40 km mantém o custo por resultado legível. Ampliar só depois de 7 dias de dado.` },
    fontes_a_consultar: [
      { titulo: 'Biblioteca de Anúncios da Meta', onde: 'facebook.com/ads/library', por_que: `Ver o que os concorrentes de ${segment} em ${city} estão rodando há mais de 30 dias` },
      { titulo: 'Google Trends', onde: 'trends.google.com', por_que: 'Confirmar sazonalidade e termos que as pessoas realmente buscam' },
      { titulo: 'Instagram dos concorrentes diretos', onde: 'Perfis públicos', por_que: `Comparar frequência, formato e comentários, sem copiar. Ponto de partida: ${name}` },
      { titulo: 'IBGE Cidades', onde: 'cidades.ibge.gov.br', por_que: 'Validar população e faixa etária da praça escolhida' },
    ],
  };
}

export async function researchAudienceAction(clientId: string) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const client = await d.get('clients', clientId);
  if (!client) return fail('Cliente não encontrado.');
  const { brief } = await briefFor(d, client);
  const [diag] = await d.list('diagnoses', { where: { client_id: clientId }, orderBy: 'created_at', desc: true, limit: 1 });
  const example = audienceExample(client);
  const r = await generateJSON<Record<string, any>>({
    agent: 'Tráfego · Pesquisa de público',
    tier: 'copy',
    system: STUDIO_SYSTEM,
    user: `PAPEL: pesquisador de audiência do Studio Impacto, skill anuncios-meta-andromeda.
${brief}
${diag?.summary ? `DIAGNÓSTICO: ${diag.summary}` : ''}
TAREFA: pesquisa de público para tráfego pago local. Entregue personas com dores, desejos e objeções; ângulos saturados no setor que devemos evitar; praça sugerida (cidade, raio, justificativa); fontes a consultar para validar. Nenhum número inventado: onde faltar dado, escreva [N].
FORMATO JSON: {"personas":[{"nome":"...","faixa_etaria":"...","dores":["..."],"desejos":["..."],"objecoes":["..."]}],"angulos_saturados":["..."],"praca_sugerida":{"cidade":"...","raio_km":n,"justificativa":"..."},"fontes_a_consultar":[{"titulo":"...","onde":"...","por_que":"..."}]}`,
    example,
    db: d,
    clientId,
    maxTokens: 3000,
  });
  const data = obj(r.data);
  const findings = { ...(arr(data.personas).length ? data : example), is_example: r.isExample, generated_at: new Date().toISOString() };
  const row = await d.insert('research_reports', { client_id: clientId, kind: 'publico', title: `Pesquisa de público · ${clientName(client)}`, findings, sources: [] } as any);
  await logActivity(d, { actor_id: user.id, actor_name: 'Agente de Tráfego', action: `pesquisou o público de ${clientName(client)}${r.isExample ? ' (exemplo)' : ''}`, entity: 'research_reports', entity_id: row.id });
  revalidatePath('/marketing/trafego');
  return { ok: true as const, id: row.id, isExample: r.isExample };
}

/* ------------------------------------------------------------------ */
/* Relatórios por e-mail                                               */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function saveReportSubscriptionAction(fd: FormData) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const clientId = String(fd.get('client_id') || '');
  const d = await db();
  const client = await d.get('clients', clientId);
  if (!client) return fail('Cliente não encontrado.');
  const emails = splitList(fd.get('emails'));
  const bad = emails.filter((e) => !EMAIL_RE.test(e));
  if (bad.length) return fail(`E-mail inválido: ${bad.join(', ')}`);
  const audience = String(fd.get('audience')) === 'interno' ? 'interno' : 'cliente';
  const frequency = (['diario', 'semanal', 'fim'].includes(String(fd.get('frequency'))) ? String(fd.get('frequency')) : 'semanal') as 'diario' | 'semanal' | 'fim';
  const send_hour = Math.min(23, Math.max(0, Math.round(numOr(fd.get('send_hour'), 9))));
  const campaign_id = String(fd.get('campaign_id') || '') || null;
  const row = { client_id: clientId, campaign_id, audience, emails, frequency, send_hour, active: fd.get('active') !== '0' };
  const id = String(fd.get('id') || '');
  if (id) await d.update('report_subscriptions', id, row as any);
  else await d.insert('report_subscriptions', row as any);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `${id ? 'atualizou' : 'criou'} a assinatura de relatório ${frequency} de ${clientName(client)}`, entity: 'report_subscriptions', entity_id: id || undefined });
  revalidatePath('/marketing/trafego');
  revalidatePath('/marketing');
  return { ok: true as const };
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

type ReportData = { titulo: string; resumo: string; destaques: { label: string; valor: string; leitura: string }[]; proximos_passos: string[]; alerta?: string };

function reportHtml(o: { client: Client; audience: 'interno' | 'cliente'; data: ReportData; period: string }) {
  const studio = { ...STUDIO_DEFAULTS, ...(readConfig().studio || {}) };
  const color = normHex(o.client.brand_color, '#ff5b1f');
  const logo = o.client.logo_url && /^https?:\/\//.test(o.client.logo_url) ? `<img src="${esc(o.client.logo_url)}" alt="" height="36" style="display:block;height:36px;border-radius:8px">` : `<div style="width:36px;height:36px;border-radius:8px;background:${color};color:#0a0a0a;font:700 14px Arial,sans-serif;line-height:36px;text-align:center">${esc(clientName(o.client).slice(0, 2).toUpperCase())}</div>`;
  const cells = o.data.destaques
    .map(
      (h) => `<td valign="top" width="50%" style="padding:6px"><div style="border:1px solid #e6e4df;border-radius:12px;padding:14px;background:#ffffff"><div style="font:600 11px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#8a8a85">${esc(h.label)}</div><div style="font:700 26px Arial,sans-serif;color:#0a0a0a;margin:6px 0 4px">${esc(h.valor)}</div><div style="font:13px/1.4 Arial,sans-serif;color:#5c5c5a">${esc(h.leitura)}</div></div></td>`,
    )
    .reduce<string[]>((rows, cell, i) => {
      if (i % 2 === 0) rows.push(cell);
      else rows[rows.length - 1] += cell;
      return rows;
    }, [])
    .map((r) => `<tr>${r}</tr>`)
    .join('');
  const steps = o.data.proximos_passos.map((s) => `<li style="margin:0 0 6px">${esc(s)}</li>`).join('');
  const alert = o.audience === 'interno' && o.data.alerta ? `<div style="margin:16px 0 0;padding:12px 14px;border-radius:10px;background:#fff4e5;border:1px solid #ffd9a3;font:13px/1.45 Arial,sans-serif;color:#7a4a00"><b>Alerta interno:</b> ${esc(o.data.alerta)}</div>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.data.titulo)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f5f5f3">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fafaf8;border-radius:16px;overflow:hidden;border:1px solid #e6e4df">
<tr><td style="height:6px;background:${color};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:22px 24px 8px"><table role="presentation" width="100%"><tr><td width="48">${logo}</td><td style="padding-left:12px"><div style="font:700 16px Arial,sans-serif;color:#0a0a0a">${esc(clientName(o.client))}</div><div style="font:12px Arial,sans-serif;color:#8a8a85">${esc(o.period)} · por ${esc(studio.name)}</div></td></tr></table></td></tr>
<tr><td style="padding:8px 24px 0"><h1 style="margin:8px 0 10px;font:700 24px/1.15 Arial,sans-serif;color:#0a0a0a">${esc(o.data.titulo)}</h1><p style="margin:0;font:15px/1.55 Arial,sans-serif;color:#2b2b2a">${esc(o.data.resumo)}</p></td></tr>
<tr><td style="padding:14px 18px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cells}</table></td></tr>
<tr><td style="padding:14px 24px 0"><div style="font:600 11px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#8a8a85;margin-bottom:8px">Próximos passos</div><ol style="margin:0;padding-left:20px;font:14px/1.5 Arial,sans-serif;color:#2b2b2a">${steps}</ol>${alert}</td></tr>
<tr><td style="padding:22px 24px"><div style="border-top:1px solid #e6e4df;padding-top:14px;font:12px/1.5 Arial,sans-serif;color:#8a8a85">${esc(studio.name)} · ${esc(studio.city)} · ${esc(studio.whatsapp)}<br>Do ponto ao impacto.</div></td></tr>
</table></td></tr></table></body></html>`;
}

export async function generateReportAction(subscriptionId: string) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const sub = await d.get('report_subscriptions', subscriptionId);
  if (!sub) return fail('Assinatura não encontrada.');
  const client = await d.get('clients', sub.client_id);
  if (!client) return fail('Cliente não encontrado.');
  const campaigns = (await d.list('campaigns', { where: { client_id: sub.client_id } })).filter((c) => !sub.campaign_id || c.id === sub.campaign_id);
  const ids = campaigns.map((c) => c.id);
  const all = ids.length ? await d.list('campaign_metrics_daily', { where: { campaign_id: ids }, orderBy: 'day' }) : [];
  const since7 = isoDay(-6);
  const since14 = isoDay(-13);
  const cur = all.filter((m) => m.day >= since7);
  const prev = all.filter((m) => m.day >= since14 && m.day < since7);
  const agg = (rows: typeof all) => ({ spend: sum(rows, (m) => m.spend), reach: sum(rows, (m) => m.reach), clicks: sum(rows, (m) => m.clicks), results: sum(rows, (m) => m.results) });
  const a = agg(cur);
  const b = agg(prev);
  const cpr = a.results ? a.spend / a.results : 0;
  const delta = (x: number, y: number) => (y > 0 ? Number((((x - y) / y) * 100).toFixed(1)) : null);
  const metrics = {
    periodo: 'últimos 7 dias',
    investimento_brl: Math.round(a.spend),
    alcance: a.reach,
    cliques: a.clicks,
    resultados: a.results,
    custo_por_resultado_brl: Number(cpr.toFixed(2)),
    variacao_vs_semana_anterior_pct: { investimento: delta(a.spend, b.spend), resultados: delta(a.results, b.results), alcance: delta(a.reach, b.reach) },
    campanhas: campaigns.map((c) => {
      const r = cur.filter((m) => m.campaign_id === c.id);
      const s = sum(r, (m) => m.spend);
      const res = sum(r, (m) => m.results);
      return { nome: c.name, gasto: Math.round(s), resultados: res };
    }),
  };

  const freq = sub.frequency === 'diario' ? 'diário' : sub.frequency === 'semanal' ? 'semanal' : 'final de campanha';
  const dRes = delta(a.results, b.results);
  const example: ReportData = {
    titulo: `Relatório ${freq} · ${clientName(client)}`,
    resumo: a.results
      ? `Nos últimos 7 dias, ${brl(a.spend)} geraram ${num(a.results)} resultados, a ${brlCents(cpr)} cada. O alcance foi de ${num(a.reach)} pessoas${dRes != null ? ` e os resultados ${dRes >= 0 ? 'subiram' : 'caíram'} ${num(Math.abs(dRes), 1)}% sobre a semana anterior` : ''}.`
      : `Ainda não há resultados medidos nos últimos 7 dias para ${clientName(client)}. Assim que a campanha entrar no ar, este relatório mostra investimento, alcance e custo por resultado.`,
    destaques: [
      { label: 'Investimento', valor: brl(a.spend), leitura: 'Total gasto nos últimos 7 dias' },
      { label: 'Resultados', valor: num(a.results), leitura: dRes != null ? `${dRes >= 0 ? '+' : ''}${num(dRes, 1)}% sobre a semana anterior` : 'Primeira semana medida' },
      { label: 'Custo por resultado', valor: a.results ? brlCents(cpr) : '[N]', leitura: 'Quanto cada resultado custou' },
      { label: 'Alcance', valor: num(a.reach), leitura: `${num(a.clicks)} cliques no período` },
    ],
    proximos_passos:
      sub.audience === 'cliente'
        ? ['Manter a verba nos anúncios que mais geram resultado', 'Enviar fotos e vídeos reais da semana para renovar os criativos', 'Revisar a agenda de datas para a próxima semana']
        : ['Pausar o criativo de maior custo por resultado', 'Testar uma nova abertura nos 3 primeiros segundos do vídeo', 'Conferir o pixel e os eventos de conversão', 'Subir o próximo kit se o custo se mantiver estável por 3 dias'],
    alerta: sub.audience === 'interno' && a.results && b.results && cpr > (b.spend / b.results) * 1.2 ? 'O custo por resultado subiu mais de 20% sobre a semana anterior. Revisar criativo e público.' : undefined,
  };
  const r = await generateJSON<ReportData>({
    agent: 'Tráfego · Relatório',
    tier: 'light',
    system: STUDIO_SYSTEM,
    user: PROMPTS.report(clientName(client), sub.audience, metrics),
    example,
    db: d,
    clientId: sub.client_id,
    maxTokens: 1600,
  });
  const data: ReportData = {
    titulo: str(r.data?.titulo, example.titulo),
    resumo: str(r.data?.resumo, example.resumo),
    destaques: arr<ReportData['destaques'][number]>(r.data?.destaques).length ? arr<ReportData['destaques'][number]>(r.data.destaques).map((h) => ({ label: str(h.label), valor: str(h.valor), leitura: str(h.leitura) })) : example.destaques,
    proximos_passos: arr<string>(r.data?.proximos_passos).length ? arr<string>(r.data.proximos_passos).map(String) : example.proximos_passos,
    alerta: r.data?.alerta ? str(r.data.alerta) : example.alerta,
  };
  const period = `${fmtDate(since7)} a ${fmtDate(new Date())}`;
  const html = reportHtml({ client, audience: sub.audience, data, period });
  const row = await d.insert('research_reports', {
    client_id: sub.client_id,
    kind: 'relatorio',
    title: `${data.titulo} · ${fmtDate(new Date())}`,
    findings: { subscription_id: subscriptionId, audience: sub.audience, subject: data.titulo, emails: sub.emails, html, data, metrics, is_example: r.isExample, generated_at: new Date().toISOString() },
    sources: [],
  } as any);
  await logActivity(d, { actor_id: user.id, actor_name: 'Agente de Tráfego', action: `gerou a prévia do relatório de ${clientName(client)}${r.isExample ? ' (exemplo)' : ''}`, entity: 'research_reports', entity_id: row.id });
  revalidatePath('/marketing/trafego');
  return { ok: true as const, id: row.id, isExample: r.isExample };
}

export async function sendReportAction(reportId: string) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const apiKey = getSecret('resendApiKey');
  if (!apiKey) return fail('Configure a chave do Resend em Configurações para enviar e-mails. A prévia continua disponível aqui.');
  const d = await db();
  const report = await d.get('research_reports', reportId);
  if (!report || report.kind !== 'relatorio') return fail('Relatório não encontrado.');
  const f = obj(report.findings);
  const sub = f.subscription_id ? await d.get('report_subscriptions', String(f.subscription_id)) : null;
  const to = (sub?.emails?.length ? sub.emails : arr<string>(f.emails)).filter((e) => EMAIL_RE.test(e));
  if (!to.length) return fail('Cadastre ao menos um e-mail na assinatura antes de enviar.');
  const fromEmail = readConfig().reportFromEmail || 'relatorios@studioimpacto.com.br';
  const from = fromEmail.includes('<') ? fromEmail : `Studio Impacto <${fromEmail}>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: str(f.subject, report.title), html: str(f.html) }),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return fail(`O Resend recusou o envio: ${json.message || `erro ${res.status}`}`);
    await d.update('research_reports', reportId, { findings: { ...f, sent_at: new Date().toISOString(), sent_to: to, resend_id: json.id } } as any);
    await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `enviou o relatório "${report.title}" para ${to.length} e-mail(s)`, entity: 'research_reports', entity_id: reportId });
    revalidatePath('/marketing/trafego');
    return { ok: true as const, sent: to.length };
  } catch (e) {
    return fail(`Não foi possível enviar: ${(e as Error).message}`);
  }
}
