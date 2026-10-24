'use server';

import { revalidatePath } from 'next/cache';
import { db, logActivity } from '@/lib/db';
import { getSession, type SessionUser } from '@/lib/auth';
import { generateJSON } from '@/lib/ai/claude';
import { PROMPTS, STUDIO_SYSTEM, clientBrief } from '@/lib/ai/prompts';
import { STUDIO_DEFAULTS, readConfig } from '@/lib/config';
import type { Client, Contract, DB, Deal, Diagnosis, Quote, Role } from '@/lib/db/types';

/* =====================================================================
 * Vendas e Contratos: negociações, propostas (com IA) e contratos.
 * Este arquivo é 'use server': só funções async podem ser exportadas.
 * ===================================================================== */

/* ---------- Tipos da proposta (guardada em quotes.data) ---------- */
export type QuoteItem = { nome: string; descricao: string; inclui: string[]; valor: number; recorrente: boolean };
export type QuoteOption = { nome: string; itens: QuoteItem[]; total_projeto: number; mensal: number; recomendada: boolean };
export type QuoteStage = { etapa: string; semana: string; texto: string };
export type QuoteBody = {
  ponto_de_partida: string[];
  opcoes: QuoteOption[];
  cronograma: QuoteStage[];
  condicoes: string[];
  nao_incluso: string[];
};

/* ---------- Guardas e utilitários ---------- */
type Guard = { ok: true; user: SessionUser } | { ok: false; error: string };
const SALES: Role[] = ['admin', 'comercial'];

async function guard(roles: Role[]): Promise<Guard> {
  const user = await getSession();
  if (!user) return { ok: false, error: 'Não autorizado' };
  if (user.role !== 'admin' && !roles.includes(user.role)) return { ok: false, error: 'Sem permissão para esta ação.' };
  return { ok: true, user };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Hoje em Brasília (YYYY-MM-DD). O todayISO de utils usa UTC e vira o dia 3 horas antes da meia-noite daqui. */
const BR_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
function todayISO() {
  const o: Record<string, string> = {};
  for (const p of BR_DAY.formatToParts(new Date())) o[p.type] = p.value;
  return `${o.year}-${o.month}-${o.day}`;
}

/** Soma dias a uma data 'YYYY-MM-DD' sem depender do fuso do servidor. */
function addDaysISO(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function addMonthsISO(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

/** Dia 10 do mês seguinte à data informada. */
function day10NextMonth(iso: string) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 10)).toISOString().slice(0, 10);
}

/** Aceita "3.500", "3500", "3.500,50" e "R$ 3500". */
function money(v: FormDataEntryValue | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  let n: number;
  if (s.includes(',')) n = Number(s.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ''));
  else n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (fd: FormData, k: string) => String(fd.get(k) || '').trim();
const brlText = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v);

/** Studio: padrão do sistema, sobrescrito pelo que estiver salvo em Settings. */
function studioInfo() {
  const saved = Object.fromEntries(Object.entries(readConfig().studio || {}).filter(([, v]) => v));
  return { ...STUDIO_DEFAULTS, ...saved } as typeof STUDIO_DEFAULTS;
}

function revalidateSales(extra: string[] = []) {
  for (const p of ['/vendas', '/contratos', '/financeiro', '/analytics', '/clientes', '/', ...extra]) revalidatePath(p);
}

/* =====================================================================
 * NEGOCIAÇÕES
 * ===================================================================== */
const STAGES: Deal['stage'][] = ['lead', 'qualificacao', 'diagnostico', 'proposta', 'negociacao', 'fechado', 'perdido'];

/** Mantém o status do cliente coerente com o funil, só para frente (nunca rebaixa cliente ativo). */
async function syncClientStatus(d: DB, clientId: string | null | undefined, stage: Deal['stage']) {
  if (!clientId) return;
  const c = await d.get('clients', clientId);
  if (!c) return;
  const pre: Client['status'][] = ['lead', 'diagnostico', 'proposta'];
  let next: Client['status'] | null = null;
  if (stage === 'fechado') next = c.status === 'ativo' ? null : 'ativo';
  else if (stage === 'diagnostico' || stage === 'proposta' || stage === 'negociacao') {
    const target: Client['status'] = stage === 'diagnostico' ? 'diagnostico' : 'proposta';
    if (pre.includes(c.status) && pre.indexOf(target) > pre.indexOf(c.status)) next = target;
  }
  if (next) await d.update('clients', clientId, { status: next });
}

export async function createDealAction(fd: FormData) {
  const g = await guard(SALES);
  if (!g.ok) return g;
  const title = text(fd, 'title');
  if (!title) return { ok: false as const, error: 'Informe o título da negociação.' };
  const d = await db();
  const clientId = text(fd, 'client_id') || null;
  const prob = Math.round(Math.min(100, Math.max(0, money(fd.get('probability')) || 15)));
  const next = text(fd, 'next_action_at');
  const deal = await d.insert('deals', {
    client_id: clientId,
    title,
    stage: 'lead',
    value: money(fd.get('value')) || null,
    probability: prob,
    source: text(fd, 'source') || null,
    owner_id: g.user.id,
    next_action_at: next ? `${next}T12:00:00-03:00` : null,
  });
  await logActivity(d, { actor_id: g.user.id, actor_name: g.user.name, action: `abriu a negociação ${title}`, entity: 'deals', entity_id: deal.id });
  revalidateSales();
  return { ok: true as const, id: deal.id };
}

export async function moveDealAction(id: string, stage: string) {
  const g = await guard(SALES);
  if (!g.ok) return g;
  if (!STAGES.includes(stage as Deal['stage'])) return { ok: false as const, error: 'Etapa inválida.' };
  const d = await db();
  const deal = await d.get('deals', id);
  if (!deal) return { ok: false as const, error: 'Negociação não encontrada.' };
  const to = stage as Deal['stage'];
  const patch: Partial<Deal> = { stage: to };
  if (to === 'fechado') patch.probability = 100;
  if (to === 'perdido') patch.probability = 0;
  await d.update('deals', id, patch);
  await syncClientStatus(d, deal.client_id, to);
  if (to === 'fechado' || to === 'perdido') {
    await logActivity(d, { actor_id: g.user.id, actor_name: g.user.name, action: `${to === 'fechado' ? 'fechou' : 'perdeu'} a negociação ${deal.title}`, entity: 'deals', entity_id: id });
  }
  revalidateSales();
  return { ok: true as const };
}

export async function setDealLostReasonAction(id: string, reason: string) {
  const g = await guard(SALES);
  if (!g.ok) return g;
  const d = await db();
  await d.update('deals', id, { lost_reason: reason.trim() || null });
  revalidatePath('/vendas');
  return { ok: true as const };
}

/* =====================================================================
 * PROPOSTAS
 * ===================================================================== */
const STAGE_NAMES = ['Ponto', 'Roteiro', 'Set', 'Estreia', 'Temporada'];

const DEFAULT_SCHEDULE: QuoteStage[] = [
  { etapa: 'Ponto', semana: 'Semana 1', texto: 'Diagnóstico de 45 minutos e briefing' },
  { etapa: 'Roteiro', semana: 'Semanas 1 e 2', texto: 'Estratégia, séries e cronograma de entregas' },
  { etapa: 'Set', semana: 'Semanas 2 e 3', texto: 'Captação e produção do material' },
  { etapa: 'Estreia', semana: 'Semana 4', texto: 'Primeira entrega no ar, com aprovação do cliente' },
  { etapa: 'Temporada', semana: 'A partir da semana 5', texto: 'Ciclos mensais com relatório e ajuste' },
];

const DEFAULT_CONDITIONS = [
  'Projetos: pagamento de 50% na aprovação e 50% na entrega.',
  'Planos mensais: vencimento todo dia 10, a partir da Estreia, com reajuste anual pelo IPCA.',
  'Prazos contados a partir do briefing e do material completos.',
  'Até 2 rodadas de ajuste por entrega.',
  'A propriedade das peças passa ao cliente após a quitação.',
  'Domínio e contas de anúncios sempre em nome do cliente.',
  'Diárias de gravação são cobradas à parte, com orçamento prévio.',
  'Esta proposta vale por 15 dias a partir da emissão.',
];

const DEFAULT_EXCLUDED = ['Verba de mídia (Meta Ads)', 'Diárias de captação', 'Domínio .com.br no Registro.br', 'Músicas comerciais', 'Deslocamentos fora de Uberlândia'];

/** Proposta de exemplo (sem chave da IA): 3 opções com os valores de referência do Studio. */
function exampleQuote(client: Client, diag: Diagnosis | null): QuoteBody {
  const nome = client.company || client.contact_name;
  const firstSentence = (client.who_is || '').split(/(?<=[.!?])\s+/)[0]?.trim();
  return {
    ponto_de_partida: [
      clean(firstSentence, `${nome} atua em ${client.segment || '[N]'}${client.city ? `, em ${client.city}` : ''}.`),
      diag?.findings?.[0] ? `O diagnóstico aponta: ${clean(diag.findings[0].title).toLowerCase()}.` : 'O Diagnóstico de 45 minutos define o que falta e a ordem de execução.',
      'Objetivo: organizar a presença digital em ciclos mensais, com método, prazo e acompanhamento.',
    ],
    opcoes: [
      {
        nome: 'Ponto',
        recomendada: false,
        total_projeto: 3500,
        mensal: 0,
        itens: [
          { nome: 'Landing page', descricao: 'Página única com formulário para WhatsApp, pixel e domínio.', inclui: ['1 página única', 'Formulário para WhatsApp', 'Pixel instalado', 'Domínio no nome do cliente'], valor: 3500, recorrente: false },
        ],
      },
      {
        nome: 'Temporada',
        recomendada: true,
        total_projeto: 6500,
        mensal: 3500,
        itens: [
          { nome: 'Marca completa', descricao: 'Diagnóstico, estratégia, sistema verbal e visual, manual da marca.', inclui: ['Diagnóstico e estratégia', 'Sistema verbal e visual', 'Manual da marca'], valor: 6500, recorrente: false },
          { nome: 'Presença (conteúdo mensal)', descricao: 'Feed, stories e Reels no mês, com aprovação antes de publicar.', inclui: ['Feed, stories e Reels', 'Aprovação no portal', 'Relatório mensal'], valor: 3500, recorrente: true },
        ],
      },
      {
        nome: 'Impacto 360',
        recomendada: false,
        total_projeto: 0,
        mensal: 8500,
        itens: [
          { nome: 'Impacto 360', descricao: 'Conteúdo, tráfego, vídeo e acompanhamento no mesmo plano mensal.', inclui: ['Conteúdo mensal', 'Gestão de tráfego', 'Vídeo e roteiros', 'Relatório mensal'], valor: 8500, recorrente: true },
        ],
      },
    ],
    cronograma: DEFAULT_SCHEDULE,
    condicoes: DEFAULT_CONDITIONS,
    nao_incluso: DEFAULT_EXCLUDED,
  };
}

/** Texto de marca sem travessão: troca travessões da IA por vírgula (ou "a" entre números). */
function clean(s: unknown, fallback = ''): string {
  if (typeof s !== 'string' && typeof s !== 'number') return fallback;
  const t = String(s)
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 a $2')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  return t || fallback;
}

const strList = (v: unknown, max = 12) => (Array.isArray(v) ? v.map((x) => clean(x)).filter(Boolean).slice(0, max) : []);
const numOf = (v: unknown) => (typeof v === 'number' ? (Number.isFinite(v) ? v : 0) : money(typeof v === 'string' ? v : null));

/** Valida e completa o JSON da IA: totais batem com os itens, uma única opção recomendada, cronograma com as 5 etapas. */
function normalizeQuote(raw: unknown, fallback: QuoteBody): QuoteBody {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawOpts = Array.isArray(r.opcoes) ? (r.opcoes as Record<string, unknown>[]) : [];
  let opcoes: QuoteOption[] = rawOpts
    .slice(0, 3)
    .map((o, i) => {
      const itens: QuoteItem[] = (Array.isArray(o?.itens) ? (o.itens as Record<string, unknown>[]) : []).slice(0, 8).map((it) => ({
        nome: clean(it?.nome, 'Item'),
        descricao: clean(it?.descricao),
        inclui: strList(it?.inclui, 8),
        valor: Math.max(0, round2(numOf(it?.valor))),
        recorrente: Boolean(it?.recorrente),
      }));
      const hasValues = itens.some((x) => x.valor > 0);
      const proj = round2(itens.filter((x) => !x.recorrente).reduce((a, b) => a + b.valor, 0));
      const mes = round2(itens.filter((x) => x.recorrente).reduce((a, b) => a + b.valor, 0));
      return {
        nome: clean(o?.nome, `Opção ${i + 1}`),
        itens,
        total_projeto: hasValues ? proj : Math.max(0, round2(numOf(o?.total_projeto))),
        mensal: hasValues ? mes : Math.max(0, round2(numOf(o?.mensal))),
        recomendada: Boolean(o?.recomendada),
      };
    })
    .filter((o) => o.itens.length > 0 || o.total_projeto > 0 || o.mensal > 0);
  if (!opcoes.length) opcoes = fallback.opcoes;

  let rec = opcoes.findIndex((o) => o.recomendada);
  if (rec < 0) rec = opcoes.findIndex((o) => o.nome.toLowerCase().includes('temporada'));
  if (rec < 0) rec = Math.min(1, opcoes.length - 1);
  opcoes = opcoes.map((o, i) => ({ ...o, recomendada: i === rec }));

  const rawSchedule = Array.isArray(r.cronograma) ? (r.cronograma as Record<string, unknown>[]) : [];
  const cronograma: QuoteStage[] = STAGE_NAMES.map((etapa) => {
    const found = rawSchedule.find((s) => clean(s?.etapa).toLowerCase() === etapa.toLowerCase());
    const base = fallback.cronograma.find((s) => s.etapa === etapa) || DEFAULT_SCHEDULE.find((s) => s.etapa === etapa)!;
    return { etapa, semana: clean(found?.semana, base.semana), texto: clean(found?.texto, base.texto).slice(0, 90) };
  });

  const ponto = strList(r.ponto_de_partida, 4);
  const cond = strList(r.condicoes, 12);
  const excl = strList(r.nao_incluso, 10);
  return {
    ponto_de_partida: ponto.length ? ponto : fallback.ponto_de_partida,
    opcoes,
    cronograma,
    condicoes: cond.length ? cond : fallback.condicoes,
    nao_incluso: excl.length ? excl : fallback.nao_incluso,
  };
}

/** Próximo número sequencial do ano: 2026-0NN, a partir do maior já emitido. */
function nextQuoteNumber(quotes: Quote[]) {
  const year = todayISO().slice(0, 4);
  let max = 0;
  for (const q of quotes) {
    const m = /^(\d{4})-(\d+)$/.exec(q.number || '');
    if (m && m[1] === year) max = Math.max(max, Number(m[2]));
  }
  return `${year}-${String(max + 1).padStart(3, '0')}`;
}

export async function generateQuoteAction(fd: FormData) {
  const g = await guard(SALES);
  if (!g.ok) return g;
  const clientId = text(fd, 'client_id');
  if (!clientId) return { ok: false as const, error: 'Escolha o cliente da proposta.' };
  const target = money(fd.get('valor_alvo'));
  const notes = text(fd, 'observacoes');
  const d = await db();
  const client = await d.get('clients', clientId);
  if (!client) return { ok: false as const, error: 'Cliente não encontrado.' };

  const [[ctx], [diag], [resp], catalog, quotes, deals] = await Promise.all([
    d.list('client_contexts', { where: { client_id: clientId }, orderBy: 'version', desc: true, limit: 1 }),
    d.list('diagnoses', { where: { client_id: clientId }, orderBy: 'created_at', desc: true, limit: 1 }),
    d.list('questionnaire_responses', { where: { client_id: clientId }, orderBy: 'created_at', desc: true, limit: 1 }),
    d.list('services_catalog', { orderBy: 'name' }),
    d.list('quotes'),
    d.list('deals', { where: { client_id: clientId }, orderBy: 'created_at', desc: true }),
  ]);

  const extra = [
    target > 0 ? `VALOR-ALVO DO COMERCIAL: ${brlText(target)} no total do projeto da opção recomendada. Distribua pelo esforço de cada parte e feche a soma exata.` : '',
    notes ? `OBSERVAÇÕES DO COMERCIAL: ${notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const brief = [clientBrief(client, ctx || null, resp?.answers || null), extra].filter(Boolean).join('\n');
  const example = exampleQuote(client, diag || null);

  const r = await generateJSON<QuoteBody>({
    agent: 'Comercial · Proposta',
    tier: 'strategy',
    system: STUDIO_SYSTEM,
    user: PROMPTS.quote(
      brief,
      diag || null,
      catalog.map((s) => ({ name: s.name, base_price: s.base_price, kind: s.kind })),
    ),
    example,
    db: d,
    clientId,
    maxTokens: 4500,
  });
  const body = normalizeQuote(r.data, example);
  const rec = body.opcoes.find((o) => o.recomendada) || body.opcoes[0];

  const today = todayISO();
  const number = nextQuoteNumber(quotes);
  const nome = client.company || client.contact_name;
  const openDeal = deals.find((x) => x.stage !== 'fechado' && x.stage !== 'perdido');
  const quote = await d.insert('quotes', {
    number,
    deal_id: openDeal?.id || null,
    client_id: clientId,
    data: {
      cliente: client.contact_name,
      empresa: nome,
      segmento: client.segment || null,
      cidade: client.city ? `${client.city}${client.state ? `/${client.state}` : ''}` : null,
      emitida_em: today,
      validade_dias: 15,
      ...body,
      recomendada: rec.nome,
      valor_alvo: target || null,
      observacoes: notes || null,
      diagnostico_id: diag?.id || null,
      gerada_por: g.user.name,
      is_example: r.isExample,
    },
    total: rec.total_projeto,
    monthly: rec.mensal,
    valid_until: addDaysISO(today, 15),
    status: 'rascunho',
  });

  if (openDeal) {
    const patch: Partial<Deal> = {};
    if (!openDeal.value) patch.value = round2(rec.total_projeto + rec.mensal * 12);
    if (['lead', 'qualificacao', 'diagnostico'].includes(openDeal.stage)) patch.stage = 'proposta';
    if (Object.keys(patch).length) await d.update('deals', openDeal.id, patch);
  }
  await syncClientStatus(d, clientId, 'proposta');
  await logActivity(d, { actor_id: g.user.id, actor_name: g.user.name, action: `gerou a proposta ${number} para ${nome}${r.isExample ? ' (exemplo)' : ''}`, entity: 'quotes', entity_id: quote.id });
  revalidateSales([`/clientes/${clientId}`]);
  return { ok: true as const, id: quote.id, number, isExample: r.isExample };
}

const QUOTE_STATUSES: Quote['status'][] = ['rascunho', 'enviada', 'vista', 'aceita', 'recusada', 'expirada'];
const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthName = (iso: string) => MONTHS_PT[Number(iso.slice(5, 7)) - 1] || '';
const dmy = (iso: string) => iso.split('-').reverse().join('/');
const longDate = (iso: string) => {
  const [y, m, dd] = iso.split('-').map(Number);
  return `${dd} de ${MONTHS_PT[m - 1]} de ${y}`;
};

export async function setQuoteStatusAction(id: string, status: string, optionName?: string) {
  const g = await guard(SALES);
  if (!g.ok) return g;
  if (!QUOTE_STATUSES.includes(status as Quote['status'])) return { ok: false as const, error: 'Status inválido.' };
  const d = await db();
  const quote = await d.get('quotes', id);
  if (!quote) return { ok: false as const, error: 'Proposta não encontrada.' };
  const to = status as Quote['status'];
  if (to === 'aceita') return acceptQuote(d, g.user, quote, optionName);
  await d.update('quotes', id, { status: to });
  await logActivity(d, { actor_id: g.user.id, actor_name: g.user.name, action: `marcou a proposta ${quote.number} como ${to}`, entity: 'quotes', entity_id: id });
  revalidateSales();
  return { ok: true as const };
}

/** Aceite com escolha da opção (formulário do detalhe da proposta). */
export async function acceptQuoteAction(id: string, fd: FormData) {
  return setQuoteStatusAction(id, 'aceita', text(fd, 'opcao') || undefined);
}

/**
 * Proposta aceita: cria o contrato (rascunho), as faturas (50/50 no projeto, 1ª mensalidade dia 10 do mês seguinte),
 * ativa o cliente e fecha a negociação. Chamar de novo não duplica nada.
 */
async function acceptQuote(d: DB, user: SessionUser, quote: Quote, optionName?: string) {
  const already = await d.list('contracts', { where: { quote_id: quote.id } });
  if (already.length) {
    // Já virou contrato (mesmo que o status tenha sido mexido depois): só garante o status e não duplica nada.
    if (quote.status !== 'aceita') {
      await d.update('quotes', quote.id, { status: 'aceita' });
      revalidateSales();
    }
    return { ok: true as const, contractId: already[0].id };
  }

  const data = (quote.data || {}) as { opcoes?: QuoteOption[]; empresa?: string; cliente?: string; [k: string]: unknown };
  const opcoes = Array.isArray(data.opcoes) ? data.opcoes : [];
  const chosen = opcoes.find((o) => o.nome === optionName) || opcoes.find((o) => o.recomendada) || null;
  const total = round2(chosen ? chosen.total_projeto : Number(quote.total || 0));
  const monthly = round2(chosen ? chosen.mensal : Number(quote.monthly || 0));
  const client = quote.client_id ? await d.get('clients', quote.client_id) : null;
  const clientName = client?.company || client?.contact_name || String(data.empresa || data.cliente || 'Cliente');
  const optionLabel = chosen?.nome || 'Proposta';
  const title = `${clientName} · ${optionLabel}`;
  const today = todayISO();
  const kind: Contract['kind'] = monthly > 0 ? 'recorrente' : 'projeto';

  const contract = await d.insert('contracts', {
    client_id: quote.client_id || null,
    quote_id: quote.id,
    title,
    kind,
    body: buildContractBody({ kind, clientName, title, value: total, monthly, startsOn: today, endsOn: kind === 'recorrente' ? addMonthsISO(today, 12) : null, quoteNumber: quote.number }),
    status: 'rascunho',
    starts_on: today,
    ends_on: kind === 'recorrente' ? addMonthsISO(today, 12) : null,
    value: total,
    monthly,
  });

  const base = { client_id: quote.client_id || null, contract_id: contract.id, method: 'pix' as const, status: 'aberta' as const };
  if (total > 0) {
    const first = round2(total / 2);
    await d.insert('invoices', { ...base, description: `${title} · parcela 1 de 2 (50% na aprovação)`, amount: first, due_on: today });
    await d.insert('invoices', { ...base, description: `${title} · parcela 2 de 2 (50% na entrega)`, amount: round2(total - first), due_on: addDaysISO(today, 30) });
  }
  if (monthly > 0) {
    const due = day10NextMonth(today);
    await d.insert('invoices', { ...base, description: `${title} · mensalidade de ${monthName(due)}`, amount: monthly, due_on: due });
  }

  if (client && client.status !== 'ativo') await d.update('clients', client.id, { status: 'ativo' });

  let deal = quote.deal_id ? await d.get('deals', quote.deal_id) : null;
  if (!deal && quote.client_id) {
    const list = await d.list('deals', { where: { client_id: quote.client_id }, orderBy: 'created_at', desc: true });
    deal = list.find((x) => x.stage !== 'fechado' && x.stage !== 'perdido') || null;
  }
  const dealValue = round2(total + monthly * 12);
  if (deal) await d.update('deals', deal.id, { stage: 'fechado', probability: 100, value: dealValue || deal.value || null });
  else deal = await d.insert('deals', { client_id: quote.client_id || null, title, stage: 'fechado', value: dealValue || null, probability: 100, source: 'proposta', owner_id: user.id });

  await d.update('quotes', quote.id, {
    status: 'aceita',
    total,
    monthly,
    deal_id: deal.id,
    data: { ...data, opcao_aceita: optionLabel, aceita_em: today },
  });
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `registrou o aceite da proposta ${quote.number} (${optionLabel}) de ${clientName}`, entity: 'quotes', entity_id: quote.id });
  revalidateSales(quote.client_id ? [`/clientes/${quote.client_id}`] : []);
  return { ok: true as const, contractId: contract.id };
}

/* =====================================================================
 * CONTRATOS
 * ===================================================================== */
const CONTRACT_KINDS: Contract['kind'][] = ['projeto', 'recorrente', 'parceria', 'imagem', 'case'];
const CONTRACT_STATUSES: Contract['status'][] = ['rascunho', 'enviado', 'assinado', 'vencendo', 'encerrado'];

type ContractInput = {
  kind: Contract['kind'];
  clientName: string;
  title: string;
  value: number;
  monthly: number;
  startsOn: string;
  endsOn: string | null;
  quoteNumber?: string;
};

/** Modelo de contrato em português. Lacunas a preencher ficam entre colchetes. */
function buildContractBody(o: ContractInput): string {
  const st = studioInfo();
  const sede = st.city || 'Uberlândia, MG';
  const cidade = sede.split(',')[0].trim();
  const escopo = o.quoteNumber ? `proposta ${o.quoteNumber}` : 'proposta aceita pelo CONTRATANTE';
  const vigencia12 = o.endsOn ? `de ${dmy(o.startsOn)} a ${dmy(o.endsOn)}` : `a partir de ${dmy(o.startsOn)}`;
  const clauses: { title: string; paras: string[] }[] = [];

  const titles: Record<Contract['kind'], string> = {
    projeto: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS CRIATIVOS (PROJETO)',
    recorrente: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS CRIATIVOS (PLANO MENSAL)',
    parceria: 'CONTRATO DE PARCERIA COM EXCLUSIVIDADE',
    imagem: 'TERMO DE CESSÃO DE USO DE IMAGEM',
    case: 'TERMO DE AUTORIZAÇÃO DE CASE',
  };

  /* Objeto */
  const objeto: Record<Contract['kind'], string> = {
    projeto: `Execução do projeto "${o.title}", conforme o escopo da ${escopo}, organizado no Método Impacto: Ponto, Roteiro, Set, Estreia e Temporada.`,
    recorrente: `Prestação mensal e continuada dos serviços descritos em "${o.title}", conforme o escopo da ${escopo}, organizada no Método Impacto: Ponto, Roteiro, Set, Estreia e Temporada.`,
    parceria: `Parceria comercial e de comunicação "${o.title}", com remuneração mensal e exclusividade da CONTRATADA nos serviços de comunicação, conteúdo e tráfego do CONTRATANTE [confirmar o alcance da exclusividade].`,
    imagem: `Cessão, pelo CONTRATANTE à CONTRATADA, do direito de uso de sua imagem, nome, voz e material audiovisual produzido em "${o.title}", em portfólio, site e redes sociais do Studio Impacto.`,
    case: `Autorização, pelo CONTRATANTE, para que a CONTRATADA publique o projeto "${o.title}" como case, com nome, imagens e resultados aprovados antes por escrito.`,
  };
  clauses.push({ title: 'DO OBJETO', paras: [objeto[o.kind]] });

  /* Prazo */
  const prazo: Record<Contract['kind'], string[]> = {
    projeto: [
      o.quoteNumber ? `O cronograma de execução segue o da proposta ${o.quoteNumber}, contado a partir do recebimento do briefing e de todo o material necessário.` : 'O prazo de execução é de [N] semanas, contado a partir do recebimento do briefing e de todo o material necessário.',
      `A vigência começa em ${dmy(o.startsOn)}${o.endsOn ? ` e vai até ${dmy(o.endsOn)}` : ' e termina com a entrega final e o aceite do CONTRATANTE'}.`,
    ],
    recorrente: [`A vigência é de 12 meses, ${vigencia12}, renovável por acordo escrito entre as partes.`],
    parceria: [`A vigência é de 12 meses, ${vigencia12}, e a exclusividade vale pelo mesmo período. A renovação depende de acordo escrito entre as partes.`],
    imagem: [`A autorização vale ${vigencia12}${o.endsOn ? '' : ', por prazo indeterminado'}. O CONTRATANTE pode revogá-la a qualquer momento, por escrito; a revogação vale para novas publicações.`],
    case: [`A autorização vale ${vigencia12}${o.endsOn ? '' : ', por prazo indeterminado'}. O CONTRATANTE pode revogá-la a qualquer momento, por escrito; a revogação vale para novas publicações.`],
  };
  clauses.push({ title: 'DO PRAZO', paras: prazo[o.kind] });

  /* Valores */
  const parcela = `O valor do projeto é de ${brlText(o.value)}, pago em duas parcelas iguais de ${brlText(round2(o.value / 2))}: 50% na aprovação e 50% na entrega, por Pix ou boleto.`;
  const valores: Record<Contract['kind'], string[]> = {
    projeto: [o.value > 0 ? parcela : 'O valor do projeto é de [valor], pago em duas parcelas iguais: 50% na aprovação e 50% na entrega, por Pix ou boleto.'],
    recorrente: [
      o.monthly > 0 ? `O valor mensal é de ${brlText(o.monthly)}, com vencimento todo dia 10, a partir da Estreia, por Pix ou boleto.` : 'O valor mensal é de [valor], com vencimento todo dia 10, a partir da Estreia, por Pix ou boleto.',
      ...(o.value > 0 ? [parcela] : []),
      'Os valores são reajustados a cada 12 meses pelo IPCA acumulado no período.',
    ],
    parceria: [
      o.monthly > 0 ? `A remuneração mensal é de ${brlText(o.monthly)}, com vencimento todo dia 10, por Pix ou boleto.` : 'A remuneração mensal é de [valor], com vencimento todo dia 10, por Pix ou boleto.',
      'Os valores são reajustados a cada 12 meses pelo IPCA acumulado no período.',
    ],
    imagem: ['Esta cessão não tem remuneração adicional, salvo ajuste por escrito entre as partes.'],
    case: ['Esta autorização não tem remuneração adicional, salvo ajuste por escrito entre as partes.'],
  };
  clauses.push({ title: 'DO VALOR E DO PAGAMENTO', paras: valores[o.kind] });

  if (o.kind === 'projeto' || o.kind === 'recorrente' || o.kind === 'parceria') {
    clauses.push({
      title: 'DAS ENTREGAS E DOS AJUSTES',
      paras: [
        'Cada entrega admite até 2 (duas) rodadas de ajuste. Pedidos além disso são orçados à parte.',
        'Os prazos contam a partir do recebimento do briefing e de todo o material necessário. Atrasos do CONTRATANTE no envio de material ou na aprovação suspendem os prazos da CONTRATADA pelo mesmo período.',
      ],
    });
    clauses.push({
      title: 'DA PROPRIEDADE',
      paras: ['A propriedade das peças finais entregues passa ao CONTRATANTE após a quitação integral dos valores devidos. Estruturas-base, modelos, códigos e ferramentas da CONTRATADA permanecem com ela.'],
    });
    clauses.push({
      title: 'DO DOMÍNIO E DAS CONTAS',
      paras: ['Domínios, contas de anúncios e perfis ficam sempre em nome do CONTRATANTE, que concede à CONTRATADA os acessos necessários à execução.'],
    });
    clauses.push({
      title: 'DAS DIÁRIAS E DOS CUSTOS À PARTE',
      paras: [
        'Diárias de gravação e captação são cobradas à parte, com orçamento prévio aprovado pelo CONTRATANTE.',
        'Verba de mídia, registro de domínio, músicas comerciais e deslocamentos fora de Uberlândia não estão incluídos e são custeados pelo CONTRATANTE.',
      ],
    });
    clauses.push({
      title: 'DO USO DE IMAGEM E DE CASE',
      paras: ['A CONTRATADA só usará o nome, a imagem e os resultados do CONTRATANTE em portfólio, site e redes sociais mediante autorização por escrito do CONTRATANTE.'],
    });
  }
  if (o.kind === 'imagem') {
    clauses.push({ title: 'DAS LIMITAÇÕES', paras: ['O uso fora do portfólio, do site e das redes sociais do Studio Impacto depende de nova autorização por escrito. A imagem não será usada de forma que a desabone.'] });
  }
  if (o.kind === 'case') {
    clauses.push({ title: 'DAS LIMITAÇÕES', paras: ['A CONTRATADA não divulgará números, depoimentos ou resultados que o CONTRATANTE não tenha aprovado antes por escrito.'] });
  }
  if (o.kind === 'recorrente' || o.kind === 'parceria') {
    clauses.push({
      title: 'DA RESCISÃO',
      paras: ['Qualquer das partes pode rescindir este contrato por escrito, com aviso prévio de 30 (trinta) dias, permanecendo devidos os valores das entregas já realizadas e do período de aviso.'],
    });
  }
  clauses.push({ title: 'DO FORO', paras: ['Fica eleito o foro da comarca de Uberlândia, Minas Gerais, para resolver qualquer questão deste contrato.'] });

  const lines: string[] = [
    titles[o.kind],
    '',
    'PARTES',
    `CONTRATADA: ${st.name.toUpperCase()}, inscrita no CNPJ ${st.cnpj}, com sede em ${sede}, representada por Vitor Filgueiras.`,
    `CONTRATANTE: ${o.clientName}, inscrito(a) no CPF/CNPJ [CPF/CNPJ], com endereço em [endereço completo].`,
    '',
    'As partes acordam as cláusulas a seguir.',
  ];
  clauses.forEach((c, i) => {
    lines.push('', `CLÁUSULA ${i + 1}. ${c.title}`);
    c.paras.forEach((p, j) => lines.push(`${i + 1}.${j + 1} ${p}`));
  });
  lines.push(
    '',
    `${cidade}, ___ de ______________ de ______.`,
    '',
    '______________________________________',
    `${st.name.toUpperCase()} · CNPJ ${st.cnpj}`,
    'Vitor Filgueiras',
    '',
    '______________________________________',
    o.clientName,
    '',
    'Testemunhas:',
    '1. ______________________________  CPF ______________________',
    '2. ______________________________  CPF ______________________',
  );
  return lines.join('\n');
}

export async function createContractAction(fd: FormData) {
  const g = await guard(SALES);
  if (!g.ok) return g;
  const clientId = text(fd, 'client_id');
  const title = text(fd, 'title');
  const kind = text(fd, 'kind') as Contract['kind'];
  if (!clientId) return { ok: false as const, error: 'Escolha o cliente do contrato.' };
  if (!title) return { ok: false as const, error: 'Informe o título do contrato.' };
  if (!CONTRACT_KINDS.includes(kind)) return { ok: false as const, error: 'Escolha o tipo de contrato.' };
  const startsOn = text(fd, 'starts_on') || todayISO();
  const endsOn = text(fd, 'ends_on') || null;
  if (endsOn && endsOn < startsOn) return { ok: false as const, error: 'A data final precisa ser depois da inicial.' };
  const d = await db();
  const client = await d.get('clients', clientId);
  if (!client) return { ok: false as const, error: 'Cliente não encontrado.' };
  // Só guarda o valor que o tipo de contrato usa (o texto do contrato segue a mesma regra).
  const value = kind === 'projeto' || kind === 'recorrente' ? round2(money(fd.get('value'))) : 0;
  const monthly = kind === 'recorrente' || kind === 'parceria' ? round2(money(fd.get('monthly'))) : 0;
  const clientName = client.company || client.contact_name;
  const contract = await d.insert('contracts', {
    client_id: clientId,
    title,
    kind,
    body: buildContractBody({ kind, clientName, title, value, monthly, startsOn, endsOn }),
    status: 'rascunho',
    starts_on: startsOn,
    ends_on: endsOn,
    value: value || null,
    monthly: monthly || null,
  });
  await logActivity(d, { actor_id: g.user.id, actor_name: g.user.name, action: `criou o contrato ${title}`, entity: 'contracts', entity_id: contract.id });
  revalidateSales([`/clientes/${clientId}`]);
  return { ok: true as const, id: contract.id };
}

export async function updateContractBodyAction(id: string, body: string) {
  const g = await guard(SALES);
  if (!g.ok) return g;
  const d = await db();
  const c = await d.get('contracts', id);
  if (!c) return { ok: false as const, error: 'Contrato não encontrado.' };
  await d.update('contracts', id, { body });
  await logActivity(d, { actor_id: g.user.id, actor_name: g.user.name, action: `editou o texto do contrato ${c.title}`, entity: 'contracts', entity_id: id });
  revalidatePath('/contratos');
  return { ok: true as const };
}

export async function setContractStatusAction(id: string, status: string) {
  const g = await guard(SALES);
  if (!g.ok) return g;
  if (!CONTRACT_STATUSES.includes(status as Contract['status'])) return { ok: false as const, error: 'Status inválido.' };
  const d = await db();
  const c = await d.get('contracts', id);
  if (!c) return { ok: false as const, error: 'Contrato não encontrado.' };
  const to = status as Contract['status'];
  const patch: Partial<Contract> = { status: to };
  if (to === 'assinado' && !c.signed_at) patch.signed_at = new Date().toISOString();
  await d.update('contracts', id, patch);
  if (to === 'assinado' && c.client_id) {
    const client = await d.get('clients', c.client_id);
    if (client && ['lead', 'diagnostico', 'proposta'].includes(client.status)) await d.update('clients', client.id, { status: 'ativo' });
  }
  await logActivity(d, { actor_id: g.user.id, actor_name: g.user.name, action: `marcou o contrato ${c.title} como ${to}`, entity: 'contracts', entity_id: id });
  revalidateSales(c.client_id ? [`/clientes/${c.client_id}`] : []);
  return { ok: true as const };
}
