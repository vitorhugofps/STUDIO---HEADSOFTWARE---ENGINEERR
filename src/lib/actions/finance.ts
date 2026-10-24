'use server';

import { revalidatePath } from 'next/cache';
import { db, logActivity } from '@/lib/db';
import { getSession, type SessionUser } from '@/lib/auth';
import type { Invoice } from '@/lib/db/types';
import { brl } from '@/lib/utils';

/* =====================================================================
 * Financeiro: faturas a receber e despesas a pagar. Somente admin.
 * Este arquivo é 'use server': só funções async podem ser exportadas.
 * ===================================================================== */

type Guard = { ok: true; user: SessionUser } | { ok: false; error: string };

async function guard(): Promise<Guard> {
  const user = await getSession();
  if (!user) return { ok: false, error: 'Não autorizado' };
  if (user.role !== 'admin') return { ok: false, error: 'Só o admin mexe no financeiro.' };
  return { ok: true, user };
}

const text = (fd: FormData, k: string) => String(fd.get(k) || '').trim();
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Hoje em Brasília (YYYY-MM-DD). O todayISO de utils usa UTC e vira o dia 3 horas antes da meia-noite daqui. */
const BR_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
function todayISO() {
  const o: Record<string, string> = {};
  for (const p of BR_DAY.formatToParts(new Date())) o[p.type] = p.value;
  return `${o.year}-${o.month}-${o.day}`;
}
const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const METHODS: NonNullable<Invoice['method']>[] = ['pix', 'boleto', 'cartao', 'transferencia'];

/** Aceita "3.500", "3500", "3.500,50" e "R$ 3500". */
function money(v: FormDataEntryValue | null | undefined): number {
  if (v == null) return 0;
  const s = String(v).trim().replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  let n: number;
  if (s.includes(',')) n = Number(s.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ''));
  else n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function revalidateFinance(extra: string[] = []) {
  for (const p of ['/financeiro', '/analytics', '/clientes', '/', ...extra]) revalidatePath(p);
}

/* ---------- Faturas ---------- */
export async function createInvoiceAction(fd: FormData) {
  const g = await guard();
  if (!g.ok) return g;
  const clientId = text(fd, 'client_id');
  const description = text(fd, 'description');
  const amount = round2(money(fd.get('amount')));
  const dueOn = text(fd, 'due_on');
  const method = (text(fd, 'method') || 'pix') as NonNullable<Invoice['method']>;
  if (!clientId) return { ok: false as const, error: 'Escolha o cliente da fatura.' };
  if (!description) return { ok: false as const, error: 'Descreva a cobrança.' };
  if (amount <= 0) return { ok: false as const, error: 'Informe um valor maior que zero.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return { ok: false as const, error: 'Informe o vencimento.' };
  if (!METHODS.includes(method)) return { ok: false as const, error: 'Forma de pagamento inválida.' };
  const d = await db();
  const client = await d.get('clients', clientId);
  if (!client) return { ok: false as const, error: 'Cliente não encontrado.' };
  const inv = await d.insert('invoices', {
    client_id: clientId,
    contract_id: text(fd, 'contract_id') || null,
    description,
    amount,
    due_on: dueOn,
    method,
    status: dueOn < todayISO() ? 'atrasada' : 'aberta',
  });
  await logActivity(d, { actor_id: g.user.id, actor_name: g.user.name, action: `emitiu a fatura de ${brl(amount)} para ${client.company || client.contact_name}`, entity: 'invoices', entity_id: inv.id });
  revalidateFinance([`/clientes/${clientId}`]);
  return { ok: true as const, id: inv.id };
}

export async function markInvoicePaidAction(id: string) {
  const g = await guard();
  if (!g.ok) return g;
  const d = await db();
  const inv = await d.get('invoices', id);
  if (!inv) return { ok: false as const, error: 'Fatura não encontrada.' };
  if (inv.status === 'paga') return { ok: true as const };
  if (inv.status === 'cancelada') return { ok: false as const, error: 'Fatura cancelada não pode ser paga.' };
  await d.update('invoices', id, { status: 'paga', paid_at: new Date().toISOString() });
  const client = inv.client_id ? await d.get('clients', inv.client_id) : null;
  await logActivity(d, { actor_id: g.user.id, actor_name: g.user.name, action: `registrou o pagamento de ${brl(inv.amount)}${client ? ` de ${client.company || client.contact_name}` : ''}`, entity: 'invoices', entity_id: id });
  revalidateFinance(inv.client_id ? [`/clientes/${inv.client_id}`] : []);
  return { ok: true as const };
}

export async function cancelInvoiceAction(id: string) {
  const g = await guard();
  if (!g.ok) return g;
  const d = await db();
  const inv = await d.get('invoices', id);
  if (!inv) return { ok: false as const, error: 'Fatura não encontrada.' };
  if (inv.status === 'paga') return { ok: false as const, error: 'Fatura paga não pode ser cancelada.' };
  await d.update('invoices', id, { status: 'cancelada' });
  await logActivity(d, { actor_id: g.user.id, actor_name: g.user.name, action: `cancelou a fatura "${inv.description}"`, entity: 'invoices', entity_id: id });
  revalidateFinance(inv.client_id ? [`/clientes/${inv.client_id}`] : []);
  return { ok: true as const };
}

/**
 * Para cada contrato assinado com mensalidade, cria a fatura do dia 10 do mês atual se ainda não existir.
 * "Já existe" = fatura do mesmo contrato no mês, ou do mesmo cliente sem contrato com o mesmo valor (faturas antigas).
 * Faturas canceladas contam como existentes, para não recriar uma cobrança retirada de propósito.
 */
export async function generateMonthlyInvoicesAction() {
  const g = await guard();
  if (!g.ok) return g;
  const d = await db();
  const today = todayISO();
  const ym = today.slice(0, 7);
  const due = `${ym}-10`;
  const monthStart = `${ym}-01`;
  const [contracts, invoices] = await Promise.all([d.list('contracts', { where: { status: 'assinado' } }), d.list('invoices')]);
  let created = 0;
  const skipped: string[] = [];
  for (const c of contracts) {
    const monthly = Number(c.monthly || 0);
    if (monthly <= 0 || !c.client_id) continue;
    if (c.starts_on && c.starts_on > due) continue; // começa depois do dia 10: a 1ª cobrança é a do mês seguinte
    if (c.ends_on && c.ends_on < monthStart) continue;
    const exists = invoices.some(
      (i) => i.client_id === c.client_id && i.due_on.slice(0, 7) === ym && (i.contract_id === c.id || (!i.contract_id && Math.abs(Number(i.amount) - monthly) < 0.01)),
    );
    if (exists) {
      skipped.push(c.title);
      continue;
    }
    const inv = await d.insert('invoices', {
      client_id: c.client_id,
      contract_id: c.id,
      description: `${c.title} · ${MONTHS_PT[Number(ym.slice(5, 7)) - 1]}`,
      amount: monthly,
      due_on: due,
      method: 'pix',
      status: due < today ? 'atrasada' : 'aberta',
    });
    invoices.push(inv);
    created++;
  }
  if (created) await logActivity(d, { actor_id: g.user.id, actor_name: g.user.name, action: `gerou ${created} ${created === 1 ? 'fatura mensal' : 'faturas mensais'} de ${MONTHS_PT[Number(ym.slice(5, 7)) - 1]}`, entity: 'invoices' });
  revalidateFinance();
  return { ok: true as const, created, skipped: skipped.length };
}

/* ---------- Despesas ---------- */
export async function createExpenseAction(fd: FormData) {
  const g = await guard();
  if (!g.ok) return g;
  const category = text(fd, 'category');
  const amount = round2(money(fd.get('amount')));
  if (!category) return { ok: false as const, error: 'Informe a categoria da despesa.' };
  if (amount <= 0) return { ok: false as const, error: 'Informe um valor maior que zero.' };
  const d = await db();
  const dueOn = text(fd, 'due_on');
  const paid = fd.get('paid') === 'on';
  const exp = await d.insert('expenses', {
    category,
    supplier: text(fd, 'supplier') || null,
    amount,
    due_on: dueOn || (paid ? todayISO() : null),
    paid_at: paid ? new Date().toISOString() : null,
    client_id: text(fd, 'client_id') || null,
  });
  await logActivity(d, { actor_id: g.user.id, actor_name: g.user.name, action: `lançou a despesa ${category}${exp.supplier ? ` (${exp.supplier})` : ''} de ${brl(amount)}`, entity: 'expenses', entity_id: exp.id });
  revalidateFinance();
  return { ok: true as const, id: exp.id };
}

export async function markExpensePaidAction(id: string) {
  const g = await guard();
  if (!g.ok) return g;
  const d = await db();
  const exp = await d.get('expenses', id);
  if (!exp) return { ok: false as const, error: 'Despesa não encontrada.' };
  if (exp.paid_at) return { ok: true as const };
  await d.update('expenses', id, { paid_at: new Date().toISOString() });
  await logActivity(d, { actor_id: g.user.id, actor_name: g.user.name, action: `pagou a despesa ${exp.category}${exp.supplier ? ` (${exp.supplier})` : ''} de ${brl(exp.amount)}`, entity: 'expenses', entity_id: id });
  revalidateFinance();
  return { ok: true as const };
}
