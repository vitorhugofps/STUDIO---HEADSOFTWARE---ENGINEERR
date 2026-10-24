import Link from 'next/link';
import { headers } from 'next/headers';
import { CalendarDays } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveClient } from '@/lib/active-client';
import { fmtDate, todayISO } from '@/lib/utils';
import { Badge, Button, Card, EmptyState, PageHeader, Table, TD, TH } from '@/components/ui/primitives';
import { PlanBoard, PlanForm, type BatchInfo, type BrandTokens } from './grid';

export const metadata = { title: 'Criação de Feed' };
/** "2026-10" vira "outubro de 2026" */
const monthLong = (key: string) => {
  const [y, m] = String(key).split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(y, (m || 1) - 1, 1));
};


async function originFromHeaders() {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3741';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function tokensOf(raw: Record<string, unknown> | null | undefined): BrandTokens {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw || {})) if (typeof v === 'string') out[k] = v;
  return out as BrandTokens;
}

export default async function FeedPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const active = await getActiveClient();
  if (!active) return <EmptyState title="Escolha um cliente" text="O feed é planejado dentro de um cliente. Escolha um no topo." action={<Button href="/clientes">Ver clientes</Button>} />;
  const { client, brandKit } = active;
  const name = client.company || client.contact_name;
  const d = await db();

  const [plans, items] = await Promise.all([
    d.list('content_plans', { where: { client_id: client.id }, orderBy: 'month', desc: true }),
    d.list('content_items', { where: { client_id: client.id } }),
  ]);
  const plan = sp.plan ? plans.find((p) => p.id === sp.plan) : undefined;
  const brand = {
    name,
    color: client.brand_color || '#FF5B1F',
    logo: client.logo_url || null,
    tokens: { accent: client.brand_color || undefined, ...tokensOf(brandKit?.tokens) } as BrandTokens,
  };

  if (plan) {
    const planItems = items.filter((i) => i.plan_id === plan.id);
    const ids = new Set(planItems.map((i) => i.id));
    const batches: BatchInfo[] = (await d.list('approval_batches', { where: { client_id: client.id, item_type: 'content' }, orderBy: 'created_at', desc: true }))
      .filter((b) => b.item_ids.some((id) => ids.has(id)))
      .map((b) => ({ id: b.id, title: b.title, token: b.public_token, status: b.status, expires_at: b.expires_at, count: b.item_ids.length }));
    const origin = await originFromHeaders();
    return (
      <div className="space-y-2">
        <PageHeader
          kicker={`Criação de feed · ${name}`}
          title={
            <>
              {monthLong(plan.month)} <em>{planItems.length} peças</em>
            </>
          }
          subtitle="Calendário do mês e prévia da grade do Instagram com os tokens da marca. Clique numa peça para ver legenda, ajustar ou aprovar."
          actions={
            <Button variant="ghost" href="/marketing/feed">
              Todos os planos
            </Button>
          }
        />
        {!brandKit || brandKit.status !== 'aprovado' ? (
          <p className="mb-4 text-xs text-ink3">
            {brandKit ? 'O BrandKit ainda não foi aprovado.' : 'Este cliente ainda não tem BrandKit.'} A prévia usa as cores e fontes disponíveis.{' '}
            <Link href="/marketing/brand" className="text-accent hover:underline">Abrir Brand</Link>
          </p>
        ) : null}
        <PlanBoard plan={plan} items={planItems} brand={brand} batches={batches} origin={origin} />
      </div>
    );
  }

  const defaultMonth = (() => {
    const [y, m] = todayISO().split('-').map(Number);
    const next = new Date(y, m, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  })();

  return (
    <div className="space-y-2">
      <PageHeader
        kicker={`Criação de feed · ${name}`}
        title={
          <>
            Planeje o mês, <em>veja o perfil antes de publicar</em>
          </>
        }
        subtitle="Séries fixas, calendário de 30 dias, prévia da grade do Instagram e aprovação do cliente por link."
      />
      {sp.plan && <p className="mb-4 text-sm text-warn">Plano não encontrado para este cliente.</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {plans.length === 0 ? (
            <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="Nenhum plano de feed ainda" text="Escolha o mês, o objetivo e a quantidade de peças. A IA monta séries e calendário, e você ajusta antes de enviar ao cliente." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <TH>Mês</TH>
                  <TH>Objetivo</TH>
                  <TH className="text-right">Peças</TH>
                  <TH className="text-right">Aprovadas</TH>
                  <TH>Status</TH>
                  <TH />
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => {
                  const list = items.filter((i) => i.plan_id === p.id);
                  const ok = list.filter((i) => ['aprovado', 'agendado', 'publicado'].includes(i.status)).length;
                  return (
                    <tr key={p.id} className="hover:bg-white/[0.02]">
                      <TD>
                        <Link href={`/marketing/feed?plan=${p.id}`} className="font-medium text-ink hover:text-accent">
                          {monthLong(p.month)}
                        </Link>
                        <div className="text-xs text-ink3">criado {fmtDate(p.created_at)}</div>
                      </TD>
                      <TD className="max-w-xs"><span className="line-clamp-2 text-ink2">{p.goal || 'Sem objetivo descrito'}</span></TD>
                      <TD className="num text-right text-base">{list.length}</TD>
                      <TD className="num text-right text-base">{ok}</TD>
                      <TD>
                        <Badge tone={p.status === 'aprovado' ? 'ok' : p.status === 'em_aprovacao' ? 'warn' : 'neutral'}>{p.status === 'em_aprovacao' ? 'Em aprovação' : p.status === 'aprovado' ? 'Aprovado' : 'Rascunho'}</Badge>
                      </TD>
                      <TD className="text-right">
                        <Button variant="subtle" size="sm" href={`/marketing/feed?plan=${p.id}`}>Abrir</Button>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          <p className="text-xs text-ink3">
            Sem a chave da IA, o plano sai com 8 peças de exemplo, marcadas como rascunho. Com a chave, sai a quantidade pedida.
          </p>
        </div>
        <Card className="p-5">
          <div className="label mb-3">Planejar mês</div>
          <PlanForm clientId={client.id} defaultMonth={defaultMonth} />
        </Card>
      </div>
    </div>
  );
}
