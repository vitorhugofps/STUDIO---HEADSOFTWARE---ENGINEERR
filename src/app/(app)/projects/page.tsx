import Link from 'next/link';
import { Fragment } from 'react';
import { CalendarRange, FolderKanban } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { KIND_LABEL, STAGE_LABEL, type Client, type Project } from '@/lib/db/types';
import { cn, fmtDate } from '@/lib/utils';
import { Avatar, Badge, Card, Dot, EmptyState, Field, Input, PageHeader, PillTabs, Progress, Select, Table, TD, TH } from '@/components/ui/primitives';
import { ActionButton, ActionForm, SubmitButton } from '@/components/ui/client';
import { applyTemplateAction, projectTemplateTitles, updateProjectAction } from '@/lib/actions/ops';
import { NewProjectButton, ProgressField, ProjectFilters, ProjectsKanban, RouteDrawer, TaskCheck, type KanbanProject } from './board';

export const metadata = { title: 'Projects' };

type SP = { view?: string; client?: string; status?: string; p?: string };

const VIEWS = [
  { key: 'kanban', label: 'Kanban' },
  { key: 'lista', label: 'Lista' },
  { key: 'cronograma', label: 'Cronograma' },
] as const;
type View = (typeof VIEWS)[number]['key'];

const STATUS_LABEL: Record<Project['status'], string> = {
  ativo: 'Ativo',
  aguardando_aprovacao: 'Aguardando aprovação',
  pausado: 'Pausado',
  finalizado: 'Finalizado',
};
const STATUS_DOT: Record<Project['status'], 'rec' | 'wave' | 'idle' | 'done'> = {
  ativo: 'rec',
  aguardando_aprovacao: 'wave',
  pausado: 'idle',
  finalizado: 'done',
};

const todayBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function qs(params: Record<string, string | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `/projects?${s}` : '/projects';
}

const clientName = (c?: Client) => c?.company || c?.contact_name || 'Sem cliente';

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view: View = VIEWS.some((v) => v.key === sp.view) ? (sp.view as View) : 'kanban';
  const clientFilter = sp.client || '';
  const statusFilter = sp.status || '';
  const d = await db();
  const [projects, clients, profiles] = await Promise.all([d.list('projects', { orderBy: 'updated_at', desc: true }), d.list('clients', { orderBy: 'company' }), d.list('profiles')]);

  const today = todayBR();
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const ownerById = new Map(profiles.map((p) => [p.id, p]));
  const isLate = (p: Project) => Boolean(p.due_on && p.status !== 'finalizado' && p.due_on < today);

  // Padrão: tudo que não está finalizado. "todos" mostra também os finalizados.
  const rows = projects
    .filter((p) => !clientFilter || p.client_id === clientFilter)
    .filter((p) => (statusFilter === 'todos' ? true : statusFilter ? p.status === statusFilter : p.status !== 'finalizado'))
    .sort((a, b) => (a.due_on || '9999-12-31').localeCompare(b.due_on || '9999-12-31'));

  const here = (extra: Record<string, string | undefined> = {}) => qs({ view, client: clientFilter, status: statusFilter, ...extra });
  const tabs = VIEWS.map((v) => ({ href: qs({ view: v.key, client: clientFilter, status: statusFilter }), label: v.label }));

  const kanbanData: KanbanProject[] = rows.map((p) => ({
    id: p.id,
    title: p.title,
    kind: p.kind,
    stage: p.method_stage,
    status: p.status,
    progress: p.progress,
    due_on: p.due_on || null,
    late: isLate(p),
    clientName: clientName(clientById.get(p.client_id)),
    clientColor: clientById.get(p.client_id)?.brand_color || '#FF5B1F',
    ownerName: (p.owner_id && ownerById.get(p.owner_id)?.full_name) || null,
    href: here({ p: p.id }),
  }));

  // Detalhe (?p=id)
  const open = sp.p ? projects.find((p) => p.id === sp.p) : undefined;
  const openTasks = open ? await d.list('tasks', { where: { project_id: open.id }, orderBy: 'created_at' }) : [];
  const openTemplate = open ? await projectTemplateTitles(open.kind) : [];

  return (
    <div>
      <PageHeader
        kicker="Operação"
        title={
          <>
            Projects <em>{rows.length}</em>
          </>
        }
        subtitle="Cada projeto passa pelas cinco etapas do método: Ponto, Roteiro, Set, Estreia e Temporada."
        actions={
          <NewProjectButton
            clients={clients.map((c) => ({ id: c.id, name: clientName(c) }))}
            profiles={profiles.map((p) => ({ id: p.id, name: p.full_name }))}
            defaultOwner={user.id}
            defaultClient={clientFilter || undefined}
          />
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <PillTabs tabs={tabs} current={qs({ view, client: clientFilter, status: statusFilter })} />
        <ProjectFilters view={view} clients={clients.map((c) => ({ id: c.id, name: clientName(c) }))} client={clientFilter} status={statusFilter} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="h-5 w-5" />}
          title="Nenhum projeto aqui"
          text="Ajuste os filtros ou abra um projeto novo. Todo projeto nasce no Ponto."
        />
      ) : view === 'kanban' ? (
        <div className="space-y-3">
          <ProjectsKanban projects={kanbanData} />
          <p className="text-xs text-ink3">Arraste o cartão para mudar de etapa. O progresso sobe até o mínimo da etapa: 10, 30, 55, 80 e 100%.</p>
        </div>
      ) : view === 'lista' ? (
        <Table>
          <thead>
            <tr>
              <TH>Projeto</TH>
              <TH>Cliente</TH>
              <TH>Etapa</TH>
              <TH>Status</TH>
              <TH>Responsável</TH>
              <TH>Prazo</TH>
              <TH>Progresso</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const c = clientById.get(p.client_id);
              const owner = p.owner_id ? ownerById.get(p.owner_id) : undefined;
              const late = isLate(p);
              return (
                <tr key={p.id} className="group transition-colors hover:bg-white/[0.03]">
                  <TD className="max-w-[320px]">
                    <Link href={here({ p: p.id })} scroll={false} className="block">
                      <span className="line-clamp-2 font-medium text-ink group-hover:text-accent">{p.title}</span>
                      <span className="mt-1 block">
                        <Badge>{KIND_LABEL[p.kind]}</Badge>
                      </span>
                    </Link>
                  </TD>
                  <TD>
                    <span className="flex items-center gap-2 text-ink2">
                      <span className="dot" style={{ background: c?.brand_color || '#FF5B1F' }} />
                      {clientName(c)}
                    </span>
                  </TD>
                  <TD className="text-ink2">{STAGE_LABEL[p.method_stage]}</TD>
                  <TD>
                    <span className="flex items-center gap-2 whitespace-nowrap text-ink2">
                      <Dot state={STATUS_DOT[p.status]} />
                      {STATUS_LABEL[p.status]}
                    </span>
                  </TD>
                  <TD>
                    {owner ? (
                      <span className="flex items-center gap-2 text-ink2">
                        <Avatar name={owner.full_name} src={owner.avatar_url} size={22} />
                        {owner.full_name.split(' ')[0]}
                      </span>
                    ) : (
                      <span className="text-ink3">Sem responsável</span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap">
                    {p.due_on ? <span className={late ? 'text-err' : 'text-ink2'}>{fmtDate(p.due_on)}</span> : <span className="text-ink3">sem prazo</span>}
                    {late && <Badge tone="err" className="ml-2">atrasado</Badge>}
                  </TD>
                  <TD className="min-w-[150px]">
                    <span className="flex items-center gap-3">
                      <Progress value={p.progress} tone={p.status === 'finalizado' ? 'ok' : late ? 'err' : 'accent'} />
                      <span className="num text-xs text-ink2">{p.progress}%</span>
                    </span>
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <Timeline projects={rows} clientById={clientById} today={today} hrefFor={(id) => here({ p: id })} isLate={isLate} />
      )}

      {open && (
        <RouteDrawer title={open.title} closeHref={here({ p: undefined })}>
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{KIND_LABEL[open.kind]}</Badge>
              <Badge tone="accent">{STAGE_LABEL[open.method_stage]}</Badge>
              {isLate(open) && <Badge tone="err">atrasado</Badge>}
              <Link href={`/clientes/${open.client_id}?tab=projetos`} className="press inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-xs text-ink2 hover:text-ink">
                <span className="dot" style={{ background: clientById.get(open.client_id)?.brand_color || '#FF5B1F' }} />
                {clientName(clientById.get(open.client_id))}
              </Link>
            </div>

            <ActionForm action={updateProjectAction.bind(null, open.id)} success="Projeto atualizado" className="space-y-4">
              <Field label="Status">
                <Select name="status" defaultValue={open.status}>
                  {(Object.keys(STATUS_LABEL) as Project['status'][]).map((k) => (
                    <option key={k} value={k}>
                      {STATUS_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <ProgressField key={`${open.id}:${open.progress}`} defaultValue={open.progress} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Prazo">
                  <Input type="date" name="due_on" defaultValue={open.due_on || ''} />
                </Field>
                <Field label="Responsável">
                  <Select name="owner_id" defaultValue={open.owner_id || ''}>
                    <option value="">Sem responsável</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <SubmitButton className="w-full">Salvar alterações</SubmitButton>
            </ActionForm>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <div className="label">Tarefas do projeto</div>
                <span className="num text-xs text-ink2">
                  {openTasks.filter((t) => t.status === 'feito').length}/{openTasks.length}
                </span>
              </div>
              {openTasks.length === 0 ? (
                <p className="text-sm text-ink2">Nenhuma tarefa ainda. Aplique o modelo abaixo ou crie em Workflow.</p>
              ) : (
                <ul className="-mx-2 space-y-0.5">
                  {openTasks.map((t) => {
                    const who = t.assignee_id ? ownerById.get(t.assignee_id)?.full_name.split(' ')[0] : null;
                    const meta = [who, t.due_at ? `até ${fmtDate(t.due_at)}` : null].filter(Boolean).join(' · ');
                    return (
                      <li key={t.id}>
                        <TaskCheck id={t.id} done={t.status === 'feito'} title={t.title} meta={meta || undefined} />
                      </li>
                    );
                  })}
                </ul>
              )}
              <Link href="/workflow?who=all" className="mt-2 inline-block text-xs text-ink2 hover:text-ink">
                Abrir no Workflow
              </Link>
            </section>

            <section>
              <div className="label mb-2">Modelos de projeto</div>
              {openTemplate.length === 0 ? (
                <p className="text-sm text-ink2">Não há modelo padrão para o tipo {KIND_LABEL[open.kind]}.</p>
              ) : (
                (() => {
                  const have = new Set(openTasks.map((t) => t.title.trim().toLowerCase()));
                  const pending = openTemplate.filter((t) => !have.has(t.toLowerCase()));
                  return (
                    <>
                      <p className="mb-2 text-sm text-ink2">
                        Modelo {KIND_LABEL[open.kind]}: {openTemplate.length} tarefas padrão.
                      </p>
                      <ul className="mb-3 space-y-1">
                        {openTemplate.map((t) => (
                          <li key={t} className="flex items-start gap-2 text-sm">
                            <span className={cn('mt-1.5 dot', have.has(t.toLowerCase()) ? 'bg-ok' : 'bg-white/20')} />
                            <span className={have.has(t.toLowerCase()) ? 'text-ink3' : 'text-ink'}>{t}</span>
                          </li>
                        ))}
                      </ul>
                      {pending.length > 0 ? (
                        <ActionButton variant="subtle" action={applyTemplateAction.bind(null, open.id)} success="Tarefas do modelo criadas">
                          Aplicar modelo ({pending.length} {pending.length === 1 ? 'tarefa' : 'tarefas'})
                        </ActionButton>
                      ) : (
                        <Badge tone="ok">Modelo já aplicado</Badge>
                      )}
                    </>
                  );
                })()
              )}
            </section>
          </div>
        </RouteDrawer>
      )}
    </div>
  );
}

/* ---------- Cronograma: régua de 90 dias em CSS puro ---------- */

const DAY = 864e5;
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const WINDOW_DAYS = 90;
const LOOKBACK_DAYS = 30;

function Timeline({
  projects,
  clientById,
  today,
  hrefFor,
  isLate,
}: {
  projects: Project[];
  clientById: Map<string, Client>;
  today: string;
  hrefFor: (id: string) => string;
  isLate: (p: Project) => boolean;
}) {
  const start = dayNum(today) - LOOKBACK_DAYS;
  const end = start + WINDOW_DAYS - 1;
  const pos = (n: number) => ((n - start) / WINDOW_DAYS) * 100;

  const dated = projects.filter((p) => p.starts_on || p.due_on);
  const undated = projects.filter((p) => !p.starts_on && !p.due_on);

  // Marcas da régua: segundas-feiras em linha fina, primeiro dia do mês como rótulo.
  const mondays: number[] = [];
  const months: { n: number; label: string }[] = [{ n: start, label: new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(start * DAY)).replace('.', '') }];
  for (let n = start; n <= end; n++) {
    const dt = new Date(n * DAY);
    if (dt.getUTCDay() === 1) mondays.push(n);
    if (dt.getUTCDate() === 1 && n !== start) months.push({ n, label: new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(dt).replace('.', '') });
  }
  const todayPos = pos(dayNum(today) + 0.5);

  return (
    <div className="space-y-3">
      <Card className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[240px_1fr]">
            <div className="label border-b border-white/[0.07] px-4 py-3">Projeto</div>
            <div className="relative h-12 border-b border-white/[0.07]">
              {months.map((m) => (
                <span key={m.n} className="label absolute top-2 whitespace-nowrap pl-1.5" style={{ left: `${pos(m.n)}%` }}>
                  {m.label}
                </span>
              ))}
              <span className="label absolute bottom-1 z-10 -translate-x-1/2 whitespace-nowrap text-accent" style={{ left: `${todayPos}%` }}>
                hoje
              </span>
            </div>
          </div>

          <div className="grid grid-cols-[240px_1fr]">
            <div>
              {dated.map((p) => {
                const c = clientById.get(p.client_id);
                return (
                  <Link key={p.id} href={hrefFor(p.id)} scroll={false} className="flex h-12 flex-col justify-center border-b border-white/[0.05] px-4 hover:bg-white/[0.03]">
                    <span className="truncate text-sm text-ink">{p.title}</span>
                    <span className="truncate text-xs text-ink3">
                      {clientName(c)}
                      {p.starts_on && p.due_on ? ` · ${fmtDate(p.starts_on)} a ${fmtDate(p.due_on)}` : p.due_on ? ` · entrega ${fmtDate(p.due_on)}` : ` · início ${fmtDate(p.starts_on)}`}
                    </span>
                  </Link>
                );
              })}
            </div>

            <div className="relative">
              {/* linhas da régua */}
              {mondays.map((n) => (
                <span key={n} className="absolute inset-y-0 w-px bg-white/[0.05]" style={{ left: `${pos(n)}%` }} aria-hidden />
              ))}
              {months.slice(1).map((m) => (
                <span key={`m${m.n}`} className="absolute inset-y-0 w-px bg-white/[0.12]" style={{ left: `${pos(m.n)}%` }} aria-hidden />
              ))}
              <span className="absolute inset-y-0 z-10 w-px bg-accent" style={{ left: `${todayPos}%` }} aria-hidden />

              {dated.map((p) => {
                const s = dayNum(p.starts_on || (p.due_on as string));
                const e = dayNum(p.due_on || (p.starts_on as string));
                const from = Math.min(s, e);
                const to = Math.max(s, e);
                const late = isLate(p);
                const tone = p.status === 'finalizado' ? 'bg-ok' : late ? 'bg-err' : 'bg-accent';
                const outside = to < start || from > end;
                const cutLeft = from < start;
                const cutRight = to > end;
                const l = pos(Math.max(from, start));
                const w = ((Math.min(to, end) - Math.max(from, start) + 1) / WINDOW_DAYS) * 100;
                return (
                  <div key={p.id} className="relative h-12 border-b border-white/[0.05]">
                    {outside ? (
                      <span className={cn('absolute top-1/2 -translate-y-1/2 text-xs text-ink3', from > end ? 'right-2' : 'left-2')}>
                        {from > end ? `começa em ${fmtDate(isoOf(from))}` : `terminou em ${fmtDate(isoOf(to))}`}
                      </span>
                    ) : (
                      <Link
                        href={hrefFor(p.id)}
                        scroll={false}
                        title={`${p.title} · ${p.progress}%`}
                        className={cn('press absolute top-1/2 h-6 -translate-y-1/2 overflow-hidden bg-white/[0.1] transition-colors hover:bg-white/[0.16]', cutLeft ? 'rounded-l-sm' : 'rounded-l-full', cutRight ? 'rounded-r-sm' : 'rounded-r-full')}
                        style={{ left: `${l}%`, width: `max(${w}%, 10px)` }}
                      >
                        <span className={cn('block h-full', tone)} style={{ width: `${Math.min(100, Math.max(0, p.progress))}%` }} />
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {undated.length > 0 && (
            <Fragment>
              <div className="label border-b border-white/[0.07] px-4 py-3">Sem datas</div>
              {undated.map((p) => (
                <Link key={p.id} href={hrefFor(p.id)} scroll={false} className="flex items-center justify-between border-b border-white/[0.05] px-4 py-2.5 text-sm hover:bg-white/[0.03]">
                  <span className="truncate text-ink">{p.title}</span>
                  <span className="text-xs text-ink3">defina início e entrega no detalhe</span>
                </Link>
              ))}
            </Fragment>
          )}
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink3">
        <span className="inline-flex items-center gap-1.5"><CalendarRange className="h-3.5 w-3.5" /> Janela de 90 dias: 30 para trás e 60 para frente</span>
        <span className="inline-flex items-center gap-1.5"><span className="dot bg-accent" /> em andamento</span>
        <span className="inline-flex items-center gap-1.5"><span className="dot bg-err" /> atrasado</span>
        <span className="inline-flex items-center gap-1.5"><span className="dot bg-ok" /> finalizado</span>
      </div>
    </div>
  );
}
