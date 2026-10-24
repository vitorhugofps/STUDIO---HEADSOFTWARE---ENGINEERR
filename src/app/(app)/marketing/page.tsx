import Link from 'next/link';
import { BarChart3, Megaphone, Plus } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveClient } from '@/lib/active-client';
import { KIND_LABEL } from '@/lib/db/types';
import type { Campaign, CampaignMetric, ContentItem, VideoProject } from '@/lib/db/types';
import { brl, brlCents, fmtDate, num, pct, relTime, sum, todayISO } from '@/lib/utils';
import { Badge, Button, Card, Dot, EmptyState, Example, ListRow, PillTabs, Progress, Stat, Table, TD, TH } from '@/components/ui/primitives';
import { ActionButton } from '@/components/ui/client';
import { AreaTrend, Bars } from '@/components/ui/charts';
import { generateInsightsAction } from '@/lib/actions/marketing';

export const metadata = { title: 'Campanha' };

const PERIODS = [7, 30, 90] as const;
/** "2026-10" vira "outubro de 2026" */
const monthLong = (key: string) => {
  const [y, m] = String(key).split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(y, (m || 1) - 1, 1));
};


const CAMPAIGN_STATUS: Record<Campaign['status'], { label: string; dot: 'idle' | 'rec' | 'wave' | 'done' | 'off' }> = {
  rascunho: { label: 'Rascunho', dot: 'idle' },
  kit_zero: { label: 'Kit Zero', dot: 'idle' },
  pronta: { label: 'Pronta', dot: 'wave' },
  pausada: { label: 'Pausada', dot: 'off' },
  ativa: { label: 'Ativa', dot: 'rec' },
  encerrada: { label: 'Encerrada', dot: 'done' },
};
const OBJECTIVE_LABEL: Record<string, string> = {
  mensagens: 'Mensagens no WhatsApp',
  leads: 'Leads',
  vendas: 'Vendas no site',
  trafego_perfil: 'Tráfego para o perfil',
  visualizacoes: 'Visualizações',
  engajamento: 'Engajamento',
};
const FEED_STATUS: [ContentItem['status'], string][] = [
  ['rascunho', 'Rascunho'],
  ['revisado', 'Revisado'],
  ['em_aprovacao', 'Em aprovação'],
  ['ajustar', 'Ajustar'],
  ['aprovado', 'Aprovado'],
  ['agendado', 'Agendado'],
  ['publicado', 'Publicado'],
];
const VIDEO_STATUS: [VideoProject['status'], string][] = [
  ['rascunho', 'Rascunho'],
  ['roteiro', 'Roteiro'],
  ['edicao', 'Em edição'],
  ['revisao', 'Revisão'],
  ['aprovado', 'Aprovado'],
  ['entregue', 'Entregue'],
];
const MODULE: Record<string, { label: string; href: string }> = {
  trafego: { label: 'Tráfego', href: '/marketing/trafego' },
  feed: { label: 'Feed', href: '/marketing/feed' },
  videos: { label: 'Vídeos', href: '/marketing/videos' },
  brand: { label: 'Brand', href: '/marketing/brand' },
  campanha: { label: 'Campanha', href: '/marketing' },
};
const FREQ_LABEL: Record<string, string> = { diario: 'Diário', semanal: 'Semanal', fim: 'No fim da campanha' };

type Insight = { achado?: string; evidencia?: string; acao?: string; modulo?: string };

function isoDay(offset = 0) {
  const x = new Date();
  x.setUTCDate(x.getUTCDate() + offset);
  return x.toISOString().slice(0, 10);
}

function dayLabel(day: string) {
  return fmtDate(`${day}T12:00:00Z`);
}

function daysUntil(due: string) {
  return Math.round((Date.parse(`${due.slice(0, 10)}T12:00:00Z`) - Date.parse(`${todayISO()}T12:00:00Z`)) / 86400000);
}

function hexToRgb(hex?: string | null) {
  const h = (hex || '#FF5B1F').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  if (Number.isNaN(n)) return '255 91 31';
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function totals(rows: CampaignMetric[]) {
  const spend = sum(rows, (m) => m.spend);
  const results = sum(rows, (m) => m.results);
  return {
    spend,
    reach: sum(rows, (m) => m.reach),
    impressions: sum(rows, (m) => m.impressions),
    clicks: sum(rows, (m) => m.clicks),
    results,
    cpr: results ? spend / results : 0,
  };
}

function versus(cur: number, prev: number) {
  if (!prev || !cur) return null;
  const change = Math.round(((cur - prev) / prev) * 100);
  if (change === 0) return 'igual ao período anterior';
  return `${change > 0 ? '+' : '-'}${Math.abs(change)}% vs. período anterior`;
}

export default async function CampanhaPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const active = await getActiveClient();
  if (!active) {
    return <EmptyState icon={<Megaphone className="h-5 w-5" />} title="Escolha um cliente" text="A campanha é acompanhada dentro de um cliente. Escolha um no topo." action={<Button href="/clientes">Ver clientes</Button>} />;
  }
  const { client } = active;
  const name = client.company || client.contact_name;
  const period = (PERIODS as readonly number[]).includes(Number(sp.p)) ? Number(sp.p) : 30;
  const d = await db();

  const [campaigns, items, plans, videos, projects, subs, reports] = await Promise.all([
    d.list('campaigns', { where: { client_id: client.id } }),
    d.list('content_items', { where: { client_id: client.id } }),
    d.list('content_plans', { where: { client_id: client.id } }),
    d.list('video_projects', { where: { client_id: client.id } }),
    d.list('projects', { where: { client_id: client.id } }),
    d.list('report_subscriptions', { where: { client_id: client.id } }),
    d.list('research_reports', { where: { client_id: client.id, kind: 'insights' }, orderBy: 'created_at', desc: true, limit: 1 }),
  ]);
  const ids = campaigns.map((c) => c.id);
  const metrics = ids.length ? await d.list('campaign_metrics_daily', { where: { campaign_id: ids }, orderBy: 'day' }) : [];

  /* Período atual e anterior */
  const since = isoDay(-(period - 1));
  const prevSince = isoDay(-(period * 2 - 1));
  const cur = metrics.filter((m) => m.day.slice(0, 10) >= since);
  const prev = metrics.filter((m) => m.day.slice(0, 10) >= prevSince && m.day.slice(0, 10) < since);
  const t = totals(cur);
  const p = totals(prev);
  const ctr = t.impressions ? t.clicks / t.impressions : 0;
  const hasData = cur.length > 0;

  /* Série diária (todos os dias do período, mesmo sem dado) */
  const byDay = new Map<string, { spend: number; results: number }>();
  for (const m of cur) {
    const k = m.day.slice(0, 10);
    const row = byDay.get(k) || { spend: 0, results: 0 };
    row.spend += Number(m.spend) || 0;
    row.results += Number(m.results) || 0;
    byDay.set(k, row);
  }
  const series = Array.from({ length: period }, (_, i) => {
    const day = isoDay(-(period - 1 - i));
    const v = byDay.get(day) || { spend: 0, results: 0 };
    return { dia: dayLabel(day), investimento: Math.round(v.spend * 100) / 100, resultados: v.results };
  });

  /* Campanhas */
  const rank = campaigns
    .map((c) => {
      const rows = cur.filter((m) => m.campaign_id === c.id);
      const spend = sum(rows, (m) => m.spend);
      const results = sum(rows, (m) => m.results);
      return { c, spend, results, cpr: results ? spend / results : 0, rows: rows.length };
    })
    .sort((a, b) => b.spend - a.spend || a.c.name.localeCompare(b.c.name))
    .slice(0, 8);
  const running = campaigns.filter((c) => c.status === 'ativa').length;

  /* Insights */
  const report = reports[0];
  const findings = (report?.findings || {}) as { insights?: Insight[]; is_example?: boolean };
  const insights = Array.isArray(findings.insights) ? findings.insights : [];

  /* Recorrência de conteúdo no mês corrente */
  const month = todayISO().slice(0, 7);
  const planIds = new Set(plans.filter((pl) => pl.month === month).map((pl) => pl.id));
  const monthItems = items.filter((i) => planIds.has(i.plan_id) || (i.scheduled_at || '').startsWith(month));
  const approved = monthItems.filter((i) => ['aprovado', 'agendado', 'publicado'].includes(i.status)).length;
  const approvedPct = monthItems.length ? Math.round((approved / monthItems.length) * 100) : 0;

  /* Próximas entregas */
  const upcoming = projects
    .filter((pr) => pr.status !== 'finalizado' && pr.due_on)
    .sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)))
    .slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Hero com a cor do cliente */}
      <section className="nevoa card relative overflow-hidden rounded-3xl p-7" style={{ ['--accent' as any]: hexToRgb(client.brand_color) }}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="label">Campanha · {name}</div>
            <h1 className="display twotone mt-2 text-[40px] leading-[0.92] text-ink md:text-[48px]">
              {hasData ? (
                <>
                  {brl(t.spend)} <em>investidos em {period} dias</em>
                </>
              ) : (
                <>
                  Sem métricas <em>nos últimos {period} dias</em>
                </>
              )}
            </h1>
            <p className="mt-3 max-w-xl text-sm text-ink2">
              {hasData
                ? `${num(t.results)} ${t.results === 1 ? 'resultado' : 'resultados'}${t.results ? ` a ${brlCents(t.cpr)} cada` : ''}, ${running} ${running === 1 ? 'campanha ativa' : 'campanhas ativas'} agora. Feed e vídeos do mês aparecem ao lado.`
                : 'Quando houver campanha rodando, o investimento e os resultados aparecem aqui. Feed e vídeos do mês já estão ao lado.'}
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <PillTabs tabs={PERIODS.map((n) => ({ href: `/marketing?p=${n}`, label: `${n} dias` }))} current={`/marketing?p=${period}`} />
            <Button variant="glass" size="sm" href="/marketing/trafego">
              Abrir tráfego
            </Button>
          </div>
        </div>
      </section>

      {/* Resumo */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Resumo do período">
        <Stat label="Investimento" value={brl(t.spend)} hint={versus(t.spend, p.spend) || `${period} dias`} />
        <Stat label="Alcance" value={num(t.reach)} hint={versus(t.reach, p.reach) || 'pessoas alcançadas'} />
        <Stat label="Cliques" value={num(t.clicks)} hint={t.impressions ? `CTR ${pct(ctr)}` : 'no link'} />
        <Stat label="Resultados" value={num(t.results)} hint={versus(t.results, p.results) || 'conforme o objetivo'} />
        <Stat label="Custo por resultado" value={t.results ? brlCents(t.cpr) : '–'} hint={versus(t.cpr, p.cpr) || 'investimento ÷ resultados'} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Série diária */}
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="label">Dia a dia</div>
                <h2 className="display text-xl text-ink">Investimento x resultados</h2>
              </div>
              <span className="text-xs text-ink3">{period} dias, todas as campanhas</span>
            </div>
            {hasData ? (
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs text-ink2">Investimento por dia (R$)</div>
                  <AreaTrend data={series} xKey="dia" yKey="investimento" name="Investimento (R$)" height={200} />
                </div>
                <div>
                  <div className="mb-1 text-xs text-ink2">Resultados por dia</div>
                  <Bars data={series} xKey="dia" yKey="resultados" name="Resultados" height={200} highlightLast />
                </div>
              </div>
            ) : (
              <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-white/15 px-6 py-10 text-center">
                <BarChart3 className="h-5 w-5 text-ink3" />
                <p className="max-w-sm text-sm text-ink2">Sem métricas neste período. Crie uma campanha ou espere o primeiro dia de veiculação.</p>
              </div>
            )}
          </Card>

          {/* Campanhas */}
          <section className="space-y-3" aria-label="Campanhas">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="label">Campanhas</div>
                <h2 className="display text-xl text-ink">Quem gastou e quem deu resultado</h2>
              </div>
              <Button variant="subtle" size="sm" href="/marketing/trafego">
                Ver todas
              </Button>
            </div>
            {rank.length === 0 ? (
              <EmptyState
                icon={<Megaphone className="h-5 w-5" />}
                title="Nenhuma campanha ainda"
                text="No Tráfego você escolhe o objetivo, a verba e os criativos, e o Kit Zero sai pronto para revisar."
                action={
                  <Button variant="glass" href="/marketing/trafego">
                    <Plus className="h-4 w-4" /> Criar campanha
                  </Button>
                }
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <TH>Campanha</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Investido</TH>
                    <TH className="text-right">Resultados</TH>
                    <TH className="text-right">Custo por resultado</TH>
                  </tr>
                </thead>
                <tbody>
                  {rank.map(({ c, spend, results, cpr, rows }) => (
                    <tr key={c.id} className="hover:bg-white/[0.02]">
                      <TD className="max-w-[260px]">
                        <Link href={`/marketing/trafego?t=campanhas&c=${c.id}`} className="block truncate font-medium text-ink hover:text-accent">
                          {c.name}
                        </Link>
                        <div className="truncate text-xs text-ink3">{OBJECTIVE_LABEL[c.objective || ''] || c.objective || 'Sem objetivo'}</div>
                      </TD>
                      <TD>
                        <span className="inline-flex items-center gap-2 whitespace-nowrap text-ink2">
                          <Dot state={CAMPAIGN_STATUS[c.status].dot} /> {CAMPAIGN_STATUS[c.status].label}
                        </span>
                      </TD>
                      <TD className="num whitespace-nowrap text-right text-base">{rows ? brl(spend) : '–'}</TD>
                      <TD className="num whitespace-nowrap text-right text-base">{rows ? num(results) : '–'}</TD>
                      <TD className="num whitespace-nowrap text-right text-base">{results ? brlCents(cpr) : '–'}</TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>

          {/* Insights */}
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="label">Insights do agente</div>
                <h2 className="display text-xl text-ink">
                  O que fazer a seguir
                  <Example show={!!findings.is_example} />
                </h2>
                <p className="mt-1 text-xs text-ink3">
                  {report ? `Gerado ${relTime(report.created_at)}, com os últimos 30 dias de campanhas, feed e vídeos.` : 'Cruza campanhas, feed e vídeos dos últimos 30 dias e devolve ações com o módulo certo.'}
                </p>
              </div>
              <ActionButton action={generateInsightsAction.bind(null, client.id)} success="Insights gerados">
                {report ? 'Atualizar insights' : 'Gerar insights'}
              </ActionButton>
            </div>
            {insights.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 px-6 py-8 text-center text-sm text-ink2">
                Nenhum insight gerado ainda. Gere agora para ver achados, evidências e a próxima ação de cada módulo.
              </div>
            ) : (
              <ul className="space-y-3">
                {insights.map((it, i) => {
                  const mod = MODULE[String(it.modulo || '').toLowerCase()];
                  return (
                    <li key={i} className="rounded-2xl border border-white/[0.07] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium leading-relaxed text-ink">{it.achado}</p>
                        {mod ? (
                          <Link href={mod.href} className="shrink-0">
                            <Badge tone="accent">{mod.label}</Badge>
                          </Link>
                        ) : it.modulo ? (
                          <Badge className="shrink-0">{it.modulo}</Badge>
                        ) : null}
                      </div>
                      {it.evidencia && <p className="mt-1.5 text-xs text-ink3">{it.evidencia}</p>}
                      {it.acao && (
                        <p className="mt-2 text-sm leading-relaxed text-ink2">
                          <span className="font-medium text-ink">Ação:</span> {it.acao}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          {/* Recorrência de conteúdo */}
          <Card className="p-5">
            <div className="label">Recorrência de conteúdo</div>
            <h2 className="display mt-1 text-xl text-ink">Feed de {monthLong(month)}</h2>
            {monthItems.length === 0 ? (
              <p className="mt-3 text-sm text-ink2">Nenhuma peça planejada para este mês. Sem plano, o perfil fica sem cadência.</p>
            ) : (
              <>
                <div className="mt-3 flex items-baseline justify-between text-sm">
                  <span className="text-ink2">
                    <b className="num text-base text-ink">{approved}</b> de {monthItems.length} aprovadas
                  </span>
                  <span className="num text-base text-ink">{approvedPct}%</span>
                </div>
                <Progress value={approvedPct} tone={approvedPct >= 70 ? 'ok' : 'accent'} className="mt-2" />
                <Counts rows={FEED_STATUS.map(([s, label]) => [label, monthItems.filter((i) => i.status === s).length])} />
              </>
            )}
            <Button variant="subtle" size="sm" href="/marketing/feed" className="mt-4">
              Abrir feed
            </Button>

            <div className="hairline my-5" />

            <div className="label">Vídeos</div>
            <h2 className="display mt-1 text-xl text-ink">{videos.length} {videos.length === 1 ? 'vídeo' : 'vídeos'} no pipeline</h2>
            {videos.length === 0 ? (
              <p className="mt-3 text-sm text-ink2">Nenhum vídeo aberto. Envie o material bruto e abra o primeiro roteiro.</p>
            ) : (
              <Counts rows={VIDEO_STATUS.map(([s, label]) => [label, videos.filter((v) => v.status === s).length])} />
            )}
            <Button variant="subtle" size="sm" href="/marketing/videos?v=reels" className="mt-4">
              Abrir vídeos
            </Button>
          </Card>

          {/* Próximas entregas */}
          <Card className="p-3">
            <div className="flex items-end justify-between px-3 pb-2 pt-2">
              <div>
                <div className="label">Próximas entregas</div>
                <h2 className="display mt-1 text-xl text-ink">Projetos com data</h2>
              </div>
            </div>
            {upcoming.length === 0 ? (
              <p className="px-3 pb-3 text-sm text-ink2">Nenhum projeto aberto com data de entrega.</p>
            ) : (
              <div>
                {upcoming.map((pr) => {
                  const n = daysUntil(String(pr.due_on));
                  const tone = n < 0 ? 'err' : n <= 3 ? 'warn' : 'neutral';
                  const rel = n < 0 ? `${-n} ${n === -1 ? 'dia' : 'dias'} de atraso` : n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`;
                  return (
                    <ListRow
                      key={pr.id}
                      href={`/clientes/${client.id}?tab=projetos`}
                      title={pr.title}
                      meta={`${KIND_LABEL[pr.kind] || pr.kind} · ${fmtDate(`${String(pr.due_on).slice(0, 10)}T12:00:00Z`)}`}
                      right={<Badge tone={tone}>{rel}</Badge>}
                    />
                  );
                })}
              </div>
            )}
          </Card>

          {/* Relatórios por e-mail */}
          <Card className="p-5">
            <div className="label">Relatórios por e-mail</div>
            <h2 className="display mt-1 text-xl text-ink">
              {subs.length} {subs.length === 1 ? 'envio configurado' : 'envios configurados'}
            </h2>
            {subs.length === 0 ? (
              <p className="mt-3 text-sm text-ink2">Nenhum relatório agendado. Configure para o cliente receber o resultado sem pedir.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {subs.map((s) => (
                  <li key={s.id} className="flex items-start gap-3">
                    <Dot state={s.active ? 'done' : 'off'} className="mt-1.5" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink" title={(s.emails || []).join(', ')}>
                        {(s.emails || []).join(', ') || 'Sem destinatário'}
                      </div>
                      <div className="mt-0.5 text-xs text-ink3">
                        {s.audience === 'cliente' ? 'Cliente' : 'Interno'} · {FREQ_LABEL[s.frequency] || s.frequency}
                        {s.frequency !== 'fim' ? ` às ${s.send_hour}h` : ''}
                        {s.active ? '' : ' · pausado'}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="subtle" size="sm" href="/marketing/trafego?t=relatorios" className="mt-4">
              Gerenciar relatórios
            </Button>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Counts({ rows }: { rows: [string, number][] }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
      {rows.map(([label, n]) => (
        <div key={label} className="flex items-baseline justify-between gap-2">
          <dt className={n ? 'text-ink2' : 'text-ink3'}>{label}</dt>
          <dd className={n ? 'num text-base text-ink' : 'num text-base text-ink3'}>{n}</dd>
        </div>
      ))}
    </dl>
  );
}
