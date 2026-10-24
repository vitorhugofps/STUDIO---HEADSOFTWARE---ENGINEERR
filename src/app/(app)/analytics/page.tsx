import type { ReactNode } from 'react';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import type { Contract, Deal, Invoice } from '@/lib/db/types';
import { brl, brlCents, cn, num, pct, sum } from '@/lib/utils';
import { Card, Example, PageHeader, Progress, Stat, TD, TH } from '@/components/ui/primitives';
import { AreaTrend, Bars } from '@/components/ui/charts';
import { ExportCsv } from './export-csv';

export const metadata = { title: 'Analytics' };

/** Mesmo fator fixo do Financeiro: estimativa do custo de IA em reais, não é o câmbio do dia. */
const USD_BRL = 5.2;
const FX = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(USD_BRL);

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/* ---------- Datas (sempre no fuso de Brasília, sem depender do servidor) ---------- */
const BR_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
function brParts(dt: Date) {
  const o: Record<string, string> = {};
  for (const p of BR_DAY.formatToParts(dt)) o[p.type] = p.value;
  return o;
}
const todayBR = () => {
  const p = brParts(new Date());
  return `${p.year}-${p.month}-${p.day}`;
};
/** "YYYY-MM" de uma data (YYYY-MM-DD) ou de um timestamp. */
const ymOf = (s?: string | null) => {
  if (!s) return '';
  if (s.length <= 10) return s.slice(0, 7);
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return s.slice(0, 7);
  const p = brParts(dt);
  return `${p.year}-${p.month}`;
};
const monthAdd = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] || '';
const monthShort = (ym: string) => `${MONTHS_SHORT[Number(ym.slice(5, 7)) - 1] || ''}/${ym.slice(2, 4)}`;
const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** Decimal com vírgula para o CSV em português. */
const csvNum = (n: number, digits = 2) => n.toFixed(digits).replace('.', ',');
const noAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function fmtHours(h: number) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${num(h, h < 10 ? 1 : 0)} h`;
  return `${num(h / 24, 1)} dias`;
}

/* ---------- Rótulos ---------- */
const STAGES: [Deal['stage'], string][] = [
  ['lead', 'Lead'],
  ['qualificacao', 'Qualificação'],
  ['diagnostico', 'Diagnóstico'],
  ['proposta', 'Proposta'],
  ['negociacao', 'Negociação'],
  ['fechado', 'Fechado'],
  ['perdido', 'Perdido'],
];
const SOURCE_LABEL: Record<string, string> = {
  indicacao: 'Indicação',
  instagram: 'Instagram',
  prospeccao: 'Prospecção',
  site: 'Site',
  evento: 'Evento',
  cadastro: 'Cadastro',
  outro: 'Outro',
};
const sourceLabel = (s?: string | null) => {
  const k = (s || '').trim();
  if (!k) return 'Sem origem';
  return SOURCE_LABEL[noAccents(k)] || k.charAt(0).toUpperCase() + k.slice(1);
};
const VIDEO_STATUS: [string, string][] = [
  ['rascunho', 'Rascunho'],
  ['roteiro', 'Roteiro'],
  ['edicao', 'Edição'],
  ['revisao', 'Revisão'],
  ['aprovado', 'Aprovado'],
  ['entregue', 'Entregue'],
];
type Kind = Contract['kind'] | 'sem';
const KIND_LABEL: Record<Kind, string> = {
  recorrente: 'Plano mensal',
  projeto: 'Projeto',
  parceria: 'Parceria',
  imagem: 'Cessão de imagem',
  case: 'Autorização de case',
  sem: 'Sem tipo definido',
};
const KIND_SHORT: Record<Kind, string> = { recorrente: 'Mensal', projeto: 'Projeto', parceria: 'Parceria', imagem: 'Imagem', case: 'Case', sem: 'Sem tipo' };

/** Tipo de serviço de uma fatura: pelo contrato ligado; sem contrato, pela descrição; por fim, pelo único contrato do cliente. */
function classify(inv: Invoice, contractById: Map<string, Contract>, contractsByClient: Map<string, Contract[]>): { kind: Kind; by: 'contrato' | 'descricao' | 'cliente' | 'nenhum' } {
  const linked = inv.contract_id ? contractById.get(inv.contract_id) : undefined;
  if (linked) return { kind: linked.kind, by: 'contrato' };
  const t = noAccents(inv.description || '');
  if (/parceria/.test(t)) return { kind: 'parceria', by: 'descricao' };
  if (/mensal|mensalidade|presenca|recorrente/.test(t)) return { kind: 'recorrente', by: 'descricao' };
  if (/parcela|projeto|site|landing|video|marca|sinal|entrega|diaria|captacao/.test(t)) return { kind: 'projeto', by: 'descricao' };
  const own = inv.client_id ? contractsByClient.get(inv.client_id) || [] : [];
  if (own.length === 1) return { kind: own[0].kind, by: 'cliente' };
  return { kind: 'sem', by: 'nenhum' };
}

/* ---------- Peças visuais da página ---------- */
function Panel({ kicker, title, reading, action, className, children }: { kicker?: string; title: ReactNode; reading: ReactNode; action?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <Card className={cn('flex flex-col p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {kicker && <div className="label mb-1">{kicker}</div>}
          <h3 className="display text-xl text-ink">{title}</h3>
        </div>
        {action}
      </div>
      <p className="mt-2 text-sm text-ink2">{reading}</p>
      {children && <div className="mt-4 flex-1">{children}</div>}
    </Card>
  );
}

/** Lista ordenada com barra proporcional ao maior valor. Boa para rótulos longos e valores pequenos. */
function RankBars({ items, format, empty, scale }: { items: { label: string; value: number; hint?: string }[]; format: (v: number) => string; empty: string; scale?: number }) {
  if (items.length === 0) return <p className="text-sm text-ink3">{empty}</p>;
  const max = scale ?? Math.max(...items.map((i) => i.value), 0);
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink">{i.label}</span>
            <span className="num shrink-0 text-ink2">
              {format(i.value)}
              {i.hint && <span className="ml-2 text-xs text-ink3">{i.hint}</span>}
            </span>
          </div>
          <Progress value={max > 0 ? (i.value / max) * 100 : 0} />
        </li>
      ))}
    </ul>
  );
}

function Group({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <div className="label mb-1">{kicker}</div>
        <h2 className="display text-2xl text-ink">{title}</h2>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

const NoData = ({ children }: { children: ReactNode }) => <p className="text-sm text-ink3">{children}</p>;

export default async function AnalyticsPage() {
  await requireRole(['admin', 'comercial', 'developer']);
  const d = await db();
  const [invoices, contracts, clients, deals, quotes, batches, approvals, contentItems, videos, campaigns, metrics, runs] = await Promise.all([
    d.list('invoices'),
    d.list('contracts'),
    d.list('clients'),
    d.list('deals'),
    d.list('quotes'),
    d.list('approval_batches'),
    d.list('approvals'),
    d.list('content_items'),
    d.list('video_projects'),
    d.list('campaigns'),
    d.list('campaign_metrics_daily'),
    d.list('agent_runs'),
  ]);

  const today = todayBR();
  const ym = today.slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => monthAdd(ym, i - 5));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const clientName = (id?: string | null) => {
    const c = id ? clientById.get(id) : undefined;
    return c ? c.company || c.contact_name : '';
  };

  /* ---------- Receita ---------- */
  const paidInv = invoices.filter((i) => i.status === 'paga');
  const revByMonth = months.map((m) => ({ key: m, label: monthShort(m), receita: sum(paidInv.filter((i) => ymOf(i.paid_at || i.due_on) === m), (i) => i.amount) }));
  const revenue6 = sum(revByMonth, (b) => b.receita);
  const bestMonth = revByMonth.reduce((a, b) => (b.receita > a.receita ? b : a), revByMonth[0]);

  const revByClient = new Map<string, { value: number; count: number }>();
  for (const i of paidInv) {
    const k = i.client_id || '';
    const cur = revByClient.get(k) || { value: 0, count: 0 };
    cur.value += Number(i.amount) || 0;
    cur.count += 1;
    revByClient.set(k, cur);
  }
  const clientRows = [...revByClient.entries()]
    .map(([id, v]) => ({ id, label: id ? clientName(id) || 'Cliente removido' : 'Sem cliente', value: v.value, count: v.count }))
    .sort((a, b) => b.value - a.value);
  const revenueAll = sum(clientRows, (r) => r.value);
  const TOP = 8;
  const clientBars = [
    ...clientRows.slice(0, TOP).map((r) => ({ label: r.label, value: r.value, hint: revenueAll > 0 ? pct(r.value / revenueAll, 0) : '' })),
    ...(clientRows.length > TOP ? [{ label: `Outros ${clientRows.length - TOP} clientes`, value: sum(clientRows.slice(TOP), (r) => r.value), hint: revenueAll > 0 ? pct(sum(clientRows.slice(TOP), (r) => r.value) / revenueAll, 0) : '' }] : []),
  ];
  const csvRows: string[][] = [
    ['Cliente', 'Faturas pagas', 'Receita recebida (R$)', 'Participação (%)'],
    ...clientRows.map((r) => [r.label, String(r.count), csvNum(r.value), csvNum(revenueAll > 0 ? (r.value / revenueAll) * 100 : 0, 1)]),
  ];

  const contractById = new Map(contracts.map((c) => [c.id, c]));
  const contractsByClient = new Map<string, Contract[]>();
  for (const c of contracts) if (c.client_id) contractsByClient.set(c.client_id, [...(contractsByClient.get(c.client_id) || []), c]);
  const byKind = new Map<Kind, number>();
  let inferred = 0;
  for (const i of paidInv) {
    const k = classify(i, contractById, contractsByClient);
    if (k.by !== 'contrato') inferred += 1;
    byKind.set(k.kind, (byKind.get(k.kind) || 0) + (Number(i.amount) || 0));
  }
  const kindRows = [...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([kind, value]) => ({ kind, label: KIND_SHORT[kind], receita: value }));

  /* ---------- Comercial ---------- */
  const stageData = STAGES.map(([id, label]) => ({ label, negociacoes: deals.filter((x) => x.stage === id).length }));
  const quoteDealIds = new Set(quotes.map((q) => q.deal_id).filter(Boolean));
  const quoteClientIds = new Set(quotes.map((q) => q.client_id).filter(Boolean));
  const reached = deals.filter(
    (x) => x.stage === 'proposta' || x.stage === 'negociacao' || x.stage === 'fechado' || (x.stage === 'perdido' && (quoteDealIds.has(x.id) || (x.client_id ? quoteClientIds.has(x.client_id) : false))),
  );
  const won = reached.filter((x) => x.stage === 'fechado');
  const conversion = reached.length > 0 ? won.length / reached.length : null;
  const quotesSent = quotes.filter((q) => q.status !== 'rascunho');
  const quotesAccepted = quotes.filter((q) => q.status === 'aceita');

  const bySource = new Map<string, { count: number; value: number }>();
  for (const x of deals) {
    const k = sourceLabel(x.source);
    const cur = bySource.get(k) || { count: 0, value: 0 };
    cur.count += 1;
    cur.value += Number(x.value) || 0;
    bySource.set(k, cur);
  }
  const sourceRows = [...bySource.entries()].map(([label, v]) => ({ label, negociacoes: v.count, valor: v.value })).sort((a, b) => b.negociacoes - a.negociacoes || b.valor - a.valor);

  /* ---------- Produção ---------- */
  const piecesByMonth = months.map((m) => ({ key: m, label: monthShort(m), pecas: contentItems.filter((c) => ymOf(c.created_at) === m).length }));
  const pieces6 = sum(piecesByMonth, (p) => p.pecas);
  const piecesNow = piecesByMonth[piecesByMonth.length - 1].pecas;
  const piecesPublished = contentItems.filter((c) => c.status === 'publicado').length;
  const videoData = VIDEO_STATUS.map(([id, label]) => ({ label, videos: videos.filter((v) => v.status === id).length }));
  const videosDelivered = videos.filter((v) => v.status === 'entregue').length;

  // Tempo de aprovação: do envio do lote até a primeira decisão do cliente (o registro da decisão usa created_at).
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const firstDecision = new Map<string, number>();
  for (const a of approvals) {
    const t = Date.parse(a.created_at);
    if (Number.isNaN(t)) continue;
    const prev = firstDecision.get(a.batch_id);
    if (prev === undefined || t < prev) firstDecision.set(a.batch_id, t);
  }
  const spans: number[] = [];
  for (const [batchId, t] of firstDecision) {
    const b = batchById.get(batchId);
    const t0 = b ? Date.parse(b.created_at) : NaN;
    if (!Number.isNaN(t0) && t >= t0) spans.push((t - t0) / 3600000);
  }
  const approvalHours = spans.length ? sum(spans, (h) => h) / spans.length : null;

  /* ---------- Mídia ---------- */
  const spendTotal = sum(metrics, (m) => m.spend);
  const resultsTotal = sum(metrics, (m) => m.results);
  const costPerResult = resultsTotal > 0 ? spendTotal / resultsTotal : null;
  const campById = new Map(campaigns.map((c) => [c.id, c]));
  const perCampaign = new Map<string, { spend: number; results: number }>();
  for (const m of metrics) {
    const cur = perCampaign.get(m.campaign_id) || { spend: 0, results: 0 };
    cur.spend += Number(m.spend) || 0;
    cur.results += Number(m.results) || 0;
    perCampaign.set(m.campaign_id, cur);
  }
  const campaignRows = [...perCampaign.entries()]
    .map(([id, v]) => {
      const c = campById.get(id);
      return { id, name: c?.name || 'Campanha removida', client: clientName(c?.client_id), spend: v.spend, results: v.results, cpr: v.results > 0 ? v.spend / v.results : null };
    })
    .sort((a, b) => b.spend - a.spend);
  const lastMetricDay = metrics.reduce((mx, m) => (m.day.slice(0, 10) > mx ? m.day.slice(0, 10) : mx), '');
  const dailySpend: { label: string; gasto: number }[] = [];
  if (lastMetricDay) {
    const [y, mo, da] = lastMetricDay.split('-').map(Number);
    for (let n = 29; n >= 0; n--) {
      const iso = new Date(Date.UTC(y, mo - 1, da - n)).toISOString().slice(0, 10);
      dailySpend.push({ label: dayMonth(iso), gasto: sum(metrics.filter((m) => m.day.slice(0, 10) === iso), (m) => m.spend) });
    }
  }

  /* ---------- IA e clientes ---------- */
  const aiByModule = new Map<string, { usd: number; runs: number }>();
  for (const r of runs) {
    const mod = (r.agent || 'Sem módulo').split('·')[0].trim() || 'Sem módulo';
    const cur = aiByModule.get(mod) || { usd: 0, runs: 0 };
    cur.usd += Number(r.cost_usd) || 0;
    cur.runs += 1;
    aiByModule.set(mod, cur);
  }
  const aiRows = [...aiByModule.entries()].map(([label, v]) => ({ label, brl: v.usd * USD_BRL, runs: v.runs })).sort((a, b) => b.brl - a.brl || b.runs - a.runs);
  const aiTotalBrl = sum(aiRows, (r) => r.brl);
  const aiExamples = runs.filter((r) => r.status === 'exemplo').length;
  const aiOnlyExamples = runs.length > 0 && aiExamples === runs.length;

  const measured = clients.filter((c) => c.maturity_index != null);
  const maturityAvg = measured.length ? sum(measured, (c) => c.maturity_index || 0) / measured.length : null;
  const maturityRows = measured
    .map((c) => ({ label: c.company || c.contact_name, value: Number(c.maturity_index) || 0 }))
    .sort((a, b) => b.value - a.value);

  const openDeals = deals.filter((x) => x.stage !== 'fechado' && x.stage !== 'perdido').length;
  const wonDeals = deals.filter((x) => x.stage === 'fechado').length;
  const lostDeals = deals.filter((x) => x.stage === 'perdido').length;
  const topSource = sourceRows[0];
  const topKind = kindRows[0];
  const topAi = aiRows[0];

  return (
    <div className="space-y-10">
      <PageHeader
        kicker="Negócio"
        title={
          <>
            Analytics <em>do Studio</em>
          </>
        }
        subtitle="Cada número sai direto das faturas, negociações, peças, campanhas e execuções de IA registradas. O que é estimativa vem dito na própria seção."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat accent label="Receita em 6 meses" value={brl(revenue6)} hint={revenue6 > 0 ? `média de ${brl(revenue6 / 6)} por mês` : 'nenhuma fatura paga no período'} />
        <Stat
          label="Proposta → fechado"
          value={conversion === null ? <span className="text-2xl text-ink3">sem base</span> : pct(conversion, 0)}
          hint={reached.length > 0 ? `${won.length} de ${reached.length} ${plural(reached.length, 'negociação', 'negociações')}` : 'nenhuma negociação chegou a proposta'}
        />
        <Stat
          label="Gasto em campanhas"
          value={brl(spendTotal)}
          hint={costPerResult !== null ? `${brlCents(costPerResult)} por resultado` : metrics.length ? 'sem resultados registrados' : 'nenhuma métrica registrada'}
        />
        <Stat
          label="Maturidade média"
          value={maturityAvg === null ? <span className="text-2xl text-ink3">sem dados</span> : num(maturityAvg, 0)}
          hint={measured.length ? `${measured.length} ${plural(measured.length, 'cliente medido', 'clientes medidos')} · escala de 0 a 100` : 'nenhum cliente medido'}
        />
      </div>

      <Group kicker="Financeiro" title="Receita">
        <Panel
          title="Receita por mês"
          reading={revenue6 > 0 ? `${brl(revenue6)} recebidos em 6 meses (média de ${brl(revenue6 / 6)} por mês), com pico em ${monthName(bestMonth.key)}: ${brl(bestMonth.receita)}.` : 'Nenhuma fatura paga nos últimos 6 meses.'}
        >
          <Bars data={revByMonth} xKey="label" yKey="receita" money highlightLast name="Receita" height={220} />
        </Panel>

        <Panel
          title="Receita por tipo de serviço"
          reading={
            topKind && revenueAll > 0
              ? `${KIND_LABEL[topKind.kind]} lidera com ${brl(topKind.receita)} (${pct(topKind.receita / revenueAll, 0)} do recebido)${
                  inferred > 0 ? `; ${inferred} de ${paidInv.length} ${plural(paidInv.length, 'fatura paga', 'faturas pagas')} sem contrato ligado foram classificadas pela descrição ou pelo contrato do cliente` : ''
                }.`
              : 'Nenhuma fatura paga ainda.'
          }
        >
          {kindRows.length > 0 ? <Bars data={kindRows} xKey="label" yKey="receita" money name="Receita" height={220} /> : <NoData>Sem faturas pagas para classificar.</NoData>}
        </Panel>

        <Panel
          className="lg:col-span-2"
          title="Receita por cliente"
          reading={
            clientRows.length > 0 && revenueAll > 0
              ? `${clientRows[0].label} responde por ${pct(clientRows[0].value / revenueAll, 0)} de tudo que foi recebido (${brl(clientRows[0].value)} de ${brl(revenueAll)})${clientRows[0].value / revenueAll >= 0.5 ? ', mais da metade num só cliente' : ''}.`
              : 'Nenhuma fatura paga ainda.'
          }
          action={<ExportCsv filename={`receita-por-cliente-${today}.csv`} rows={csvRows} />}
        >
          <RankBars items={clientBars} format={brl} empty="Nenhuma fatura paga ainda." />
        </Panel>
      </Group>

      <Group kicker="Vendas" title="Comercial">
        <Panel
          className="lg:col-span-2"
          title="Funil comercial"
          reading={
            deals.length > 0
              ? `${deals.length} ${plural(deals.length, 'negociação', 'negociações')} no total: ${openDeals} em aberto, ${wonDeals} ${plural(wonDeals, 'fechada', 'fechadas')} e ${lostDeals} ${plural(lostDeals, 'perdida', 'perdidas')}.`
              : 'Nenhuma negociação cadastrada.'
          }
        >
          {deals.length > 0 ? <Bars data={stageData} xKey="label" yKey="negociacoes" name="Negociações" height={230} /> : <NoData>Crie negociações em Vendas para ver o funil.</NoData>}
        </Panel>

        <Panel
          title="Origem dos leads"
          reading={
            topSource && deals.length > 0
              ? `${topSource.label} traz ${topSource.negociacoes} de ${deals.length} ${plural(deals.length, 'negociação', 'negociações')} (${pct(topSource.negociacoes / deals.length, 0)}) e ${brl(topSource.valor)} em valor.`
              : 'Nenhuma negociação cadastrada.'
          }
        >
          {sourceRows.length > 0 ? <Bars data={sourceRows} xKey="label" yKey="negociacoes" name="Negociações" height={200} /> : <NoData>Sem origens registradas.</NoData>}
        </Panel>

        <Panel
          title="Conversão proposta → fechado"
          reading={
            conversion === null
              ? 'Nenhuma negociação chegou a proposta ainda.'
              : `${won.length} de ${reached.length} ${plural(reached.length, 'negociação que chegou', 'negociações que chegaram')} a proposta ${plural(won.length, 'foi fechada', 'foram fechadas')}.`
          }
        >
          <div className="num text-[56px] leading-none text-ink">{conversion === null ? <span className="text-2xl text-ink3">sem base</span> : pct(conversion, 0)}</div>
          <dl className="mt-5 divide-y divide-white/[0.07] text-sm">
            <div className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-ink2">Chegaram a proposta</dt>
              <dd className="num text-ink">{reached.length}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-ink2">Fechadas</dt>
              <dd className="num text-ink">{won.length}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-ink2">Propostas aceitas</dt>
              <dd className="num text-ink">
                {quotesAccepted.length} de {quotesSent.length} {plural(quotesSent.length, 'enviada', 'enviadas')}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink3">Conta proposta, negociação e fechado, mais as perdidas que tinham proposta emitida. Não há histórico de etapas: vale a etapa de hoje.</p>
        </Panel>
      </Group>

      <Group kicker="Conteúdo, vídeo e tráfego" title="Marketing">
        <Panel
          title="Peças por mês"
          reading={
            pieces6 > 0
              ? `${pieces6} ${plural(pieces6, 'peça criada', 'peças criadas')} em 6 meses, ${piecesNow} em ${monthName(ym)}; ${piecesPublished} ${plural(piecesPublished, 'já publicada', 'já publicadas')}.`
              : 'Nenhuma peça criada nos últimos 6 meses.'
          }
        >
          <Bars data={piecesByMonth} xKey="label" yKey="pecas" highlightLast name="Peças" height={200} />
        </Panel>

        <Panel
          title="Vídeos por status"
          reading={videos.length > 0 ? `${videos.length} ${plural(videos.length, 'vídeo', 'vídeos')} nos projetos, ${videosDelivered} ${plural(videosDelivered, 'entregue', 'entregues')}.` : 'Nenhum vídeo cadastrado.'}
        >
          {videos.length > 0 ? <Bars data={videoData} xKey="label" yKey="videos" name="Vídeos" height={200} /> : <NoData>Crie vídeos em Marketing para acompanhar o fluxo.</NoData>}
        </Panel>

        <Panel
          className="lg:col-span-2"
          title="Campanhas"
          reading={
            metrics.length === 0
              ? 'Nenhuma métrica de campanha registrada ainda.'
              : costPerResult !== null
                ? `${brl(spendTotal)} investidos em ${perCampaign.size} ${plural(perCampaign.size, 'campanha', 'campanhas')}, com ${num(resultsTotal)} resultados e custo médio de ${brlCents(costPerResult)} por resultado.`
                : `${brl(spendTotal)} investidos em ${perCampaign.size} ${plural(perCampaign.size, 'campanha', 'campanhas')}, ainda sem resultados registrados.`
          }
        >
          {metrics.length > 0 ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <div className="label mb-2">Gasto por dia · 30 dias até {dayMonth(lastMetricDay)}</div>
                <AreaTrend data={dailySpend} xKey="label" yKey="gasto" money name="Gasto" height={200} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <TH className="px-0">Campanha</TH>
                      <TH className="text-right">Gasto</TH>
                      <TH className="text-right">Resultados</TH>
                      <TH className="px-0 text-right">Por resultado</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignRows.map((c) => (
                      <tr key={c.id}>
                        <TD className="px-0">
                          <div className="text-ink">{c.name}</div>
                          {c.client && <div className="text-xs text-ink3">{c.client}</div>}
                        </TD>
                        <TD className="num text-right">{brl(c.spend)}</TD>
                        <TD className="num text-right">{num(c.results)}</TD>
                        <TD className="num px-0 text-right">{c.cpr === null ? <span className="text-xs text-ink3">sem resultados</span> : brlCents(c.cpr)}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-ink3">Custo por resultado = gasto total ÷ resultados totais, não a média dos custos diários.</p>
              </div>
            </div>
          ) : (
            <NoData>As métricas entram quando a conta de anúncios estiver conectada e uma campanha rodar.</NoData>
          )}
        </Panel>
      </Group>

      <Group kicker="Relacionamento e custo" title="Clientes e IA">
        <Panel
          title="Tempo médio de aprovação"
          reading={
            approvalHours === null
              ? `Sem dados suficientes: ${batches.length} ${plural(batches.length, 'lote enviado', 'lotes enviados')}, nenhum com decisão do cliente registrada.`
              : `Os clientes levam em média ${fmtHours(approvalHours)} entre o envio de um lote e a primeira decisão (${spans.length} ${plural(spans.length, 'lote', 'lotes')}${spans.length < 3 ? ', base pequena' : ''}).`
          }
        >
          {approvalHours === null ? <div className="num text-2xl text-ink3">sem dados suficientes</div> : <div className="num text-[56px] leading-none text-ink">{fmtHours(approvalHours)}</div>}
          <dl className="mt-5 divide-y divide-white/[0.07] text-sm">
            <div className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-ink2">Lotes enviados</dt>
              <dd className="num text-ink">{batches.length}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-ink2">Com decisão do cliente</dt>
              <dd className="num text-ink">{spans.length}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink3">Mede do envio do lote até o primeiro registro de aprovação ou ajuste.</p>
        </Panel>

        <Panel
          title="Maturidade digital dos clientes"
          reading={
            maturityAvg === null
              ? 'Nenhum cliente com índice de maturidade medido.'
              : `Média de ${num(maturityAvg, 0)} em 100, medida em ${measured.length} ${plural(measured.length, 'cliente', 'clientes')}.`
          }
        >
          <RankBars items={maturityRows.slice(0, 8).map((r) => ({ label: r.label, value: r.value }))} format={(v) => num(v)} scale={100} empty="O índice sai do questionário de diagnóstico do cliente." />
          {maturityRows.length > 8 && <p className="mt-3 text-xs text-ink3">e mais {maturityRows.length - 8} {plural(maturityRows.length - 8, 'cliente', 'clientes')}</p>}
        </Panel>

        <Panel
          className="lg:col-span-2"
          title={
            <>
              Custo de IA por módulo <Example show={aiOnlyExamples} />
            </>
          }
          reading={
            runs.length === 0
              ? 'Nenhuma execução de IA registrada ainda.'
              : aiTotalBrl > 0 && topAi
                ? `${brlCents(aiTotalBrl)} em ${runs.length} ${plural(runs.length, 'execução', 'execuções')}; ${topAi.label} é o módulo mais caro, com ${pct(topAi.brl / aiTotalBrl, 0)} do total.`
                : `${runs.length} ${plural(runs.length, 'execução registrada', 'execuções registradas')}, ${aiOnlyExamples ? 'todas em modo exemplo' : 'sem custo registrado'}.`
          }
        >
          <RankBars
            items={aiRows.map((r) => ({ label: r.label, value: r.brl, hint: `${r.runs} ${plural(r.runs, 'execução', 'execuções')}` }))}
            format={brlCents}
            empty="Cada geração de proposta, diagnóstico, feed ou relatório aparece aqui."
          />
          {aiRows.length > 0 && <p className="mt-4 text-xs text-ink3">Dólar do registro × {FX}: estimativa, não é o câmbio do dia. O módulo é a primeira parte do nome do agente.</p>}
        </Panel>
      </Group>
    </div>
  );
}
