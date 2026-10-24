import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, Clock, Flame, Wallet, Users, FolderKanban, Megaphone, Cpu } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { brl, fmtDate, monthKey, monthLabel, num, relTime, sum, groupBy, addDays } from '@/lib/utils';
import { Badge, Card, Dot, ListRow, Section, Stat, Avatar } from '@/components/ui/primitives';
import { AreaTrend } from '@/components/ui/charts';
import { KIND_LABEL, STAGE_LABEL } from '@/lib/db/types';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard() {
  const user = await requireUser();
  const d = await db();
  const [clients, projects, invoices, contracts, deals, campaigns, metrics, tasks, items, activity, agentRuns, events, profiles] = await Promise.all([
    d.list('clients'),
    d.list('projects'),
    d.list('invoices'),
    d.list('contracts'),
    d.list('deals'),
    d.list('campaigns'),
    d.list('campaign_metrics_daily'),
    d.list('tasks'),
    d.list('content_items'),
    d.list('activity_log', { orderBy: 'created_at', desc: true, limit: 8 }),
    d.list('agent_runs'),
    d.list('events', { orderBy: 'starts_at' }),
    d.list('profiles'),
  ]);

  const now = new Date();
  const thisMonth = monthKey(now);
  const paidThisMonth = sum(invoices.filter((i) => i.status === 'paga' && i.paid_at && monthKey(i.paid_at) === thisMonth), (i) => i.amount);
  const openThisMonth = sum(invoices.filter((i) => i.status !== 'paga' && i.status !== 'cancelada' && monthKey(i.due_on) === thisMonth), (i) => i.amount);
  const mrr = sum(contracts.filter((c) => c.status === 'assinado' && c.monthly), (c) => c.monthly || 0);
  const active = clients.filter((c) => c.status === 'ativo').length;
  const running = projects.filter((p) => p.status !== 'finalizado').length;
  const pipeline = deals.filter((dl) => !['fechado', 'perdido'].includes(dl.stage));
  const pipelineValue = sum(pipeline, (dl) => (dl.value || 0) * ((dl.probability || 0) / 100));
  const live = campaigns.filter((c) => c.status === 'ativa');
  const today = now.toISOString().slice(0, 10);
  const spendToday = sum(metrics.filter((m) => m.day === today && live.some((c) => c.id === m.campaign_id)), (m) => m.spend);
  const delivered = items.filter((i) => ['aprovado', 'agendado', 'publicado'].includes(i.status)).length;
  const aiCost = sum(agentRuns.filter((r) => monthKey(r.created_at) === thisMonth), (r) => r.cost_usd);

  const pending = items.filter((i) => i.status === 'em_aprovacao').length;
  const overdue = tasks.filter((t) => t.status !== 'feito' && t.due_at && new Date(t.due_at) < now);
  const myTasks = tasks.filter((t) => t.assignee_id === user.id && t.status !== 'feito').sort((a, b) => (a.due_at || '').localeCompare(b.due_at || ''));
  const lateInvoices = invoices.filter((i) => i.status === 'atrasada' || (i.status === 'aberta' && i.due_on < today));

  const months = Array.from({ length: 6 }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)));
  const revenue = months.map((m) => ({ m: monthLabel(m), v: sum(invoices.filter((i) => i.status === 'paga' && i.paid_at && monthKey(i.paid_at) === m), (i) => i.amount) }));

  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]));
  const health = clients
    .filter((c) => c.status === 'ativo')
    .map((c) => {
      const cp = projects.filter((p) => p.client_id === c.id && p.status !== 'finalizado');
      const late = cp.filter((p) => p.due_on && p.due_on < today).length;
      const inv = lateInvoices.filter((i) => i.client_id === c.id).length;
      const score = (late ? 2 : 0) + (inv ? 2 : 0) + (c.health === 'vermelho' ? 3 : c.health === 'amarelo' ? 1 : 0);
      return { c, late, inv, score };
    })
    .sort((a, b) => b.score - a.score);

  const upcoming = events.filter((e) => new Date(e.starts_at) >= addDays(now, -1)).slice(0, 5);
  const byStage = groupBy(projects.filter((p) => p.status !== 'finalizado'), (p) => p.method_stage);
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(now));
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="space-y-8">
      {/* Herói */}
      <section className="nevoa card overflow-hidden rounded-3xl p-7 md:p-9">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="label mb-3">{fmtDate(now, { weekday: 'long', day: '2-digit', month: 'long' })}</div>
            <h1 className="display twotone text-[44px] leading-[0.92] text-ink md:text-[56px]">
              {greet}, {user.name.split(' ')[0]}.
              <br />
              <em>
                {pending + overdue.length + lateInvoices.length > 0 ? `${pending + overdue.length + lateInvoices.length} coisas precisam de você.` : 'Tudo em dia no Studio.'}
              </em>
            </h1>
          </div>
          <div className="flex gap-2">
            <Pill href="/aprovacoes" icon={<CheckCircle2 className="h-4 w-4 text-accent" />} label="Aprovações" value={pending} />
            <Pill href="/workflow" icon={<Clock className="h-4 w-4 text-warn" />} label="Atrasadas" value={overdue.length} />
            <Pill href="/financeiro" icon={<Wallet className="h-4 w-4 text-err" />} label="Vencidas" value={lateInvoices.length} />
          </div>
        </div>
      </section>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Receita do mês" value={brl(paidThisMonth)} hint={<span>a receber {brl(openThisMonth)}</span>} icon={<Wallet className="h-4 w-4" />} accent />
        <Stat label="Recorrente (MRR)" value={brl(mrr)} hint={`${contracts.filter((c) => c.status === 'assinado').length} contratos ativos`} icon={<ArrowUpRight className="h-4 w-4" />} />
        <Stat label="Clientes ativos" value={active} hint={`${clients.length} na carteira`} icon={<Users className="h-4 w-4" />} />
        <Stat label="Projetos em andamento" value={running} hint={`${Object.entries(byStage).map(([k, v]) => `${v.length} ${STAGE_LABEL[k as keyof typeof STAGE_LABEL]}`).join(' · ')}`} icon={<FolderKanban className="h-4 w-4" />} />
        <Stat label="Pipeline ponderado" value={brl(pipelineValue)} hint={`${pipeline.length} negociações abertas`} icon={<Flame className="h-4 w-4" />} />
        <Stat label="Campanhas no ar" value={live.length} hint={`gasto hoje ${brl(spendToday)}`} icon={<Megaphone className="h-4 w-4" />} />
        <Stat label="Peças entregues" value={delivered} hint={`${items.length} no total do mês`} icon={<CheckCircle2 className="h-4 w-4" />} />
        <Stat label="Custo de IA no mês" value={`US$ ${aiCost.toFixed(2).replace('.', ',')}`} hint={`${agentRuns.length} execuções de agentes`} icon={<Cpu className="h-4 w-4" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Receita */}
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <div className="label">Receita recebida</div>
              <div className="display mt-1 text-2xl text-ink">Últimos 6 meses</div>
            </div>
            <Link href="/financeiro" className="text-xs text-ink2 hover:text-ink">
              Financeiro →
            </Link>
          </div>
          <AreaTrend data={revenue} xKey="m" yKey="v" money name="Receita" />
        </Card>

        {/* Precisa de você */}
        <Card className="p-5">
          <div className="label mb-3">Minhas tarefas</div>
          {myTasks.length === 0 ? (
            <p className="text-sm text-ink2">Nenhuma tarefa aberta para você.</p>
          ) : (
            <ul className="space-y-1">
              {myTasks.slice(0, 6).map((t) => {
                const late = t.due_at && new Date(t.due_at) < now;
                return (
                  <ListRow
                    key={t.id}
                    href="/workflow"
                    left={<Dot state={late ? 'err' : t.status === 'fazendo' ? 'rec' : 'idle'} />}
                    title={t.title}
                    meta={`${t.client_id ? clientById[t.client_id]?.company || '' : ''}${t.due_at ? ` · ${late ? 'venceu ' : ''}${fmtDate(t.due_at)}` : ''}`}
                  />
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Saúde dos clientes */}
        <Section title="Saúde dos clientes" kicker="Ordem de risco" className="lg:col-span-1">
          <Card className="divide-y divide-white/[0.05] p-2">
            {health.slice(0, 6).map(({ c, late, inv, score }) => (
              <ListRow
                key={c.id}
                href={`/clientes/${c.id}`}
                left={<span className="grid h-8 w-8 place-items-center rounded-full text-[11px] font-semibold text-black" style={{ background: c.brand_color || '#FF5B1F' }}>{(c.company || c.contact_name).slice(0, 2).toUpperCase()}</span>}
                title={c.company || c.contact_name}
                meta={[late ? `${late} projeto atrasado` : null, inv ? `${inv} fatura vencida` : null].filter(Boolean).join(' · ') || 'Em dia'}
                right={<Dot state={score >= 3 ? 'err' : score >= 1 ? 'wave' : 'done'} />}
              />
            ))}
          </Card>
        </Section>

        {/* Atividade */}
        <Section title="Atividade recente" kicker="Time">
          <Card className="p-2">
            {activity.map((a) => {
              const p = profiles.find((x) => x.id === a.actor_id);
              return <ListRow key={a.id} left={<Avatar name={a.actor_name || p?.full_name || 'Agente'} size={28} />} title={<span><span className="text-ink2">{a.actor_name || p?.full_name || 'Agente'}</span> {a.action}</span>} meta={relTime(a.created_at)} />;
            })}
          </Card>
        </Section>

        {/* Agenda */}
        <Section title="Próximos dias" kicker="Agenda">
          <Card className="p-2">
            {upcoming.length === 0 && <p className="px-3 py-4 text-sm text-ink2">Agenda livre.</p>}
            {upcoming.map((e) => (
              <ListRow
                key={e.id}
                href="/agenda"
                left={
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-center leading-none">
                    <span className="num text-base text-ink">{fmtDate(e.starts_at, { day: '2-digit' })}</span>
                    <span className="label text-[9px]">{fmtDate(e.starts_at, { month: 'short' }).replace('.', '')}</span>
                  </span>
                }
                title={e.title}
                meta={<span className="flex items-center gap-2"><Badge>{e.kind}</Badge>{e.client_id && clientById[e.client_id] ? clientById[e.client_id].company : ''}</span>}
              />
            ))}
          </Card>
        </Section>
      </div>

      {/* Projetos em andamento */}
      <Section title="Projetos em andamento" kicker="Método Ponto · Roteiro · Set · Estreia · Temporada" action={<Link href="/projects" className="text-xs text-ink2 hover:text-ink">Ver todos →</Link>}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {projects
            .filter((p) => p.status !== 'finalizado')
            .slice(0, 8)
            .map((p) => {
              const c = clientById[p.client_id];
              return (
                <Link key={p.id} href={`/clientes/${p.client_id}?tab=projetos`} className="card press group p-4 hover:border-white/15">
                  <div className="mb-3 flex items-center justify-between">
                    <Badge tone="neutral">{KIND_LABEL[p.kind]}</Badge>
                    <span className="label">{STAGE_LABEL[p.method_stage]}</span>
                  </div>
                  <div className="line-clamp-2 text-sm font-medium text-ink">{p.title}</div>
                  <div className="mt-1 text-xs text-ink3">{c?.company || c?.contact_name}</div>
                  <div className="mt-4 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${p.progress}%` }} />
                    </div>
                    <span className="num text-xs text-ink2">{p.progress}%</span>
                  </div>
                </Link>
              );
            })}
        </div>
      </Section>
    </div>
  );
}

function Pill({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: number }) {
  return (
    <Link href={href} className="glass press flex items-center gap-3 rounded-2xl px-4 py-3 hover:bg-white/[0.08]">
      {icon}
      <span className="num text-2xl text-ink">{value}</span>
      <span className="text-xs text-ink2">{label}</span>
    </Link>
  );
}
