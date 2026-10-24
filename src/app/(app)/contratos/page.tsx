import Link from 'next/link';
import { ArrowLeft, FileSignature, Plus } from 'lucide-react';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import type { Client, Contract, Invoice } from '@/lib/db/types';
import { brl, fmtDate, sum } from '@/lib/utils';
import { Badge, Button, Card, Dot, EmptyState, ListRow, PageHeader, Table, TD, TH } from '@/components/ui/primitives';
import { ActionButton } from '@/components/ui/client';
import { setContractStatusAction } from '@/lib/actions/sales';
import { ContractEditor, NewContractForm } from './editor';

export const metadata = { title: 'Contratos' };

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

type SP = { c?: string; cliente?: string; modelo?: string };

const KIND_LABEL: Record<Contract['kind'], string> = {
  projeto: 'Projeto',
  recorrente: 'Recorrente',
  parceria: 'Parceria com exclusividade',
  imagem: 'Cessão de imagem',
  case: 'Autorização de case',
};

const STATUS: Record<Contract['status'], { label: string; dot: 'idle' | 'wave' | 'done' | 'off' }> = {
  rascunho: { label: 'Rascunho', dot: 'idle' },
  enviado: { label: 'Enviado', dot: 'wave' },
  assinado: { label: 'Assinado', dot: 'done' },
  vencendo: { label: 'Vencendo', dot: 'wave' },
  encerrado: { label: 'Encerrado', dot: 'off' },
};

/** Os 5 modelos que o gerador de contrato sabe montar. */
const MODELS: { kind: Contract['kind']; name: string; text: string }[] = [
  { kind: 'projeto', name: 'Projeto', text: 'Entrega fechada. Pagamento de 50% na aprovação e 50% na entrega, até 2 rodadas de ajuste.' },
  { kind: 'recorrente', name: 'Plano mensal', text: 'Mensalidade todo dia 10, vigência de 12 meses e reajuste anual pelo IPCA.' },
  { kind: 'parceria', name: 'Parceria com exclusividade', text: 'Remuneração mensal e exclusividade por 12 meses. O alcance da exclusividade se confirma caso a caso.' },
  { kind: 'imagem', name: 'Cessão de imagem', text: 'O cliente autoriza imagem, nome e voz em portfólio, site e redes do Studio.' },
  { kind: 'case', name: 'Autorização de case', text: 'Publicação do projeto como case, com números e depoimentos aprovados antes.' },
];

/* Datas "YYYY-MM-DD" viram meio-dia em Brasília: fmtDate sozinho mostraria o dia anterior por causa do fuso. */
const asDate = (s: string) => (s.length <= 10 ? `${s}T12:00:00-03:00` : s);
const dayY = (s?: string | null) => (s ? fmtDate(asDate(s), { day: '2-digit', month: 'short', year: 'numeric' }) : '');

const daysUntil = (iso: string, today: string) => {
  const a = iso.slice(0, 10).split('-').map(Number);
  const b = today.split('-').map(Number);
  return Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000);
};

/** Dias até o fim do contrato em vigor, quando faltam 60 ou menos (negativo = já venceu). */
function renewalDays(c: Contract, today: string): number | null {
  if (!c.ends_on || (c.status !== 'assinado' && c.status !== 'vencendo')) return null;
  const n = daysUntil(c.ends_on, today);
  return n <= 60 ? n : null;
}

function RenewalBadge({ days }: { days: number }) {
  return days < 0 ? <Badge tone="err">venceu há {-days} {-days === 1 ? 'dia' : 'dias'}</Badge> : <Badge tone="warn">renovar em {days} {days === 1 ? 'dia' : 'dias'}</Badge>;
}

const PRINT_CSS = `@media print{.app-main{padding-left:0!important;padding-right:0!important}main{padding:0!important}@page{margin:18mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

export default async function ContratosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireRole(['admin', 'comercial']);
  const sp = await searchParams;
  const d = await db();
  const today = todayISO();
  const [contracts, clients] = await Promise.all([d.list('contracts', { orderBy: 'created_at', desc: true }), d.list('clients', { orderBy: 'company' })]);
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const current = sp.c ? contracts.find((c) => c.id === sp.c) || null : null;

  /* ---------- Detalhe ---------- */
  if (sp.c) {
    if (!current) {
      return (
        <EmptyState icon={<FileSignature className="h-5 w-5" />} title="Contrato não encontrado" text="O link pode ter sido apagado." action={<Button href="/contratos">Voltar aos contratos</Button>} />
      );
    }
    const invoices = await d.list('invoices', { where: { contract_id: current.id }, orderBy: 'due_on' });
    return <ContractDetail contract={current} client={current.client_id ? clientById.get(current.client_id) || null : null} invoices={invoices} today={today} isAdmin={user.role === 'admin'} />;
  }

  /* ---------- Lista ---------- */
  const signed = contracts.filter((c) => c.status === 'assinado');
  const mrr = sum(signed, (c) => c.monthly || 0);
  const toRenew = contracts.filter((c) => renewalDays(c, today) !== null);
  const options = clients.map((c) => ({ id: c.id, name: c.company || c.contact_name }));
  const preClient = clients.find((c) => c.id === sp.cliente)?.id || '';
  const preKind = MODELS.find((m) => m.kind === sp.modelo)?.kind;

  return (
    <div>
      <div className="no-print">
        <PageHeader
          kicker="Negócio"
          title={
            <>
              Contratos <em>{contracts.length}</em>
            </>
          }
          subtitle="Rascunho, enviado, assinado e encerrado. Contratos em vigor avisam 60 dias antes do fim."
          actions={
            <Button href="/contratos#novo">
              <Plus className="h-4 w-4" /> Novo contrato
            </Button>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {contracts.length === 0 ? (
            <EmptyState icon={<FileSignature className="h-5 w-5" />} title="Nenhum contrato ainda" text="Aceite uma proposta em Vendas ou crie um contrato ao lado. O texto sai pronto do modelo do Studio." action={<Button href="/vendas?t=propostas">Ver propostas</Button>} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <TH>Cliente</TH>
                  <TH>Contrato</TH>
                  <TH className="text-right">Valor</TH>
                  <TH>Início</TH>
                  <TH>Fim</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => {
                  const cl = c.client_id ? clientById.get(c.client_id) : undefined;
                  const renew = renewalDays(c, today);
                  const st = STATUS[c.status];
                  return (
                    <tr key={c.id} className="group transition-colors hover:bg-white/[0.03]">
                      <TD>
                        <span className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-black" style={{ background: cl?.brand_color || '#FF5B1F' }}>
                            {(cl?.company || cl?.contact_name || '?').slice(0, 2).toUpperCase()}
                          </span>
                          <span className="text-ink2">{cl ? cl.company || cl.contact_name : 'Sem cliente'}</span>
                        </span>
                      </TD>
                      <TD>
                        <Link href={`/contratos?c=${c.id}`} className="block max-w-[320px] truncate font-medium text-ink group-hover:text-accent">
                          {c.title}
                        </Link>
                        <span className="block text-xs text-ink3">{KIND_LABEL[c.kind]}</span>
                      </TD>
                      <TD className="text-right">
                        {c.value ? <span className="num block text-base">{brl(c.value)}</span> : null}
                        {c.monthly ? <span className="num block text-base">{brl(c.monthly)}<span className="text-xs font-normal text-ink3">/mês</span></span> : null}
                        {!c.value && !c.monthly && <span className="text-xs text-ink3">sem valor</span>}
                      </TD>
                      <TD className="whitespace-nowrap text-ink2">{dayY(c.starts_on)}</TD>
                      <TD className="whitespace-nowrap text-ink2">
                        {c.ends_on ? dayY(c.ends_on) : <span className="text-xs text-ink3">sem data final</span>}
                        {renew !== null && (
                          <span className="mt-1 block">
                            <RenewalBadge days={renew} />
                          </span>
                        )}
                      </TD>
                      <TD>
                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                          <Dot state={st.dot} /> {st.label}
                        </span>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>

        <div className="no-print space-y-4">
          <Card className="p-5">
            <div className="label mb-3">Resumo</div>
            <dl className="space-y-2 text-sm">
              <SummaryRow k="Assinados" v={String(signed.length)} />
              <SummaryRow k="Recorrente (MRR)" v={brl(mrr)} />
              <SummaryRow k="A renovar em até 60 dias" v={String(toRenew.length)} warn={toRenew.length > 0} />
            </dl>
          </Card>

          <Card className="scroll-mt-24 p-5" id="novo">
            <div className="label mb-3">Novo contrato</div>
            <NewContractForm key={`${preClient}:${preKind || ''}`} clients={options} defaultClientId={preClient} defaultKind={preKind} today={today} />
          </Card>

          <Card className="p-5">
            <div className="label mb-3">Modelos</div>
            <ul className="space-y-3">
              {MODELS.map((m) => (
                <li key={m.kind}>
                  <Link href={`/contratos?modelo=${m.kind}#novo`} className="group block">
                    <span className="block text-sm font-medium text-ink group-hover:text-accent">{m.name}</span>
                    <span className="block text-xs text-ink3">{m.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink2">{k}</dt>
      <dd className={`num text-base ${warn ? 'text-warn' : 'text-ink'}`}>{v}</dd>
    </div>
  );
}

/* =====================================================================
 * Detalhe do contrato
 * ===================================================================== */
function ContractDetail({ contract: c, client, invoices, today, isAdmin }: { contract: Contract; client: Client | null; invoices: Invoice[]; today: string; isAdmin: boolean }) {
  const st = STATUS[c.status];
  const renew = renewalDays(c, today);
  const bind = (status: string) => setContractStatusAction.bind(null, c.id, status);
  const clientName = client ? client.company || client.contact_name : 'Sem cliente';

  return (
    <div>
      <style>{PRINT_CSS}</style>
      <div className="no-print">
        <PageHeader
          kicker="Contrato"
          title={
            <>
              {clientName} <em>{KIND_LABEL[c.kind]}</em>
            </>
          }
          subtitle={c.title}
          actions={
            <Button href="/contratos" variant="glass">
              <ArrowLeft className="h-4 w-4" /> Todos os contratos
            </Button>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ContractEditor id={c.id} title={c.title} initial={c.body || ''} />
        </div>

        <div className="no-print space-y-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="label">Status</div>
              <span className="inline-flex items-center gap-2 text-sm text-ink">
                <Dot state={st.dot} /> {st.label}
              </span>
            </div>
            {renew !== null && (
              <div className="mb-3">
                <RenewalBadge days={renew} />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {c.status !== 'enviado' && c.status !== 'assinado' && c.status !== 'encerrado' && (
                <ActionButton variant="subtle" size="sm" action={bind('enviado')} success="Marcado como enviado">
                  Marcar como enviado
                </ActionButton>
              )}
              {c.status !== 'assinado' && c.status !== 'encerrado' && (
                <ActionButton size="sm" action={bind('assinado')} success="Contrato assinado" confirm="Confirmar que as duas partes assinaram este contrato?">
                  Marcar como assinado
                </ActionButton>
              )}
              {c.status !== 'encerrado' ? (
                <ActionButton variant="danger" size="sm" action={bind('encerrado')} success="Contrato encerrado" confirm="Encerrar este contrato?">
                  Encerrar
                </ActionButton>
              ) : (
                <ActionButton variant="subtle" size="sm" action={bind('rascunho')} success="Contrato reaberto como rascunho">
                  Reabrir como rascunho
                </ActionButton>
              )}
            </div>
            {c.signed_at && <p className="mt-3 text-xs text-ink3">Assinado em {dayY(c.signed_at)}.</p>}
          </Card>

          <Card className="p-5">
            <div className="label mb-3">Dados</div>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink2">Cliente</dt>
                <dd className="text-right text-ink">{client ? <Link href={`/clientes/${client.id}`} className="hover:text-accent">{clientName}</Link> : clientName}</dd>
              </div>
              <SummaryRow k="Tipo" v={KIND_LABEL[c.kind]} />
              {c.value ? <SummaryRow k="Valor do projeto" v={brl(c.value)} /> : null}
              {c.monthly ? <SummaryRow k="Mensal" v={`${brl(c.monthly)}/mês`} /> : null}
              <SummaryRow k="Início" v={dayY(c.starts_on) || 'não informado'} />
              <SummaryRow k="Fim" v={dayY(c.ends_on) || 'sem data final'} />
              {c.quote_id && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-ink2">Proposta</dt>
                  <dd>
                    <Link href={`/vendas?t=propostas&q=${c.quote_id}`} className="text-sm text-ink hover:text-accent">
                      Ver proposta
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </Card>

          <Card className="p-3">
            <div className="label px-2 pb-1 pt-2">Faturas deste contrato</div>
            {invoices.length === 0 ? (
              <p className="px-2 py-3 text-sm text-ink2">Nenhuma fatura ligada a este contrato.</p>
            ) : (
              invoices.map((i) => {
                const late = i.status === 'atrasada' || (i.status === 'aberta' && i.due_on < today);
                return (
                  <ListRow
                    key={i.id}
                    left={<Dot state={i.status === 'paga' ? 'done' : i.status === 'cancelada' ? 'off' : late ? 'err' : 'wave'} />}
                    title={i.description}
                    meta={`Vence ${dayY(i.due_on)}${i.status === 'paga' ? ' · paga' : late ? ' · vencida' : ''}`}
                    right={<span className="num text-sm text-ink">{brl(i.amount)}</span>}
                  />
                );
              })
            )}
            {isAdmin && (
              <div className="px-2 pb-2 pt-1">
                <Button href="/financeiro" variant="subtle" size="sm">
                  Abrir o financeiro
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
