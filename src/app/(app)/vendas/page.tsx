import Link from 'next/link';
import { ArrowLeft, CalendarClock, FileSignature, FileText, Flame, Plus, Settings, Sparkles, Target, Trophy } from 'lucide-react';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasAIKey } from '@/lib/ai/claude';
import { STUDIO_DEFAULTS, readConfig } from '@/lib/config';
import type { Client, Deal, Quote, Service } from '@/lib/db/types';
import { brl, cn, fmtDate, num, sum } from '@/lib/utils';
import { Badge, Button, Card, EmptyState, Example, Field, Input, PageHeader, PillTabs, Progress, Select, Stat, Table, TD, TH, type Tone } from '@/components/ui/primitives';
import { ActionButton, ActionForm, CopyButton, SubmitButton } from '@/components/ui/client';
import { acceptQuoteAction, createDealAction, setQuoteStatusAction, type QuoteOption, type QuoteStage } from '@/lib/actions/sales';
import { PipelineBoard, type DealVM } from './pipeline';
import { PrintButton, QuoteGenerator } from './quote-tools';

export const metadata = { title: 'Vendas' };

type SP = { t?: string; q?: string; cliente?: string; nova?: string };
const TAB_KEYS = ['pipeline', 'propostas', 'catalogo', 'metas'] as const;
type TabKey = (typeof TAB_KEYS)[number];

const STAGES: [Deal['stage'], string][] = [
  ['lead', 'Lead'],
  ['qualificacao', 'Qualificação'],
  ['diagnostico', 'Diagnóstico'],
  ['proposta', 'Proposta'],
  ['negociacao', 'Negociação'],
  ['fechado', 'Fechado'],
  ['perdido', 'Perdido'],
];

const SOURCES: [string, string][] = [
  ['indicacao', 'Indicação'],
  ['instagram', 'Instagram'],
  ['prospeccao', 'Prospecção'],
  ['site', 'Site'],
  ['evento', 'Evento'],
  ['cadastro', 'Cadastro'],
  ['outro', 'Outro'],
];

const QUOTE_TONE: Record<Quote['status'], Tone> = { rascunho: 'neutral', enviada: 'accent', vista: 'info', aceita: 'ok', recusada: 'err', expirada: 'warn' };
const QUOTE_LABEL: Record<Quote['status'], string> = { rascunho: 'Rascunho', enviada: 'Enviada', vista: 'Vista', aceita: 'Aceita', recusada: 'Recusada', expirada: 'Expirada' };
const OPEN_QUOTE: Quote['status'][] = ['rascunho', 'enviada', 'vista'];

/* Datas "YYYY-MM-DD" viram meio-dia em Brasília: fmtDate sozinho mostraria o dia anterior por causa do fuso. */
const asDate = (s: string) => (s.length <= 10 ? `${s}T12:00:00-03:00` : s);
const day = (s?: string | null) => (s ? fmtDate(asDate(s)) : '');
const dayY = (s?: string | null) => (s ? fmtDate(asDate(s), { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const dayLong = (s?: string | null) => (s ? fmtDate(asDate(s), { day: 'numeric', month: 'long', year: 'numeric' }) : '');

/* Hoje e mês sempre no fuso de Brasília: o todayISO e o monthKey de utils dependem de UTC/servidor e viram o dia 3 horas antes da meia-noite daqui. */
const BR_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
function brParts(dt: Date) {
  const o: Record<string, string> = {};
  for (const p of BR_DAY.formatToParts(dt)) o[p.type] = p.value;
  return o;
}
const todayISO = () => {
  const p = brParts(new Date());
  return `${p.year}-${p.month}-${p.day}`;
};
const ymOf = (s: string) => {
  if (s.length <= 10) return s.slice(0, 7);
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return s.slice(0, 7);
  const p = brParts(dt);
  return `${p.year}-${p.month}`;
};

const PRINT_CSS = `@media print{.app-main{padding-left:0!important;padding-right:0!important}main{padding:0!important}@page{margin:14mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

export default async function VendasPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireRole(['admin', 'comercial']);
  const sp = await searchParams;
  const d = await db();

  const tab: TabKey = (TAB_KEYS as readonly string[]).includes(sp.t || '') ? (sp.t as TabKey) : sp.cliente ? 'propostas' : 'pipeline';
  const [clients, deals, quotes, profiles] = await Promise.all([d.list('clients', { orderBy: 'company' }), d.list('deals', { orderBy: 'created_at', desc: true }), d.list('quotes', { orderBy: 'number', desc: true }), d.list('profiles')]);
  const preClient = clients.find((c) => c.id === sp.cliente)?.id || '';
  const qs = preClient ? `&cliente=${preClient}` : '';
  const openForm = Boolean(sp.nova || preClient);

  const open = deals.filter((x) => x.stage !== 'fechado' && x.stage !== 'perdido');
  const weighted = sum(open, (x) => (x.value || 0) * ((x.probability || 0) / 100));

  const tabs = [
    { href: `/vendas?t=pipeline${qs}`, label: 'Pipeline', count: open.length },
    { href: `/vendas?t=propostas${qs}`, label: 'Propostas', count: quotes.length },
    { href: `/vendas?t=catalogo${qs}`, label: 'Catálogo' },
    { href: `/vendas?t=metas${qs}`, label: 'Metas' },
  ];

  const quote = tab === 'propostas' && sp.q ? quotes.find((x) => x.id === sp.q) || null : null;
  const inDetail = tab === 'propostas' && Boolean(sp.q);

  const actions =
    tab === 'pipeline' ? (
      <Button href={`/vendas?t=pipeline&nova=1${qs}#nova`}>
        <Plus className="h-4 w-4" /> Nova negociação
      </Button>
    ) : tab === 'propostas' && !inDetail ? (
      <Button href={`/vendas?t=propostas&nova=1${qs}#nova`}>
        <Sparkles className="h-4 w-4" /> Nova proposta com IA
      </Button>
    ) : tab === 'catalogo' ? (
      <Button href="/settings" variant="subtle">
        <Settings className="h-4 w-4" /> Editar no Settings
      </Button>
    ) : undefined;

  return (
    <div>
      <style>{PRINT_CSS}</style>
      <div className="no-print">
        <PageHeader
          kicker="Negócio"
          title={
            <>
              Vendas <em>{open.length} em aberto</em>
            </>
          }
          subtitle="Do lead à proposta aceita. Aceitar uma proposta já abre o contrato e as faturas."
          actions={actions}
        />
        <PillTabs tabs={tabs} current={`/vendas?t=${tab}${qs}`} className="mb-6" />
      </div>

      {tab === 'pipeline' && <PipelineTab deals={deals} open={open} weighted={weighted} clients={clients} profiles={profiles} openForm={openForm} preClient={preClient} />}

      {tab === 'propostas' &&
        (inDetail ? (
          quote ? (
            <QuoteDetail quote={quote} client={clients.find((c) => c.id === quote.client_id) || null} contract={(await d.list('contracts', { where: { quote_id: quote.id } }))[0] || null} />
          ) : (
            <EmptyState icon={<FileText className="h-5 w-5" />} title="Proposta não encontrada" text="O link pode ter sido apagado." action={<Button href={`/vendas?t=propostas${qs}`}>Voltar às propostas</Button>} />
          )
        ) : (
          <QuotesTab quotes={quotes} clients={clients} preClient={preClient} openForm={openForm} aiEnabled={hasAIKey()} />
        ))}

      {tab === 'catalogo' && <CatalogTab services={await d.list('services_catalog', { orderBy: 'base_price' })} />}

      {tab === 'metas' && <GoalsTab deals={deals} quotes={quotes} />}
    </div>
  );
}

/* =====================================================================
 * PIPELINE
 * ===================================================================== */
function PipelineTab({ deals, open, weighted, clients, profiles, openForm, preClient }: { deals: Deal[]; open: Deal[]; weighted: number; clients: Client[]; profiles: { id: string; full_name: string }[]; openForm: boolean; preClient: string }) {
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const ownerById = new Map(profiles.map((p) => [p.id, p.full_name]));
  const now = Date.now();
  const thisMonth = todayISO().slice(0, 7);
  const isOpen = (x: Deal) => x.stage !== 'fechado' && x.stage !== 'perdido';
  const lateOf = (x: Deal) => isOpen(x) && !!x.next_action_at && new Date(x.next_action_at).getTime() < now;
  const won = deals.filter((x) => x.stage === 'fechado' && ymOf(x.updated_at || x.created_at) === thisMonth);
  const late = deals.filter(lateOf);

  const vms: DealVM[] = deals.map((x) => {
    const c = x.client_id ? clientById.get(x.client_id) : undefined;
    return {
      id: x.id,
      stage: x.stage,
      title: x.title,
      clientId: c?.id ?? null,
      clientName: c ? c.company || c.contact_name : null,
      clientColor: c?.brand_color ?? null,
      valueLabel: x.value ? brl(x.value) : 'sem valor',
      probability: Math.round(x.probability ?? 0),
      nextLabel: isOpen(x) && x.next_action_at ? day(x.next_action_at) : null,
      late: lateOf(x),
      ownerName: (x.owner_id && ownerById.get(x.owner_id)?.split(' ')[0]) || null,
    };
  });

  const columns = STAGES.map(([id, label]) => {
    const inCol = deals.filter((x) => x.stage === id);
    const total = sum(inCol, (x) => x.value || 0);
    return { id, label, hint: inCol.length ? (total ? brl(total) : 'sem valor') : undefined };
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pipeline ponderado" value={brl(weighted)} hint={`bruto ${brl(sum(open, (x) => x.value || 0))}`} icon={<Flame className="h-4 w-4" />} accent />
        <Stat label="Negociações abertas" value={open.length} hint={`${deals.length} no total`} icon={<Target className="h-4 w-4" />} />
        <Stat label="Fechado no mês" value={brl(sum(won, (x) => x.value || 0))} hint={`${won.length} ${won.length === 1 ? 'negociação' : 'negociações'}`} icon={<Trophy className="h-4 w-4" />} />
        <Stat label="Próximas ações atrasadas" value={late.length} hint={late[0] ? late[0].title : 'Nenhuma atrasada'} icon={<CalendarClock className="h-4 w-4" />} />
      </div>

      <details id="nova" open={openForm} className="card group p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="label block">Nova negociação</span>
            <span className="text-sm text-ink2">Entra na coluna Lead. Arraste o card para avançar de etapa.</span>
          </span>
          <Plus className="h-4 w-4 text-ink2 transition-transform group-open:rotate-45" />
        </summary>
        <ActionForm action={createDealAction} success="Negociação criada" resetOnSuccess className="mt-4 grid gap-3 md:grid-cols-6">
          <Field label="Título" required className="md:col-span-2">
            <Input name="title" required placeholder="Ex.: Clínica Inti · marca pessoal" />
          </Field>
          <Field label="Cliente" className="md:col-span-2">
            <Select name="client_id" defaultValue={preClient}>
              <option value="">Sem cliente ainda</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company || c.contact_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Valor (R$)">
            <Input name="value" inputMode="decimal" placeholder="0" />
          </Field>
          <Field label="Probabilidade (%)">
            <Input name="probability" type="number" min={0} max={100} defaultValue={15} />
          </Field>
          <Field label="Origem" className="md:col-span-2">
            <Select name="source" defaultValue="">
              <option value="">Não informada</option>
              {SOURCES.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Próxima ação" className="md:col-span-2">
            <Input type="date" name="next_action_at" />
          </Field>
          <div className="flex items-end md:col-span-2">
            <SubmitButton className="w-full md:w-auto">Criar negociação</SubmitButton>
          </div>
        </ActionForm>
      </details>

      {deals.length === 0 ? (
        <EmptyState icon={<Target className="h-5 w-5" />} title="Pipeline vazio" text="Abra a primeira negociação acima ou cadastre um cliente novo: ele já entra aqui como lead." />
      ) : (
        <PipelineBoard deals={vms} columns={columns} />
      )}
    </div>
  );
}

/* =====================================================================
 * PROPOSTAS: lista
 * ===================================================================== */
function QuotesTab({ quotes, clients, preClient, openForm, aiEnabled }: { quotes: Quote[]; clients: Client[]; preClient: string; openForm: boolean; aiEnabled: boolean }) {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const today = todayISO();
  const pending = quotes.filter((q) => OPEN_QUOTE.includes(q.status));
  const options = clients.map((c) => ({ id: c.id, name: c.company || c.contact_name }));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        {quotes.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="Nenhuma proposta ainda"
            text="A IA lê o cliente, o diagnóstico e o catálogo e monta 3 opções: Ponto, Temporada e Impacto 360."
            action={<Button href="/vendas?t=propostas&nova=1#nova">Nova proposta com IA</Button>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>Número</TH>
                <TH>Cliente</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Mensal</TH>
                <TH>Validade</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const c = q.client_id ? byId.get(q.client_id) : undefined;
                const expired = !!q.valid_until && q.valid_until < today && OPEN_QUOTE.includes(q.status);
                return (
                  <tr key={q.id} className="group transition-colors hover:bg-white/[0.03]">
                    <TD>
                      <Link href={`/vendas?t=propostas&q=${q.id}`} className="num text-base text-ink group-hover:text-accent">
                        {q.number}
                      </Link>
                      <Example show={Boolean((q.data as { is_example?: boolean } | null)?.is_example)} />
                    </TD>
                    <TD>
                      <span className="block font-medium text-ink">{c ? c.company || c.contact_name : String((q.data as { empresa?: string } | null)?.empresa || 'Sem cliente')}</span>
                      {c?.segment && <span className="block text-xs text-ink3">{c.segment}</span>}
                    </TD>
                    <TD className="num text-right text-base">{q.total ? brl(q.total) : <span className="text-xs font-normal text-ink3">sem projeto</span>}</TD>
                    <TD className="num text-right text-base">{q.monthly ? `${brl(q.monthly)}/mês` : <span className="text-xs font-normal text-ink3">sem mensal</span>}</TD>
                    <TD className="text-ink2">
                      {dayY(q.valid_until)}
                      {expired && <span className="ml-2 text-xs text-err">vencida</span>}
                    </TD>
                    <TD>
                      <Badge tone={QUOTE_TONE[q.status]}>{QUOTE_LABEL[q.status]}</Badge>
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>

      <div className="space-y-4">
        <details id="nova" open={openForm || quotes.length === 0} className="card group p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="label block">Nova proposta com IA</span>
              <span className="text-sm text-ink2">3 opções, cronograma e condições do Studio.</span>
            </span>
            <Sparkles className="h-4 w-4 text-accent" />
          </summary>
          <div className="mt-4">
            <QuoteGenerator clients={options} defaultClientId={preClient} aiEnabled={aiEnabled} />
          </div>
        </details>

        <Card className="p-5">
          <div className="label mb-3">Em aberto</div>
          <div className="num text-[34px] text-ink">{pending.length}</div>
          <div className="mt-2 text-xs text-ink2">
            {pending.length
              ? `${brl(sum(pending, (q) => q.total || 0))} em projetos e ${brl(sum(pending, (q) => q.monthly || 0))}/mês em planos, somando a opção recomendada de cada uma.`
              : 'Nenhuma proposta aguardando resposta.'}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* =====================================================================
 * PROPOSTAS: detalhe, no padrão do Studio
 * ===================================================================== */
type Studio = typeof STUDIO_DEFAULTS;

function studioInfo(): Studio {
  const saved = Object.fromEntries(Object.entries(readConfig().studio || {}).filter(([, v]) => v));
  return { ...STUDIO_DEFAULTS, ...saved } as Studio;
}

type QuoteVM = {
  empresa: string;
  contato: string;
  cidade: string | null;
  emitida: string;
  valid: string | null;
  ponto: string[];
  opcoes: QuoteOption[];
  cronograma: QuoteStage[];
  condicoes: string[];
  naoIncluso: string[];
  legacy: boolean;
  example: boolean;
  aceita: string | null;
  aceitaEm: string | null;
};

/** Lê quotes.data com cuidado: propostas antigas (seed) só têm cliente, empresa e itens. */
function buildVM(q: Quote, client: Client | null): QuoteVM {
  const data = (q.data || {}) as Record<string, unknown>;
  const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  let opcoes: QuoteOption[] = rows(data.opcoes).map((o) => ({
    nome: String(o.nome || 'Opção'),
    recomendada: Boolean(o.recomendada),
    total_projeto: n(o.total_projeto),
    mensal: n(o.mensal),
    itens: rows(o.itens).map((it) => ({ nome: String(it.nome || ''), descricao: String(it.descricao || ''), inclui: strs(it.inclui), valor: n(it.valor), recorrente: Boolean(it.recorrente) })),
  }));
  const legacy = opcoes.length === 0;
  if (legacy) {
    opcoes = [{ nome: 'Proposta', recomendada: true, total_projeto: n(q.total), mensal: n(q.monthly), itens: strs(data.itens).map((nome) => ({ nome, descricao: '', inclui: [], valor: 0, recorrente: false })) }];
  }
  return {
    empresa: String(data.empresa || client?.company || client?.contact_name || data.cliente || 'Cliente'),
    contato: String(data.cliente || client?.contact_name || ''),
    cidade: data.cidade ? String(data.cidade) : client?.city ? `${client.city}${client.state ? `/${client.state}` : ''}` : null,
    emitida: String(data.emitida_em || q.created_at.slice(0, 10)),
    valid: q.valid_until || null,
    ponto: strs(data.ponto_de_partida),
    opcoes,
    cronograma: rows(data.cronograma)
      .map((s) => ({ etapa: String(s.etapa || ''), semana: String(s.semana || ''), texto: String(s.texto || '') }))
      .filter((s) => s.etapa),
    condicoes: strs(data.condicoes),
    naoIncluso: strs(data.nao_incluso),
    legacy,
    example: Boolean(data.is_example),
    aceita: data.opcao_aceita ? String(data.opcao_aceita) : null,
    aceitaEm: data.aceita_em ? String(data.aceita_em) : null,
  };
}

const priceLine = (o: QuoteOption) =>
  [o.total_projeto > 0 ? `${brl(o.total_projeto)} projeto` : '', o.mensal > 0 ? `${brl(o.mensal)}/mês` : ''].filter(Boolean).join(' + ') || 'sob consulta';

/** Texto corrido da proposta, pronto para colar no WhatsApp ou e-mail. */
function quoteText(q: Quote, vm: QuoteVM, studio: Studio) {
  const L: string[] = [];
  L.push(`PROPOSTA ${q.number} · ${studio.name}`);
  L.push(`Para: ${vm.empresa}${vm.contato && vm.contato !== vm.empresa ? ` (${vm.contato})` : ''}`);
  L.push(`Emitida em ${dayLong(vm.emitida)}${vm.valid ? ` · válida até ${dayLong(vm.valid)}` : ''}`, '');
  if (vm.ponto.length) L.push('01 PONTO DE PARTIDA', ...vm.ponto, '');
  L.push('02 ESCOPO');
  vm.opcoes.forEach((o, i) => {
    L.push(`Opção ${i + 1}: ${o.nome}${o.recomendada ? ' (recomendada)' : ''} · ${priceLine(o)}`);
    for (const it of o.itens) {
      L.push(`- ${it.nome}${it.valor ? ` (${brl(it.valor)}${it.recorrente ? '/mês' : ''})` : ''}`);
      if (it.descricao) L.push(`  ${it.descricao}`);
      for (const x of it.inclui) L.push(`  * ${x}`);
    }
    L.push('');
  });
  if (vm.cronograma.length) {
    L.push('03 CRONOGRAMA');
    for (const s of vm.cronograma) L.push(`${s.etapa} (${s.semana}): ${s.texto}`);
    L.push('');
  }
  if (vm.condicoes.length || vm.naoIncluso.length) {
    L.push('04 CONDIÇÕES', ...vm.condicoes.map((c) => `- ${c}`));
    if (vm.naoIncluso.length) L.push('Não incluso:', ...vm.naoIncluso.map((c) => `- ${c}`));
    L.push('');
  }
  L.push('05 ACEITE', 'Para aceitar, responda com a opção escolhida. Depois do aceite enviamos o contrato.', '', `${studio.name} · ${studio.city} · CNPJ ${studio.cnpj}`, `${studio.instagram} · ${studio.whatsapp}`);
  return L.join('\n');
}

function QuoteDetail({ quote, client, contract }: { quote: Quote; client: Client | null; contract: { id: string; title: string } | null }) {
  const studio = studioInfo();
  const vm = buildVM(quote, client);
  const st = quote.status;
  const recommended = vm.opcoes.find((o) => o.recomendada) || vm.opcoes[0];

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button href="/vendas?t=propostas" variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Propostas
          </Button>
          <span className="num text-2xl text-ink">{quote.number}</span>
          <Badge tone={QUOTE_TONE[st]}>{QUOTE_LABEL[st]}</Badge>
          <Example show={vm.example} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintButton />
          <CopyButton text={quoteText(quote, vm, studio)} label="Copiar texto da proposta" />
        </div>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
        <span className="label mr-2">Status</span>
        {(st === 'rascunho' || st === 'recusada' || st === 'expirada') && (
          <ActionButton variant="subtle" size="sm" action={setQuoteStatusAction.bind(null, quote.id, 'enviada')} success="Proposta marcada como enviada">
            Marcar como enviada
          </ActionButton>
        )}
        {st !== 'aceita' && (
          <ActionForm action={acceptQuoteAction.bind(null, quote.id)} success="Aceite registrado. Contrato e faturas criados." className="flex flex-wrap items-center gap-2">
            <Select name="opcao" defaultValue={recommended?.nome} aria-label="Opção aceita" className="h-8 w-auto py-0 text-[13px]">
              {vm.opcoes.map((o) => (
                <option key={o.nome} value={o.nome}>
                  {o.nome} · {priceLine(o)}
                </option>
              ))}
            </Select>
            <SubmitButton size="sm" pendingText="Registrando">
              Marcar como aceita
            </SubmitButton>
          </ActionForm>
        )}
        {st !== 'aceita' && st !== 'recusada' && (
          <ActionButton variant="danger" size="sm" confirm="Marcar esta proposta como recusada?" action={setQuoteStatusAction.bind(null, quote.id, 'recusada')} success="Proposta marcada como recusada">
            Marcar como recusada
          </ActionButton>
        )}
        {st === 'aceita' && (
          <>
            <span className="text-sm text-ink2">
              Opção {vm.aceita || 'recomendada'}
              {vm.aceitaEm ? ` aceita em ${dayY(vm.aceitaEm)}` : ' aceita'}.
            </span>
            {contract && (
              <Button href={`/contratos?c=${contract.id}`} variant="subtle" size="sm">
                <FileSignature className="h-4 w-4" /> Abrir contrato
              </Button>
            )}
          </>
        )}
        {st !== 'aceita' && <span className="ml-auto text-xs text-ink3">Aceitar cria o contrato em rascunho, as faturas e ativa o cliente.</span>}
      </div>

      {vm.legacy && (
        <div className="no-print rounded-2xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-ink2">
          Esta proposta foi emitida antes do módulo e só guarda os itens e os totais. O texto completo está no PDF enviado ao cliente.
        </div>
      )}

      <QuotePaper quote={quote} vm={vm} studio={studio} />
    </div>
  );
}

function SectionTitle({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 mt-8 flex items-baseline gap-3 border-t border-neutral-200 pt-6 break-after-avoid">
      <span className="num text-lg text-accent">{n}</span>
      <span className="display text-2xl text-neutral-900">{children}</span>
    </h2>
  );
}

function QuotePaper({ quote, vm, studio }: { quote: Quote; vm: QuoteVM; studio: Studio }) {
  const cityName = studio.city.split(',')[0];
  const cols = vm.opcoes.length >= 3 ? 'md:grid-cols-3 print:grid-cols-3' : vm.opcoes.length === 2 ? 'md:grid-cols-2 print:grid-cols-2' : 'md:grid-cols-1 print:grid-cols-1';
  const noData = <p className="text-[13px] text-neutral-500">Sem dados no sistema. Consulte o PDF emitido.</p>;

  return (
    <article className="mx-auto w-full max-w-[880px] rounded-2xl bg-white p-8 text-[13px] leading-relaxed text-neutral-700 shadow-pop md:p-12 print:max-w-none print:rounded-none print:p-0 print:shadow-none">
      {/* Cabeçalho (div, não <header>: a regra de impressão esconde <header>) */}
      <div className="flex flex-wrap items-start justify-between gap-6 pb-6">
        <div>
          <div className="display text-[34px] leading-none text-neutral-900">{studio.name}</div>
          <div className="mt-2 text-[11px] uppercase tracking-[0.14em] text-neutral-500">
            {cityName} · CNPJ {studio.cnpj} · {studio.instagram} · {studio.whatsapp}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">Proposta</div>
          <div className="display text-[34px] leading-none text-accent">{quote.number}</div>
          <div className="mt-2 text-xs text-neutral-500">
            Emitida em {dayLong(vm.emitida)}
            {vm.valid && <> · válida até {dayLong(vm.valid)}</>}
          </div>
        </div>
      </div>
      <div className="h-[3px] w-16 bg-accent" />

      <div className="mt-6 grid gap-1">
        <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">Para</div>
        <div className="display text-2xl text-neutral-900">{vm.empresa}</div>
        <div className="text-neutral-600">
          {[vm.contato && vm.contato !== vm.empresa ? vm.contato : '', vm.cidade || ''].filter(Boolean).join(' · ')}
        </div>
      </div>

      <SectionTitle n="01">Ponto de partida</SectionTitle>
      {vm.ponto.length ? (
        <div className="space-y-2">
          {vm.ponto.map((p, i) => (
            <p key={i} className={cn(p.startsWith('Objetivo') && 'border-l-[3px] border-accent pl-3 font-medium text-neutral-900')}>
              {p}
            </p>
          ))}
        </div>
      ) : (
        noData
      )}

      <SectionTitle n="02">Escopo</SectionTitle>
      <div className={cn('grid gap-4', cols)}>
        {vm.opcoes.map((o) => (
          <div key={o.nome} className={cn('flex break-inside-avoid flex-col rounded-xl border p-4', o.recomendada && vm.opcoes.length > 1 ? 'border-accent bg-orange-50 ring-1 ring-accent' : 'border-neutral-200')}>
            <div className="flex items-start justify-between gap-2">
              <div className="display text-2xl text-neutral-900">{o.nome}</div>
              {o.recomendada && vm.opcoes.length > 1 && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-black">Recomendada</span>}
            </div>
            <div className="mt-2 space-y-0.5">
              {o.total_projeto > 0 && (
                <div>
                  <span className="num text-[26px] text-neutral-900">{brl(o.total_projeto)}</span> <span className="text-xs text-neutral-500">projeto</span>
                </div>
              )}
              {o.mensal > 0 && (
                <div>
                  <span className="num text-[26px] text-neutral-900">{brl(o.mensal)}</span> <span className="text-xs text-neutral-500">por mês</span>
                </div>
              )}
              {o.total_projeto <= 0 && o.mensal <= 0 && <div className="text-xs text-neutral-500">Valor sob consulta</div>}
            </div>
            <ul className="mt-4 space-y-3">
              {o.itens.map((it, i) => (
                <li key={i}>
                  <div className="font-medium text-neutral-900">{it.nome}</div>
                  {it.descricao && <div className="text-xs text-neutral-600">{it.descricao}</div>}
                  {it.inclui.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-neutral-700">
                      {it.inclui.map((x, j) => (
                        <li key={j} className="flex gap-2">
                          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                          {x}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <SectionTitle n="03">Cronograma</SectionTitle>
      {vm.cronograma.length ? (
        <div className="grid gap-3 sm:grid-cols-5 print:grid-cols-5">
          {vm.cronograma.map((s, i) => (
            <div key={s.etapa} className="break-inside-avoid border-t-2 border-neutral-900 pt-2">
              <div className="num text-[11px] text-accent">{String(i + 1).padStart(2, '0')}</div>
              <div className="display text-xl text-neutral-900">{s.etapa}</div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{s.semana}</div>
              <div className="mt-1 text-xs text-neutral-700">{s.texto}</div>
            </div>
          ))}
        </div>
      ) : (
        noData
      )}

      <SectionTitle n="04">Condições</SectionTitle>
      {vm.condicoes.length || vm.naoIncluso.length ? (
        <div className="grid gap-6 md:grid-cols-5 print:grid-cols-5">
          <ul className="space-y-1.5 md:col-span-3 print:col-span-3">
            {vm.condicoes.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                {c}
              </li>
            ))}
          </ul>
          {vm.naoIncluso.length > 0 && (
            <div className="md:col-span-2 print:col-span-2">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">Não incluso</div>
              <ul className="space-y-1.5">
                {vm.naoIncluso.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        noData
      )}

      <div className="break-inside-avoid">
        <SectionTitle n="05">Aceite</SectionTitle>
        <p>Para aceitar, marque a opção escolhida e assine abaixo. Depois do aceite enviamos o contrato.</p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {vm.opcoes.map((o) => (
            <span key={o.nome} className="inline-flex items-center gap-2 text-sm text-neutral-900">
              <span className={cn('inline-block h-3.5 w-3.5 border border-neutral-600', vm.aceita === o.nome && 'bg-neutral-900')} />
              {o.nome}
            </span>
          ))}
        </div>
        <div className="mt-12 grid gap-10 sm:grid-cols-2 print:grid-cols-2">
          <div className="border-t border-neutral-800 pt-2 text-xs text-neutral-700">
            <div className="text-sm font-semibold text-neutral-900">{studio.name}</div>
            Vitor Filgueiras · Estratégia e criação
            <br />
            CNPJ {studio.cnpj}
          </div>
          <div className="border-t border-neutral-800 pt-2 text-xs text-neutral-700">
            <div className="text-sm font-semibold text-neutral-900">{vm.empresa}</div>
            {vm.contato && vm.contato !== vm.empresa ? (
              <>
                {vm.contato}
                <br />
              </>
            ) : null}
            CPF/CNPJ: ______________________
          </div>
        </div>
        <p className="mt-8 text-neutral-700">{cityName}, ___ de ______________ de ______.</p>
        <div className="mt-8 border-t border-neutral-200 pt-3 text-[11px] text-neutral-500">
          {studio.name} · {studio.site} · {studio.instagram} · {studio.whatsapp}
        </div>
      </div>
    </article>
  );
}

/* =====================================================================
 * CATÁLOGO
 * ===================================================================== */
const SERVICE_KIND: Record<string, string> = { projeto: 'Projeto', mensal: 'Mensal', avulso: 'Avulso' };

const PLANS: { nome: string; papel: string; destaque?: boolean; preco: { v: number; per: string }[]; texto: string; itens: string[] }[] = [
  {
    nome: 'Ponto',
    papel: 'Entrada',
    preco: [{ v: 3500, per: 'projeto' }],
    texto: 'Um projeto fechado para começar. Uma entrega, sem mensalidade.',
    itens: ['Pagamento de 50% na aprovação e 50% na entrega', 'Até 2 rodadas de ajuste', 'Peças do cliente após a quitação'],
  },
  {
    nome: 'Temporada',
    papel: 'Recomendada',
    destaque: true,
    preco: [
      { v: 6500, per: 'projeto' },
      { v: 3500, per: 'por mês' },
    ],
    texto: 'Projeto de base mais plano mensal. Primeiro a marca ou o site, depois o conteúdo em ciclos mensais.',
    itens: ['Projeto pago em 50/50', 'Mensalidade todo dia 10, a partir da Estreia', 'Reajuste anual pelo IPCA'],
  },
  {
    nome: 'Impacto 360',
    papel: 'Âncora',
    preco: [{ v: 8500, per: 'por mês' }],
    texto: 'Conteúdo, tráfego, vídeo e acompanhamento no mesmo plano mensal.',
    itens: ['Mensalidade todo dia 10', 'Verba de mídia à parte', 'Diárias de gravação à parte'],
  },
];

function CatalogTab({ services }: { services: Service[] }) {
  const rows = [...services].sort((a, b) => (a.front || '').localeCompare(b.front || '') || a.base_price - b.base_price);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {rows.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="Catálogo vazio" text="Cadastre os serviços e preços de referência no Settings." action={<Button href="/settings">Abrir Settings</Button>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>Serviço</TH>
                <TH>Frente</TH>
                <TH>Tipo</TH>
                <TH className="text-right">Preço base</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="transition-colors hover:bg-white/[0.03]">
                  <TD>
                    <span className="block font-medium text-ink">{s.name}</span>
                    {s.description && <span className="block max-w-md text-xs text-ink3">{s.description}</span>}
                  </TD>
                  <TD className="text-ink2">{s.front}</TD>
                  <TD>
                    <Badge tone={s.kind === 'mensal' ? 'accent' : 'neutral'}>{SERVICE_KIND[s.kind] || s.kind}</Badge>
                  </TD>
                  <TD className="num text-right text-base">
                    {brl(s.base_price)}
                    {s.recurring && <span className="text-xs font-normal text-ink3">/mês</span>}
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="text-xs text-ink3">
          Somente leitura aqui. Para mudar serviços e preços, use o{' '}
          <Link href="/settings" className="text-ink2 underline-offset-2 hover:text-ink hover:underline">
            Settings
          </Link>
          .
        </p>
      </div>

      <div className="space-y-3">
        <div className="label">Os 3 planos da proposta</div>
        {PLANS.map((p) => (
          <Card key={p.nome} className={cn('p-5', p.destaque && 'border-accent/50')}>
            <div className="flex items-center justify-between gap-2">
              <div className="display text-2xl text-ink">{p.nome}</div>
              <Badge tone={p.destaque ? 'accent' : 'neutral'}>{p.papel}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {p.preco.map((x) => (
                <span key={x.per}>
                  <span className="num text-2xl text-ink">{brl(x.v)}</span> <span className="text-xs text-ink3">{x.per}</span>
                </span>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink2">{p.texto}</p>
            <ul className="mt-3 space-y-1.5 text-xs text-ink2">
              {p.itens.map((i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                  {i}
                </li>
              ))}
            </ul>
          </Card>
        ))}
        <p className="text-xs text-ink3">Valores de referência. A proposta ajusta pelo esforço real, e as diárias de gravação são sempre cobradas à parte.</p>
      </div>
    </div>
  );
}

/* =====================================================================
 * METAS
 * ===================================================================== */
function GoalCard({ label, value, goal, ratio, tone, note }: { label: string; value: string; goal: string; ratio: number | null; tone: 'ok' | 'warn' | 'accent'; note: string }) {
  return (
    <Card className="flex flex-col p-5">
      <div className="label">{label}</div>
      <div className="num mt-3 text-[40px] text-ink">{value}</div>
      <div className="mt-1 text-xs text-ink2">{goal}</div>
      {ratio != null && <Progress value={Math.min(1, ratio) * 100} tone={tone} className="mt-4" />}
      <p className="mt-3 text-xs text-ink3">{note}</p>
    </Card>
  );
}

function GoalsTab({ deals, quotes }: { deals: Deal[]; quotes: Quote[] }) {
  const ym = todayISO().slice(0, 7);
  const diag = deals.filter((x) => ['diagnostico', 'proposta', 'negociacao', 'fechado'].includes(x.stage) && ymOf(x.created_at) === ym).length;
  const issued = quotes.filter((q) => ymOf(q.created_at) === ym).length;
  const accepted = quotes.filter((q) => q.status === 'aceita' && ymOf(q.updated_at || q.created_at) === ym).length;
  const closed = deals.filter((x) => x.stage === 'fechado' && ymOf(x.updated_at || x.created_at) === ym);
  const toProposal = diag ? issued / diag : null;
  const toClose = issued ? accepted / issued : null;
  const rate = (v: number | null) => (v == null ? 'sem base' : `${num(v * 100, 0)}%`);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <GoalCard
          label="Diagnósticos no mês"
          value={String(diag)}
          goal="Meta: 10 por mês"
          ratio={diag / 10}
          tone={diag >= 10 ? 'ok' : 'accent'}
          note="Negociações criadas neste mês que já chegaram a Diagnóstico ou além."
        />
        <GoalCard
          label="Viram proposta"
          value={rate(toProposal)}
          goal="Meta: 70%"
          ratio={toProposal == null ? null : toProposal / 0.7}
          tone={toProposal != null && toProposal >= 0.7 ? 'ok' : 'warn'}
          note={`${issued} ${issued === 1 ? 'proposta emitida' : 'propostas emitidas'} para ${diag} ${diag === 1 ? 'diagnóstico' : 'diagnósticos'} no mês.`}
        />
        <GoalCard
          label="Fecham"
          value={rate(toClose)}
          goal="Meta: 30 a 40%"
          ratio={toClose == null ? null : toClose / 0.3}
          tone={toClose != null && toClose >= 0.3 ? 'ok' : 'warn'}
          note={`${accepted} ${accepted === 1 ? 'aceita' : 'aceitas'} de ${issued} ${issued === 1 ? 'emitida' : 'emitidas'} no mês. ${closed.length} ${closed.length === 1 ? 'negociação fechada' : 'negociações fechadas'}, ${brl(sum(closed, (x) => x.value || 0))}.`}
        />
        <GoalCard
          label="Resposta ao lead"
          value="Sem medição"
          goal="Meta: em até 1 hora útil"
          ratio={null}
          tone="accent"
          note="O sistema ainda não registra a hora do primeiro contato, então não há número para mostrar."
        />
      </div>

      <Card className="p-5">
        <div className="label mb-3">Como contamos</div>
        <ul className="grid gap-2 text-sm text-ink2 md:grid-cols-2">
          <li>Diagnósticos: negociações criadas no mês que estão hoje em Diagnóstico, Proposta, Negociação ou Fechado. O sistema não guarda o histórico de etapas, então vale a etapa atual.</li>
          <li>Viram proposta: propostas emitidas no mês divididas pelos diagnósticos do mês.</li>
          <li>Fecham: propostas aceitas no mês divididas pelas propostas emitidas no mês.</li>
          <li>Os números só usam negociações e propostas cadastradas aqui. Nada é estimado.</li>
        </ul>
      </Card>
    </div>
  );
}
