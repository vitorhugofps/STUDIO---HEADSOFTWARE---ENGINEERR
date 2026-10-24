import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import type { Job } from '@/lib/db/types';
import { fmtDate, relTime } from '@/lib/utils';
import { Badge, Card, Dot, EmptyState, Input, PageHeader, PillTabs, Progress, Section, Select, Stat, Table, TD, TH, Textarea, Field } from '@/components/ui/primitives';
import { ActionButton, ActionForm, SubmitButton } from '@/components/ui/client';
import { createTaskAction, createWorkflowAction, setJobStatusAction } from '@/lib/actions/ops';
import { TasksKanban, WorkflowToggle, type TaskCardData } from './tasks';

export const metadata = { title: 'Workflow' };

type SP = { who?: string };

const JOB_ORDER: Job['status'][] = ['erro', 'revisao', 'rodando', 'fila', 'concluido', 'cancelado'];
const JOB_DOT: Record<Job['status'], 'rec' | 'idle' | 'wave' | 'done' | 'err' | 'off'> = {
  rodando: 'rec',
  fila: 'idle',
  revisao: 'wave',
  concluido: 'done',
  erro: 'err',
  cancelado: 'off',
};
const JOB_LABEL: Record<Job['status'], string> = {
  rodando: 'Rodando',
  fila: 'Na fila',
  revisao: 'Em revisão',
  concluido: 'Concluído',
  erro: 'Erro',
  cancelado: 'Cancelado',
};
const RUNNER_LABEL: Record<Job['runner'], string> = { cloud: 'Nuvem', local_yuri: 'Mac do Yuri', local_vitor: 'Mac do Vitor' };
const JOB_KIND: Record<string, string> = {
  render_reel: 'Render de Reel',
  gerar_feed: 'Geração de feed',
  relatorio_diario: 'Relatório diário',
};
const jobKind = (k: string) => JOB_KIND[k] || k.replace(/_/g, ' ');

/** SLAs do Studio. A contagem de atrasadas usa palavras do título da tarefa. */
const SLAS = [
  { key: 'resposta', name: 'Primeira resposta', target: '1 h útil', rule: 'Do contato do lead até a primeira mensagem do Studio.', match: /resposta|responder|lead/i },
  { key: 'proposta', name: 'Proposta', target: '48 h', rule: 'Do Diagnóstico até a proposta apresentada ao vivo.', match: /proposta|or[çc]amento/i },
  { key: 'aprovacao', name: 'Aprovação do cliente', target: '3 dias', rule: 'Do envio do lote até a resposta no portal de aprovação.', match: /aprova/i },
  { key: 'followup', name: 'Follow-up', target: 'D+2 · D+5 · D+10', rule: 'Depois da proposta, três retornos: dias 2, 5 e 10.', match: /follow-?up/i },
] as const;
// Follow-up vem primeiro porque o título "Follow-up da proposta" também cita proposta.
const CLASSIFY_ORDER = ['followup', 'proposta', 'aprovacao', 'resposta'] as const;

export default async function WorkflowPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const who = sp.who === 'all' ? 'all' : 'me';
  const d = await db();
  const [tasks, projects, clients, profiles, jobs, workflows] = await Promise.all([
    d.list('tasks'),
    d.list('projects', { orderBy: 'title' }),
    d.list('clients'),
    d.list('profiles'),
    d.list('jobs', { orderBy: 'created_at', desc: true }),
    d.list('workflows', { orderBy: 'created_at' }),
  ]);

  const now = Date.now();
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const isLate = (t: { status: string; due_at?: string | null }) => t.status !== 'feito' && !!t.due_at && new Date(t.due_at).getTime() < now;

  const open = tasks.filter((t) => t.status !== 'feito');
  const mine = open.filter((t) => t.assignee_id === user.id);
  const overdue = open.filter(isLate);

  // Kanban: as feitas aparecem só nos últimos 14 dias para a coluna não crescer sem fim.
  const cutoff = now - 14 * 864e5;
  const visible = tasks
    .filter((t) => (who === 'all' ? true : t.assignee_id === user.id))
    .filter((t) => t.status !== 'feito' || new Date(t.updated_at || t.created_at).getTime() >= cutoff)
    .sort((a, b) => a.priority - b.priority || (a.due_at || '9999').localeCompare(b.due_at || '9999'));

  const cards: TaskCardData[] = visible.map((t) => {
    const project = t.project_id ? projectById.get(t.project_id) : undefined;
    const client = clientById.get(t.client_id || project?.client_id || '');
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_at: t.due_at || null,
      late: isLate(t),
      project: project?.title || null,
      client: client ? client.company || client.contact_name : null,
      clientColor: client?.brand_color || null,
      assignee: (t.assignee_id && profileById.get(t.assignee_id)?.full_name) || null,
    };
  });

  const sortedJobs = [...jobs].sort((a, b) => JOB_ORDER.indexOf(a.status) - JOB_ORDER.indexOf(b.status) || b.created_at.localeCompare(a.created_at));

  const slaCount = Object.fromEntries(SLAS.map((s) => [s.key, 0])) as Record<(typeof SLAS)[number]['key'], number>;
  let otherOverdue = 0;
  for (const t of overdue) {
    const key = CLASSIFY_ORDER.find((k) => SLAS.find((s) => s.key === k)!.match.test(t.title));
    if (key) slaCount[key]++;
    else otherOverdue++;
  }

  const openProjects = projects.filter((p) => p.status !== 'finalizado');
  const triggers = Array.from(new Set(workflows.map((w) => w.trigger)));

  return (
    <div className="space-y-10">
      <div>
        <PageHeader
          kicker="Operação"
          title={
            <>
              Workflow <em>{open.length}</em>
            </>
          }
          subtitle="Tarefas, fila de agentes, automações e os prazos que o Studio promete ao cliente."
        />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <PillTabs
            tabs={[
              { href: '/workflow?who=me', label: 'Minhas tarefas', count: mine.length },
              { href: '/workflow?who=all', label: 'Todas', count: open.length },
            ]}
            current={`/workflow?who=${who}`}
          />
          <span className="text-xs text-ink3">
            {overdue.length > 0 ? `${overdue.length} ${overdue.length === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'} no Studio` : 'Nenhuma tarefa atrasada'}
          </span>
        </div>

        <Card className="mb-4 p-3">
          <ActionForm action={createTaskAction} success="Tarefa criada" resetOnSuccess className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_150px_150px_110px_auto]">
            <Input name="title" placeholder="Nova tarefa" aria-label="Título da tarefa" required />
            <Select name="project_id" aria-label="Projeto" defaultValue="">
              <option value="">Sem projeto</option>
              {openProjects.map((p) => {
                const c = clientById.get(p.client_id);
                return (
                  <option key={p.id} value={p.id}>
                    {c ? `${c.company || c.contact_name} · ` : ''}
                    {p.title}
                  </option>
                );
              })}
            </Select>
            <Select name="assignee_id" aria-label="Responsável" defaultValue={user.id}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
            <Input type="date" name="due" aria-label="Prazo" />
            <Select name="priority" aria-label="Prioridade" defaultValue="2">
              <option value="1">Alta</option>
              <option value="2">Média</option>
              <option value="3">Baixa</option>
            </Select>
            <SubmitButton>Criar tarefa</SubmitButton>
          </ActionForm>
        </Card>

        <TasksKanban tasks={cards} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section title="Fila de agentes" kicker="Jobs" className="lg:col-span-2">
          {sortedJobs.length === 0 ? (
            <EmptyState title="Fila vazia" text="Quando um agente ou um Mac do time rodar um render, ele aparece aqui com progresso e log." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <TH>Status</TH>
                  <TH>Job</TH>
                  <TH>Onde roda</TH>
                  <TH>Progresso</TH>
                  <TH>Log</TH>
                  <TH className="text-right">Ações</TH>
                </tr>
              </thead>
              <tbody>
                {sortedJobs.map((j) => {
                  const client = j.client_id ? clientById.get(j.client_id) : undefined;
                  const live = j.status === 'rodando' || j.status === 'fila' || j.status === 'revisao';
                  return (
                    <tr key={j.id} className="transition-colors hover:bg-white/[0.03]">
                      <TD>
                        <span className="flex items-center gap-2 whitespace-nowrap text-ink2">
                          <Dot state={JOB_DOT[j.status]} />
                          {JOB_LABEL[j.status]}
                        </span>
                      </TD>
                      <TD>
                        <span className="block font-medium text-ink">{jobKind(j.kind)}</span>
                        <span className="block text-xs text-ink3">
                          {client ? client.company || client.contact_name : 'Studio'} · {relTime(j.started_at || j.created_at)}
                        </span>
                      </TD>
                      <TD>
                        <Badge>{RUNNER_LABEL[j.runner]}</Badge>
                      </TD>
                      <TD className="min-w-[130px]">
                        <span className="flex items-center gap-3">
                          <Progress value={j.progress} tone={j.status === 'erro' ? 'err' : j.status === 'concluido' ? 'ok' : 'accent'} />
                          <span className="num text-xs text-ink2">{j.progress}%</span>
                        </span>
                      </TD>
                      <TD className="max-w-[260px]">
                        <span className="line-clamp-2 text-xs text-ink2" title={j.log || undefined}>
                          {j.log || 'Sem log'}
                        </span>
                      </TD>
                      <TD>
                        <span className="flex justify-end gap-1.5">
                          {live && (
                            <>
                              <ActionButton size="sm" variant="subtle" action={setJobStatusAction.bind(null, j.id, 'concluido')} success="Job concluído">
                                Concluir
                              </ActionButton>
                              <ActionButton size="sm" variant="ghost" action={setJobStatusAction.bind(null, j.id, 'cancelado')} confirm="Cancelar este job?" success="Job cancelado">
                                Cancelar
                              </ActionButton>
                            </>
                          )}
                        </span>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Section>

        <Section title="SLAs do Studio" kicker="Prazos prometidos">
          <Stat label="Tarefas atrasadas" value={overdue.length} hint={`${overdue.filter((t) => t.assignee_id === user.id).length} são suas`} />
          <div className="space-y-3">
            {SLAS.map((s) => {
              const n = slaCount[s.key];
              return (
                <Card key={s.key} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-ink">{s.name}</div>
                      <div className="num mt-1.5 text-2xl text-ink">{s.target}</div>
                    </div>
                    <Badge tone={n > 0 ? 'err' : 'ok'}>{n > 0 ? `${n} ${n === 1 ? 'atrasada' : 'atrasadas'}` : 'sem atraso'}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-ink2">{s.rule}</p>
                </Card>
              );
            })}
          </div>
          <p className="text-xs text-ink3">
            Contagem pelas palavras do título da tarefa.{otherOverdue > 0 ? ` Outras ${otherOverdue} atrasadas não entram em nenhum SLA.` : ''}
          </p>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section title="Automações" kicker="Quando X, faça Y" className="lg:col-span-2">
          {workflows.length === 0 ? (
            <EmptyState title="Nenhuma automação" text="Crie a primeira ao lado: diga o gatilho e o que deve acontecer." />
          ) : (
            <Card className="divide-y divide-white/[0.05] p-2">
              {workflows.map((w) => (
                <div key={w.id} className="flex items-center gap-4 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className={w.active ? 'text-sm font-medium text-ink' : 'text-sm font-medium text-ink3'}>{w.name}</div>
                    <div className="mt-1 text-xs text-ink2">
                      <span className="text-ink3">Quando</span> {w.trigger}
                      <span className="mx-1.5 text-ink3">·</span>
                      <span className="text-ink3">Faça</span> {w.action}
                    </div>
                  </div>
                  <span className="hidden text-xs text-ink3 sm:block">{w.active ? 'Ativa' : 'Pausada'}</span>
                  <WorkflowToggle id={w.id} active={w.active} name={w.name} />
                </div>
              ))}
            </Card>
          )}
        </Section>

        <Section title="Nova automação" kicker="Regra">
          <Card className="p-5">
            <ActionForm action={createWorkflowAction} success="Automação criada" resetOnSuccess className="space-y-3">
              <Field label="Quando" required hint="O gatilho. Ex.: Proposta marcada como aceita">
                <Input name="trigger" list="workflow-triggers" required />
              </Field>
              <datalist id="workflow-triggers">
                {triggers.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <Field label="Faça" required hint="A ação. Ex.: Gerar contrato e avisar o comercial">
                <Textarea name="action" className="min-h-[72px]" required />
              </Field>
              <Field label="Nome" hint="Opcional. Sem nome, usamos o gatilho.">
                <Input name="name" />
              </Field>
              <SubmitButton variant="subtle" className="w-full">
                Criar automação
              </SubmitButton>
            </ActionForm>
          </Card>
        </Section>
      </div>
    </div>
  );
}
