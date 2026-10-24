import Link from 'next/link';
import { AlertTriangle, Bot, Check, CircleDollarSign, Receipt, TrendingUp, Wallet, X } from 'lucide-react';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import type { AgentRun, Client, Contract, Expense, Invoice } from '@/lib/db/types';
import { brl, brlCents, cn, fmtDate, num, pct, sum } from '@/lib/utils';
import { Badge, Button, Card, Dot, EmptyState, Example, PageHeader, PillTabs, Progress, Stat, Table, TD, TH } from '@/components/ui/primitives';
import { ActionButton } from '@/components/ui/client';
import { Bars } from '@/components/ui/charts';
import { cancelInvoiceAction, markExpensePaidAction, markInvoicePaidAction } from '@/lib/actions/finance';
import { ExpenseForm, GenerateInvoicesButton, InvoiceForm, type ContractOption } from './forms';

export const metadata = { title: 'Financeiro' };

/** Fator fixo só para estimar o custo de IA em reais. Não é a cotação do dia. */
const USD_BRL = 5.2;
const FX = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(USD_BRL);

type SP = { t?: string; f?: string; p?: string };
type Tab = 'receber' | 'pagar' | 'fluxo' | 'ia';
type InvStatus = 'aberta' | 'atrasada' | 'paga' | 'cancelada';
type InvRow = { inv: Invoice; status: InvStatus };

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
/** Dia do mês (1 a 31) de uma data ou timestamp, em Brasília. */
const dayOfMonth = (s?: string | null) => {
  if (!s) return 0;
  if (s.length <= 10) return Number(s.slice(8, 10));
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? Number(s.slice(8, 10)) : Number(brParts(dt).day);
};
const monthAdd = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] || '';
const monthShort = (ym: string) => `${MONTHS_SHORT[Number(ym.slice(5, 7)) - 1] || ''}/${ym.slice(2, 4)}`;
const addDaysISO = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** Dias de a até b (positivo quando b é depois de a). */
const diffDays = (a: string, b: string) => {
  const x = a.slice(0, 10).split('-').map(Number);
  const y = b.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y[0], y[1] - 1, y[2]) - Date.UTC(x[0], x[1] - 1, x[2])) / 86400000);
};
const lastDayOf = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

/* Datas "YYYY-MM-DD" viram meio-dia em Brasília: fmtDate sozinho mostraria o dia anterior por causa do fuso. */
const asDate = (s: string) => (s.length <= 10 ? `${s}T12:00:00-03:00` : s);
const day = (s?: string | null) => (s ? fmtDate(asDate(s)) : '');
const dayY = (s?: string | null) => (s ? fmtDate(asDate(s), { day: '2-digit', month: 'short', year: 'numeric' }) : '');

const usd = (v: number) => `US$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v)}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/* ---------- Regras de negócio ---------- */
/** Status de fato: aberta que já passou do vencimento conta como atrasada, mesmo que o registro ainda diga "aberta". */
function effStatus(i: Invoice, today: string): InvStatus {
  if (i.status === 'paga' || i.status === 'cancelada') return i.status;
  if (i.status === 'atrasada' || i.due_on.slice(0, 10) < today) return 'atrasada';
  return 'aberta';
}
/** Data de referência da despesa: vencimento, senão pagamento, senão criação. */
const expenseMonth = (e: Expense) => ymOf(e.due_on || e.paid_at || e.created_at);
const paidMonthOf = (i: Invoice) => ymOf(i.paid_at || i.due_on);

/**
 * Contratos mensais assinados que ainda não têm fatura no mês `month`. Mesma regra de "já existe" da ação
 * de gerar faturas: fatura do contrato, ou do mesmo cliente sem contrato com o mesmo valor (faturas antigas).
 */
function missingMonthly(contracts: Contract[], invoices: Invoice[], month: string): Contract[] {
  const monthStart = `${month}-01`;
  const due = `${month}-10`;
  return contracts.filter((c) => {
    const monthly = Number(c.monthly || 0);
    if (c.status !== 'assinado' || monthly <= 0 || !c.client_id) return false;
    if (c.starts_on && c.starts_on.slice(0, 10) > due) return false;
    if (c.ends_on && c.ends_on.slice(0, 10) < monthStart) return false;
    return !invoices.some(
      (i) => i.client_id === c.client_id && ymOf(i.due_on) === month && (i.contract_id === c.id || (!i.contract_id && Math.abs(Number(i.amount) - monthly) < 0.01)),
    );
  });
}

const INV_STATUS: Record<InvStatus, { label: string; dot: 'idle' | 'wave' | 'done' | 'err' | 'off' }> = {
  aberta: { label: 'Em aberto', dot: 'wave' },
  atrasada: { label: 'Atrasada', dot: 'err' },
  paga: { label: 'Paga', dot: 'done' },
  cancelada: { label: 'Cancelada', dot: 'off' },
};
const METHOD: Record<NonNullable<Invoice['method']>, { label: string; tone: 'accent' | 'info' | 'neutral' }> = {
  pix: { label: 'Pix', tone: 'accent' },
  boleto: { label: 'Boleto', tone: 'info' },
  cartao: { label: 'Cartão', tone: 'neutral' },
  transferencia: { label: 'Transferência', tone: 'neutral' },
};

type Ctx = {
  today: string;
  ym: string;
  sp: SP;
  clients: Client[];
  clientById: Map<string, Client>;
  rows: InvRow[];
  invoices: Invoice[];
  expenses: Expense[];
  contracts: Contract[];
  runs: AgentRun[];
  pendingNow: Contract[];
  mrr: number;
  aiBrlMonth: number;
};

const nameOf = (c?: Client | null) => (c ? c.company || c.contact_name : '');

export default async function FinanceiroPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireRole(['admin']);
  const sp = await searchParams;
  const tab: Tab = (['receber', 'pagar', 'fluxo', 'ia'] as const).find((t) => t === sp.t) || 'receber';
  const d = await db();
  const [invoices, expenses, contracts, clients, runs] = await Promise.all([
    d.list('invoices', { orderBy: 'due_on' }),
    d.list('expenses', { orderBy: 'created_at', desc: true }),
    d.list('contracts'),
    d.list('clients', { orderBy: 'company' }),
    d.list('agent_runs', { orderBy: 'created_at', desc: true }),
  ]);

  const today = todayBR();
  const ym = today.slice(0, 7);
  const prevYm = monthAdd(ym, -1);
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const rows: InvRow[] = invoices.map((inv) => ({ inv, status: effStatus(inv, today) }));
  const open = rows.filter((r) => r.status === 'aberta' || r.status === 'atrasada');
  const overdue = rows.filter((r) => r.status === 'atrasada');
  const paid = rows.filter((r) => r.status === 'paga');

  const receivedMonth = sum(paid.filter((r) => paidMonthOf(r.inv) === ym), (r) => r.inv.amount);
  const paidMonthCount = paid.filter((r) => paidMonthOf(r.inv) === ym).length;
  // Compara o mês até hoje com o mesmo trecho do mês anterior, para não comparar mês aberto com mês fechado.
  const dom = Number(today.slice(8, 10));
  const receivedPrev = sum(
    paid.filter((r) => paidMonthOf(r.inv) === prevYm && dayOfMonth(r.inv.paid_at || r.inv.due_on) <= dom),
    (r) => r.inv.amount,
  );
  const toReceive = rows.filter((r) => r.status === 'aberta' && ymOf(r.inv.due_on) === ym);
  const toReceiveTotal = sum(toReceive, (r) => r.inv.amount);
  const overdueTotal = sum(overdue, (r) => r.inv.amount);
  const oldestOverdue = overdue.reduce((m, r) => Math.max(m, diffDays(r.inv.due_on, today)), 0);

  const signedMonthly = contracts.filter((c) => c.status === 'assinado' && Number(c.monthly || 0) > 0);
  const mrr = sum(signedMonthly, (c) => c.monthly || 0);

  const expMonth = expenses.filter((e) => expenseMonth(e) === ym);
  const expMonthTotal = sum(expMonth, (e) => e.amount);
  const expMonthPaid = sum(expMonth.filter((e) => e.paid_at), (e) => e.amount);
  const unpaidExpenses = expenses.filter((e) => !e.paid_at);

  const runsMonth = runs.filter((r) => ymOf(r.created_at) === ym);
  const aiUsdMonth = sum(runsMonth, (r) => r.cost_usd);
  const aiBrlMonth = aiUsdMonth * USD_BRL;

  const ctx: Ctx = {
    today,
    ym,
    sp,
    clients,
    clientById,
    rows,
    invoices,
    expenses,
    contracts,
    runs,
    pendingNow: missingMonthly(contracts, invoices, ym),
    mrr,
    aiBrlMonth,
  };

  const tabs = [
    { href: '/financeiro?t=receber', label: 'Receber', count: open.length },
    { href: '/financeiro?t=pagar', label: 'Pagar', count: unpaidExpenses.length },
    { href: '/financeiro?t=fluxo', label: 'Fluxo' },
    { href: '/financeiro?t=ia', label: 'IA' },
  ];

  return (
    <div>
      <PageHeader
        kicker="Negócio"
        title={
          <>
            Financeiro <em>{monthName(ym)}</em>
          </>
        }
        subtitle="O que entrou, o que falta entrar e o que sai. Valores calculados das faturas, despesas e contratos lançados."
        actions={
          <Button href="/contratos" variant="glass">
            Contratos
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          accent
          label="Recebido no mês"
          icon={<CircleDollarSign className="h-4 w-4" />}
          value={brl(receivedMonth)}
          delta={receivedPrev > 0 ? { value: pct(Math.abs(receivedMonth - receivedPrev) / receivedPrev, 0), up: receivedMonth >= receivedPrev } : undefined}
          hint={`${paidMonthCount} ${plural(paidMonthCount, 'fatura paga', 'faturas pagas')}${receivedPrev > 0 ? ` · vs. mesmo período de ${monthName(prevYm)}` : ''}`}
        />
        <Stat
          label="A receber no mês"
          icon={<Receipt className="h-4 w-4" />}
          value={brl(toReceiveTotal)}
          hint={toReceive.length ? `${toReceive.length} ${plural(toReceive.length, 'fatura a vencer', 'faturas a vencer')} até ${lastDayOf(ym)}/${ym.slice(5, 7)}` : 'nada a vencer até o fim do mês'}
        />
        <Stat
          label="Vencido"
          icon={<AlertTriangle className="h-4 w-4" />}
          value={<span className={overdueTotal > 0 ? 'text-err' : undefined}>{brl(overdueTotal)}</span>}
          hint={overdue.length ? `${overdue.length} ${plural(overdue.length, 'fatura', 'faturas')} · a mais antiga venceu há ${oldestOverdue} ${plural(oldestOverdue, 'dia', 'dias')}` : 'nenhuma fatura atrasada'}
        />
        <Stat
          label="MRR"
          icon={<TrendingUp className="h-4 w-4" />}
          value={brl(mrr)}
          hint={signedMonthly.length ? `${signedMonthly.length} ${plural(signedMonthly.length, 'contrato mensal assinado', 'contratos mensais assinados')}` : 'nenhum contrato mensal assinado'}
        />
        <Stat
          label="Despesas do mês"
          icon={<Wallet className="h-4 w-4" />}
          value={brl(expMonthTotal)}
          hint={`${brl(expMonthPaid)} pagas · ${brl(expMonthTotal - expMonthPaid)} a pagar`}
        />
        <Stat
          label="Custo de IA no mês"
          icon={<Bot className="h-4 w-4" />}
          value={brlCents(aiBrlMonth)}
          hint={`${usd(aiUsdMonth)} × ${FX} · estimativa, não é o câmbio do dia`}
        />
      </div>

      <PillTabs className="mb-6" current={`/financeiro?t=${tab}`} tabs={tabs} />

      {tab === 'receber' && <ReceberTab ctx={ctx} />}
      {tab === 'pagar' && <PagarTab ctx={ctx} />}
      {tab === 'fluxo' && <FluxoTab ctx={ctx} />}
      {tab === 'ia' && <IATab ctx={ctx} />}
    </div>
  );
}

/* =====================================================================
 * Receber
 * ===================================================================== */
function ClientChip({ c }: { c?: Client | null }) {
  const label = c ? nameOf(c) : 'Sem cliente';
  const chip = (
    <span className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-black" style={{ background: c?.brand_color || '#FF5B1F' }}>
        {label.slice(0, 2).toUpperCase()}
      </span>
      <span className="text-ink2 transition-colors group-hover:text-ink">{label}</span>
    </span>
  );
  return c ? (
    <Link href={`/clientes/${c.id}`} className="group">
      {chip}
    </Link>
  ) : (
    chip
  );
}

const FILTERS = [
  { key: 'todas', label: 'Todas' },
  { key: 'abertas', label: 'Em aberto' },
  { key: 'atrasadas', label: 'Atrasadas' },
  { key: 'pagas', label: 'Pagas' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

const FILTER_MATCH: Record<Filter, (r: InvRow) => boolean> = {
  todas: () => true,
  abertas: (r) => r.status === 'aberta' || r.status === 'atrasada',
  atrasadas: (r) => r.status === 'atrasada',
  pagas: (r) => r.status === 'paga',
};

const RANK: Record<InvStatus, number> = { atrasada: 0, aberta: 1, paga: 2, cancelada: 3 };
/** Atrasadas primeiro, depois as que vencem logo, depois as pagas (mais recentes antes) e as canceladas. */
function cmpRows(a: InvRow, b: InvRow) {
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status];
  if (a.status === 'paga') return (b.inv.paid_at || b.inv.due_on).localeCompare(a.inv.paid_at || a.inv.due_on);
  if (a.status === 'cancelada') return b.inv.due_on.localeCompare(a.inv.due_on);
  return a.inv.due_on.localeCompare(b.inv.due_on);
}

function ReceberTab({ ctx }: { ctx: Ctx }) {
  const { rows, clients, clientById, contracts, today, ym, pendingNow, sp } = ctx;
  const f: Filter = FILTERS.find((x) => x.key === sp.f)?.key || 'todas';
  const list = rows.filter(FILTER_MATCH[f]).sort(cmpRows);
  const filterTabs = FILTERS.map((x) => ({ href: `/financeiro?t=receber&f=${x.key}`, label: x.label, count: rows.filter(FILTER_MATCH[x.key]).length }));

  const clientOptions = clients.map((c) => ({ id: c.id, name: nameOf(c) }));
  const contractOptions: ContractOption[] = contracts
    .filter((c) => c.status !== 'encerrado' && c.client_id)
    .map((c) => ({ id: c.id, clientId: c.client_id || null, title: c.title, amount: Number(c.monthly || 0) > 0 ? Number(c.monthly) : Number(c.value || 0) }));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PillTabs current={`/financeiro?t=receber&f=${f}`} tabs={filterTabs} />
          <div className="text-xs text-ink2">
            {list.length} {plural(list.length, 'fatura', 'faturas')}
            {f !== 'todas' && list.length > 0 && (
              <>
                {' · '}
                <span className="num text-ink">{brl(sum(list, (r) => r.inv.amount))}</span>
              </>
            )}
          </div>
        </div>

        {list.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-5 w-5" />}
            title={f === 'todas' ? 'Nenhuma fatura ainda' : 'Nada por aqui'}
            text={f === 'todas' ? 'Crie a primeira fatura ao lado ou aceite uma proposta em Vendas.' : 'Nenhuma fatura neste filtro.'}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>Cliente</TH>
                <TH>Descrição</TH>
                <TH>Vencimento</TH>
                <TH>Forma</TH>
                <TH className="text-right">Valor</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </thead>
            <tbody>
              {list.map(({ inv, status }) => {
                const st = INV_STATUS[status];
                const m = inv.method ? METHOD[inv.method] : null;
                const late = status === 'atrasada' ? diffDays(inv.due_on, today) : 0;
                const actionable = status === 'aberta' || status === 'atrasada';
                return (
                  <tr key={inv.id} className={cn('transition-colors hover:bg-white/[0.03]', status === 'cancelada' && 'opacity-50')}>
                    <TD>
                      <ClientChip c={inv.client_id ? clientById.get(inv.client_id) : null} />
                    </TD>
                    <TD>
                      <div className="max-w-[280px]">
                        <div className="truncate text-ink">{inv.description}</div>
                        {inv.contract_id && (
                          <Link href={`/contratos?c=${inv.contract_id}`} className="text-xs text-ink3 transition-colors hover:text-ink">
                            ver contrato
                          </Link>
                        )}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {dayY(inv.due_on)}
                      {late > 0 && (
                        <div className="text-xs text-err">
                          há {late} {plural(late, 'dia', 'dias')}
                        </div>
                      )}
                    </TD>
                    <TD>{m ? <Badge tone={m.tone}>{m.label}</Badge> : <span className="text-ink3">sem forma</span>}</TD>
                    <TD className="num whitespace-nowrap text-right">{brl(inv.amount)}</TD>
                    <TD>
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <Dot state={st.dot} /> {st.label}
                      </span>
                      {status === 'paga' && inv.paid_at && <div className="text-xs text-ink3">em {day(inv.paid_at)}</div>}
                    </TD>
                    <TD>
                      {actionable && (
                        <div className="flex items-center justify-end gap-1.5">
                          <ActionButton size="sm" variant="glass" action={markInvoicePaidAction.bind(null, inv.id)} success="Fatura marcada como paga">
                            <Check className="h-3.5 w-3.5" /> Marcar paga
                          </ActionButton>
                          <ActionButton
                            size="sm"
                            variant="ghost"
                            action={cancelInvoiceAction.bind(null, inv.id)}
                            confirm={`Cancelar a fatura "${inv.description}"? Ela deixa de contar como a receber.`}
                            success="Fatura cancelada"
                          >
                            <X className="h-3.5 w-3.5" /> Cancelar
                          </ActionButton>
                        </div>
                      )}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>

      <div className="space-y-4">
        <Card className="p-5">
          <div className="label mb-3">Nova fatura</div>
          <InvoiceForm clients={clientOptions} contracts={contractOptions} today={today} />
        </Card>

        <Card className="p-5">
          <div className="label mb-2">Faturas de {monthName(ym)}</div>
          {pendingNow.length > 0 ? (
            <>
              <p className="text-sm text-ink2">
                {pendingNow.length} {plural(pendingNow.length, 'contrato mensal ainda sem fatura', 'contratos mensais ainda sem fatura')}, com vencimento no dia 10:
              </p>
              <ul className="mt-3 space-y-1.5">
                {pendingNow.slice(0, 5).map((c) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-ink">{c.title}</span>
                    <span className="num shrink-0 text-ink2">{brl(c.monthly)}</span>
                  </li>
                ))}
              </ul>
              {pendingNow.length > 5 && <p className="mt-1.5 text-xs text-ink3">e mais {pendingNow.length - 5}</p>}
            </>
          ) : (
            <p className="text-sm text-ink2">Todos os contratos mensais assinados já têm fatura em {monthName(ym)}.</p>
          )}
          <div className="mt-4">
            <GenerateInvoicesButton monthLabel={monthName(ym)} disabled={pendingNow.length === 0} />
          </div>
        </Card>

        <Card className="p-5">
          <div className="label mb-3">Formas de pagamento</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.values(METHOD).map((m) => (
              <Badge key={m.label} tone={m.tone}>
                {m.label}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink3">Cobrança automática (Asaas/Iugu): próxima fase. Por ora a baixa é manual: marque a fatura como paga quando o dinheiro entrar.</p>
        </Card>
      </div>
    </div>
  );
}

/* =====================================================================
 * Pagar
 * ===================================================================== */
type ExpStatus = 'paga' | 'vencida' | 'a_pagar';
function expStatus(e: Expense, today: string): ExpStatus {
  if (e.paid_at) return 'paga';
  if (e.due_on && e.due_on.slice(0, 10) < today) return 'vencida';
  return 'a_pagar';
}
const EXP_STATUS: Record<ExpStatus, { label: string; dot: 'wave' | 'done' | 'err' }> = {
  vencida: { label: 'Vencida', dot: 'err' },
  a_pagar: { label: 'A pagar', dot: 'wave' },
  paga: { label: 'Paga', dot: 'done' },
};
const EXP_RANK: Record<ExpStatus, number> = { vencida: 0, a_pagar: 1, paga: 2 };

function PagarTab({ ctx }: { ctx: Ctx }) {
  const { expenses, clients, clientById, today, ym } = ctx;
  const rows = expenses
    .map((e) => ({ e, status: expStatus(e, today) }))
    .sort((a, b) => {
      if (EXP_RANK[a.status] !== EXP_RANK[b.status]) return EXP_RANK[a.status] - EXP_RANK[b.status];
      if (a.status === 'paga') return (b.e.paid_at || '').localeCompare(a.e.paid_at || '');
      return (a.e.due_on || '9999').localeCompare(b.e.due_on || '9999');
    });
  const unpaid = rows.filter((r) => r.status !== 'paga');
  const unpaidTotal = sum(unpaid, (r) => r.e.amount);
  const lateRows = rows.filter((r) => r.status === 'vencida');
  const lateTotal = sum(lateRows, (r) => r.e.amount);
  const paidThisMonth = sum(rows.filter((r) => r.status === 'paga' && ymOf(r.e.paid_at) === ym), (r) => r.e.amount);

  const byCat = new Map<string, number>();
  for (const e of expenses) if (expenseMonth(e) === ym) byCat.set(e.category, (byCat.get(e.category) || 0) + e.amount);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const catTotal = sum(cats, ([, v]) => v);
  const clientOptions = clients.map((c) => ({ id: c.id, name: nameOf(c) }));

  const summary = [
    { label: 'A pagar', value: unpaidTotal, hint: `${unpaid.length} ${plural(unpaid.length, 'despesa', 'despesas')}`, bad: false },
    { label: 'Vencidas', value: lateTotal, hint: `${lateRows.length} ${plural(lateRows.length, 'despesa', 'despesas')}`, bad: lateTotal > 0 },
    { label: `Pagas em ${monthName(ym)}`, value: paidThisMonth, hint: 'saídas já feitas no mês', bad: false },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card className="grid grid-cols-3 divide-x divide-white/[0.07]">
          {summary.map((s) => (
            <div key={s.label} className="px-5 py-4">
              <div className="label">{s.label}</div>
              <div className={cn('num mt-2 text-2xl', s.bad ? 'text-err' : 'text-ink')}>{brl(s.value)}</div>
              <div className="mt-1 text-xs text-ink3">{s.hint}</div>
            </div>
          ))}
        </Card>

        {rows.length === 0 ? (
          <EmptyState icon={<Wallet className="h-5 w-5" />} title="Nenhuma despesa lançada" text="Lance ferramentas, freelancers e equipamentos ao lado para ver o resultado do mês." />
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>Categoria</TH>
                <TH>Fornecedor</TH>
                <TH>Vencimento</TH>
                <TH className="text-right">Valor</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, status }) => {
                const st = EXP_STATUS[status];
                const late = status === 'vencida' && e.due_on ? diffDays(e.due_on, today) : 0;
                const cl = e.client_id ? clientById.get(e.client_id) : null;
                return (
                  <tr key={e.id} className="transition-colors hover:bg-white/[0.03]">
                    <TD>
                      <div className="text-ink">{e.category}</div>
                      {cl && <div className="text-xs text-ink3">custo de {nameOf(cl)}</div>}
                    </TD>
                    <TD className="text-ink2">{e.supplier || <span className="text-ink3">sem fornecedor</span>}</TD>
                    <TD className="whitespace-nowrap">
                      {e.due_on ? dayY(e.due_on) : <span className="text-ink3">sem data</span>}
                      {late > 0 && (
                        <div className="text-xs text-err">
                          há {late} {plural(late, 'dia', 'dias')}
                        </div>
                      )}
                    </TD>
                    <TD className="num whitespace-nowrap text-right">{brl(e.amount)}</TD>
                    <TD>
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <Dot state={st.dot} /> {st.label}
                      </span>
                      {status === 'paga' && e.paid_at && <div className="text-xs text-ink3">em {day(e.paid_at)}</div>}
                    </TD>
                    <TD>
                      {status !== 'paga' && (
                        <div className="flex justify-end">
                          <ActionButton size="sm" variant="glass" action={markExpensePaidAction.bind(null, e.id)} success="Despesa marcada como paga">
                            <Check className="h-3.5 w-3.5" /> Marcar paga
                          </ActionButton>
                        </div>
                      )}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>

      <div className="space-y-4">
        <Card className="p-5">
          <div className="label mb-3">Nova despesa</div>
          <ExpenseForm clients={clientOptions} today={today} />
        </Card>

        <Card className="p-5">
          <div className="label mb-3">Por categoria em {monthName(ym)}</div>
          {cats.length === 0 ? (
            <p className="text-sm text-ink2">Nenhuma despesa com vencimento neste mês.</p>
          ) : (
            <div className="space-y-3">
              {cats.slice(0, 6).map(([name, value]) => (
                <div key={name}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-ink">{name}</span>
                    <span className="num shrink-0 text-ink2">{brl(value)}</span>
                  </div>
                  <Progress value={catTotal > 0 ? (value / catTotal) * 100 : 0} />
                </div>
              ))}
              {cats.length > 6 && <p className="text-xs text-ink3">e mais {cats.length - 6} {plural(cats.length - 6, 'categoria', 'categorias')}</p>}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* =====================================================================
 * Fluxo: 6 meses, previsão de 90 dias e DRE do mês
 * ===================================================================== */
function FluxoTab({ ctx }: { ctx: Ctx }) {
  const { rows, invoices, expenses, contracts, today, ym, aiBrlMonth } = ctx;

  // Últimos 6 meses (o atual por último): recebido pelo pagamento, despesas pelo vencimento.
  const hist = Array.from({ length: 6 }, (_, i) => monthAdd(ym, i - 5)).map((m) => {
    const received = sum(rows.filter((r) => r.status === 'paga' && paidMonthOf(r.inv) === m), (r) => r.inv.amount);
    const spent = sum(expenses.filter((e) => expenseMonth(e) === m), (e) => e.amount);
    return { key: m, label: monthShort(m), received, spent, result: received - spent };
  });
  const now = hist[hist.length - 1];
  const margin = now.received > 0 ? now.result / now.received : null;
  const hasHistory = hist.some((h) => h.received > 0 || h.spent > 0);

  // Previsão: de hoje até +90 dias. Faturas emitidas e ainda a vencer, mais as mensalidades que ainda não viraram fatura.
  const limit = addDaysISO(today, 90);
  const months: string[] = [];
  for (let m = ym; m <= ymOf(limit); m = monthAdd(m, 1)) months.push(m);
  const forecast = months.map((m) => {
    const issued = sum(
      rows.filter((r) => r.status === 'aberta' && ymOf(r.inv.due_on) === m && r.inv.due_on.slice(0, 10) <= limit),
      (r) => r.inv.amount,
    );
    const toIssue = `${m}-10` <= limit ? sum(missingMonthly(contracts, invoices, m), (c) => c.monthly || 0) : 0;
    return { key: m, label: monthShort(m), issued, toIssue, total: issued + toIssue };
  });
  const forecastTotal = sum(forecast, (f) => f.total);
  const overdue = rows.filter((r) => r.status === 'atrasada');
  const overdueTotal = sum(overdue, (r) => r.inv.amount);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="label">Recebido por mês</div>
          <div className="mt-3">
            <Bars data={hist} xKey="label" yKey="received" money highlightLast name="Recebido" height={200} />
          </div>
        </Card>
        <Card className="p-5">
          <div className="label">Despesas por mês</div>
          <div className="mt-3">
            <Bars data={hist} xKey="label" yKey="spent" money highlightLast name="Despesas" height={200} />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Table>
            <thead>
              <tr>
                <TH>Mês</TH>
                <TH className="text-right">Recebido</TH>
                <TH className="text-right">Despesas</TH>
                <TH className="text-right">Resultado</TH>
              </tr>
            </thead>
            <tbody>
              {hist
                .slice()
                .reverse()
                .map((h) => (
                  <tr key={h.key} className="transition-colors hover:bg-white/[0.03]">
                    <TD className="capitalize">
                      {monthName(h.key)} <span className="text-ink3">{h.key.slice(0, 4)}</span>
                    </TD>
                    <TD className="num text-right">{brl(h.received)}</TD>
                    <TD className="num text-right">{brl(h.spent)}</TD>
                    <TD className={cn('num text-right', h.result > 0 ? 'text-ok' : h.result < 0 ? 'text-err' : 'text-ink2')}>{brl(h.result)}</TD>
                  </tr>
                ))}
            </tbody>
          </Table>
          {!hasHistory && <p className="text-xs text-ink3">Ainda não há pagamentos nem despesas nos últimos 6 meses.</p>}

          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="label">Próximos 90 dias</div>
                <h3 className="display mt-1 text-xl text-ink">Previsão de entrada</h3>
              </div>
              <div className="text-right">
                <div className="num text-3xl text-ink">{brl(forecastTotal)}</div>
                <div className="mt-0.5 text-xs text-ink3">até {day(limit)}</div>
              </div>
            </div>
            <div className="mt-3">
              <Bars data={forecast} xKey="label" yKey="total" money name="Previsto" height={180} />
            </div>
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr>
                  <TH className="px-0">Mês</TH>
                  <TH className="text-right">Faturas emitidas</TH>
                  <TH className="text-right">Mensalidades a faturar</TH>
                  <TH className="px-0 text-right">Previsto</TH>
                </tr>
              </thead>
              <tbody>
                {forecast.map((f) => (
                  <tr key={f.key}>
                    <TD className="px-0 capitalize">{monthName(f.key)}</TD>
                    <TD className="num text-right">{brl(f.issued)}</TD>
                    <TD className="num text-right text-ink2">{brl(f.toIssue)}</TD>
                    <TD className="num px-0 text-right">{brl(f.total)}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-ink3">
              Faturas emitidas são as abertas que ainda vão vencer. Mensalidades a faturar são os contratos mensais assinados que ainda não têm fatura no mês, no valor do contrato. Faturas de meses depois da janela não entram.
            </p>
            {overdueTotal > 0 && (
              <p className="mt-2 text-xs text-err">
                Fora da previsão: {brl(overdueTotal)} vencidos em {overdue.length} {plural(overdue.length, 'fatura', 'faturas')}, ainda não recebidos.
              </p>
            )}
          </Card>
        </div>

        <Card className="h-fit p-5">
          <div className="label">DRE simplificada</div>
          <h3 className="display mt-1 text-xl text-ink">{monthName(ym)}</h3>
          <dl className="mt-4 divide-y divide-white/[0.07] text-sm">
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-ink2">Receita (recebido)</dt>
              <dd className="num text-ink">{brl(now.received)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-ink2">Despesas</dt>
              <dd className="num text-ink">{brl(now.spent)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-ink">Resultado</dt>
              <dd className={cn('num text-xl', now.result > 0 ? 'text-ok' : now.result < 0 ? 'text-err' : 'text-ink')}>{brl(now.result)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-ink2">Margem</dt>
              <dd className="num text-ink">{margin === null ? 'sem receita' : pct(margin, 1)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-ink3">
            Receita: faturas pagas em {monthName(ym)}. Despesas: lançadas com vencimento no mês, pagas ou não. Só entra o que está lançado.
          </p>
          <p className="mt-2 text-xs text-ink3">
            Fora do cálculo: custo de IA estimado de {brlCents(aiBrlMonth)}. Se a conta da API já está lançada em Ferramentas, somar de novo contaria duas vezes.
          </p>
        </Card>
      </div>
    </div>
  );
}

/* =====================================================================
 * IA: execuções dos agentes por agente e por cliente
 * ===================================================================== */
type Agg = { key: string; label: string; runs: number; errors: number; examples: number; inTok: number; outTok: number; usd: number };

function aggregate(list: AgentRun[], keyOf: (r: AgentRun) => string, labelOf: (key: string) => string): Agg[] {
  const m = new Map<string, Agg>();
  for (const r of list) {
    const key = keyOf(r);
    const a = m.get(key) || { key, label: labelOf(key), runs: 0, errors: 0, examples: 0, inTok: 0, outTok: 0, usd: 0 };
    a.runs += 1;
    if (r.status === 'erro') a.errors += 1;
    if (r.status === 'exemplo') a.examples += 1;
    a.inTok += Number(r.input_tokens || 0);
    a.outTok += Number(r.output_tokens || 0);
    a.usd += Number(r.cost_usd || 0);
    m.set(key, a);
  }
  return [...m.values()].sort((a, b) => b.usd - a.usd || b.runs - a.runs || a.label.localeCompare(b.label));
}

function IATab({ ctx }: { ctx: Ctx }) {
  const { runs, clientById, contracts, ym, sp } = ctx;
  const p: 'mes' | 'tudo' = sp.p === 'tudo' ? 'tudo' : 'mes';
  const list = p === 'mes' ? runs.filter((r) => ymOf(r.created_at) === ym) : runs;
  const totalUsd = sum(list, (r) => r.cost_usd);
  const totalBrl = totalUsd * USD_BRL;
  const tokensIn = sum(list, (r) => r.input_tokens);
  const tokensOut = sum(list, (r) => r.output_tokens);
  const examples = list.filter((r) => r.status === 'exemplo').length;
  const errors = list.filter((r) => r.status === 'erro').length;
  const onlyExamples = list.length > 0 && examples === list.length;

  const byAgent = aggregate(list, (r) => r.agent || 'Sem agente', (k) => k);
  const byClient = aggregate(
    list,
    (r) => r.client_id || '',
    (k) => (k ? nameOf(clientById.get(k)) || 'Cliente removido' : 'Sem cliente (custo do Studio)'),
  );
  const monthlyBy = new Map<string, number>();
  for (const c of contracts) if (c.status === 'assinado' && c.client_id && Number(c.monthly || 0) > 0) monthlyBy.set(c.client_id, (monthlyBy.get(c.client_id) || 0) + Number(c.monthly));

  const periodTabs = [
    { href: '/financeiro?t=ia&p=mes', label: `Em ${monthName(ym)}` },
    { href: '/financeiro?t=ia&p=tudo', label: 'Desde o início' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs current={`/financeiro?t=ia&p=${p}`} tabs={periodTabs} />
        <div className="text-xs text-ink2">
          {list.length} {plural(list.length, 'execução', 'execuções')} · {num(tokensIn + tokensOut)} tokens
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<Bot className="h-5 w-5" />}
          title="Nenhuma execução de IA neste período"
          text="Cada geração de proposta, diagnóstico, feed ou relatório aparece aqui com tokens e custo."
          action={p === 'mes' ? <Button href="/financeiro?t=ia&p=tudo" variant="glass">Ver desde o início</Button> : undefined}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <section className="space-y-3">
              <h3 className="display text-xl text-ink">
                Por cliente <Example show={onlyExamples} />
              </h3>
              <Table>
                <thead>
                  <tr>
                    <TH>Cliente</TH>
                    <TH className="text-right">Execuções</TH>
                    <TH className="text-right">Tokens</TH>
                    <TH className="text-right">US$</TH>
                    <TH className="text-right">R$</TH>
                    <TH>Rateio</TH>
                    {p === 'mes' && <TH className="text-right">% da mensalidade</TH>}
                  </tr>
                </thead>
                <tbody>
                  {byClient.map((a) => {
                    const share = totalUsd > 0 ? a.usd / totalUsd : 0;
                    const monthly = a.key ? monthlyBy.get(a.key) || 0 : 0;
                    return (
                      <tr key={a.key || 'studio'} className="transition-colors hover:bg-white/[0.03]">
                        <TD>
                          {a.key ? (
                            <Link href={`/clientes/${a.key}`} className="text-ink transition-colors hover:text-accent">
                              {a.label}
                            </Link>
                          ) : (
                            <span className="text-ink2">{a.label}</span>
                          )}
                        </TD>
                        <TD className="num text-right">{num(a.runs)}</TD>
                        <TD className="num text-right text-ink2">{num(a.inTok + a.outTok)}</TD>
                        <TD className="num text-right text-ink2">{usd(a.usd)}</TD>
                        <TD className="num text-right">{brlCents(a.usd * USD_BRL)}</TD>
                        <TD className="min-w-[120px]">
                          {totalUsd > 0 ? (
                            <div className="flex items-center gap-2">
                              <Progress value={share * 100} className="w-16" />
                              <span className="num text-xs text-ink2">{pct(share, 1)}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-ink3">sem custo</span>
                          )}
                        </TD>
                        {p === 'mes' && (
                          <TD className="num text-right">
                            {a.key ? (
                              monthly > 0 ? (
                                pct((a.usd * USD_BRL) / monthly, 1)
                              ) : (
                                <span className="text-xs text-ink3">sem mensalidade</span>
                              )
                            ) : (
                              <span className="text-xs text-ink3">custo do Studio</span>
                            )}
                          </TD>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </section>

            <section className="space-y-3">
              <h3 className="display text-xl text-ink">Por agente</h3>
              <Table>
                <thead>
                  <tr>
                    <TH>Agente</TH>
                    <TH className="text-right">Execuções</TH>
                    <TH className="text-right">Tokens de entrada</TH>
                    <TH className="text-right">Tokens de saída</TH>
                    <TH className="text-right">US$</TH>
                    <TH className="text-right">R$</TH>
                  </tr>
                </thead>
                <tbody>
                  {byAgent.map((a) => (
                    <tr key={a.key} className="transition-colors hover:bg-white/[0.03]">
                      <TD>
                        {a.label}
                        {a.errors > 0 && (
                          <Badge tone="err" className="ml-2">
                            {a.errors} {plural(a.errors, 'erro', 'erros')}
                          </Badge>
                        )}
                        {a.examples > 0 && (
                          <Badge tone="warn" className="ml-2">
                            {a.examples} {plural(a.examples, 'exemplo', 'exemplos')}
                          </Badge>
                        )}
                      </TD>
                      <TD className="num text-right">{num(a.runs)}</TD>
                      <TD className="num text-right text-ink2">{num(a.inTok)}</TD>
                      <TD className="num text-right text-ink2">{num(a.outTok)}</TD>
                      <TD className="num text-right text-ink2">{usd(a.usd)}</TD>
                      <TD className="num text-right">{brlCents(a.usd * USD_BRL)}</TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </section>
          </div>

          <Card className="h-fit p-5">
            <div className="label">{p === 'mes' ? `Custo em ${monthName(ym)}` : 'Custo acumulado'}</div>
            <div className="num mt-3 text-[40px] text-ink">{brlCents(totalBrl)}</div>
            <div className="mt-1 text-xs text-ink2">
              {usd(totalUsd)} × {FX}
            </div>
            <dl className="mt-5 divide-y divide-white/[0.07] text-sm">
              <div className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-ink2">Execuções</dt>
                <dd className="num text-ink">{num(list.length)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-ink2">Tokens de entrada</dt>
                <dd className="num text-ink">{num(tokensIn)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-ink2">Tokens de saída</dt>
                <dd className="num text-ink">{num(tokensOut)}</dd>
              </div>
              {errors > 0 && (
                <div className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-ink2">Com erro</dt>
                  <dd className="num text-err">{num(errors)}</dd>
                </div>
              )}
              {examples > 0 && (
                <div className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-ink2">Em modo exemplo</dt>
                  <dd className="num text-ink">{num(examples)}</dd>
                </div>
              )}
            </dl>
            <p className="mt-4 text-xs text-ink3">
              O custo em dólar vem do preço de referência de cada modelo e dos tokens registrados. Para reais, usamos o fator fixo de {FX}: é uma estimativa, não o câmbio do dia.
            </p>
            <p className="mt-2 text-xs text-ink3">O rateio divide o custo pelo que cada cliente consumiu. Execuções sem cliente ficam como custo do Studio.</p>
            {onlyExamples && (
              <p className="mt-2 text-xs text-warn">
                Todas as execuções deste período rodaram em modo exemplo, por isso o custo é zero. Configure a chave da IA em{' '}
                <Link href="/settings" className="underline underline-offset-2">
                  Settings
                </Link>
                .
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
