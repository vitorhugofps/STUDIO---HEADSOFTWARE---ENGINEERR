import { requireUser, AUTH_EMAIL_DOMAIN } from '@/lib/auth';
import { isSupabaseMode } from '@/lib/config';
import { db } from '@/lib/db';
import { ROLE_LABEL, type Job, type Role } from '@/lib/db/types';
import { Avatar, Badge, Card, Dot, EmptyState, PageHeader, Progress, Section, Table, TD, TH } from '@/components/ui/primitives';
import { relTime } from '@/lib/utils';
import { InviteButton } from './invite';

export const metadata = { title: 'Team' };

const STATUS: Record<string, { label: string; dot: 'idle' | 'rec' | 'done' | 'wave' | 'off' }> = {
  disponivel: { label: 'Disponível', dot: 'done' },
  em_set: { label: 'Em set', dot: 'rec' },
  ocupado: { label: 'Ocupado', dot: 'wave' },
  ausente: { label: 'Ausente', dot: 'off' },
};

const RUNNERS: { key: Job['runner']; name: string; what: string }[] = [
  { key: 'cloud', name: 'Nuvem', what: 'Agentes de IA e relatórios' },
  { key: 'local_yuri', name: 'Mac do Yuri', what: 'Worker de vídeo' },
  { key: 'local_vitor', name: 'Mac do Vitor', what: 'Worker local' },
];

const JOB_KIND: Record<string, string> = { render_reel: 'Render de Reel', gerar_feed: 'Geração de feed', relatorio_diario: 'Relatório diário' };
const jobKind = (k: string) => JOB_KIND[k] || k.replace(/_/g, ' ');

/** Resumo do que cada papel usa. O menu lateral esconde o que o papel não acessa. */
const PERMISSIONS: { role: Role; areas: string[] }[] = [
  { role: 'admin', areas: ['Tudo'] },
  { role: 'developer', areas: ['Sites', 'Integrações', 'Jobs'] },
  { role: 'comercial', areas: ['Clientes', 'Vendas', 'Contratos'] },
  { role: 'editor', areas: ['Vídeo', 'Assets', 'Jobs'] },
];

export default async function TeamPage() {
  const me = await requireUser();
  const d = await db();
  const [profiles, tasks, projects, jobs] = await Promise.all([d.list('profiles', { orderBy: 'created_at' }), d.list('tasks'), d.list('projects'), d.list('jobs', { orderBy: 'created_at', desc: true })]);

  const now = Date.now();
  const load = profiles.map((p) => {
    const open = tasks.filter((t) => t.assignee_id === p.id && t.status !== 'feito');
    return {
      p,
      open: open.length,
      late: open.filter((t) => t.due_at && new Date(t.due_at).getTime() < now).length,
      owned: projects.filter((x) => x.owner_id === p.id && x.status !== 'finalizado').length,
    };
  });
  const maxOpen = Math.max(1, ...load.map((l) => l.open));

  const machines = RUNNERS.map((r) => {
    const mine = jobs.filter((j) => j.runner === r.key);
    const running = mine.find((j) => j.status === 'rodando');
    const queued = mine.filter((j) => j.status === 'fila').length;
    return { ...r, running, queued };
  });
  const yuriMachine = machines.find((m) => m.key === 'local_yuri');

  return (
    <div className="space-y-10">
      <div>
        <PageHeader
          kicker="Studio"
          title={
            <>
              Team <em>{profiles.length}</em>
            </>
          }
          subtitle="Quem está no Studio, o que cada pessoa carrega e o que cada papel acessa."
          actions={<InviteButton domain={AUTH_EMAIL_DOMAIN} supabase={isSupabaseMode()} roles={(Object.keys(ROLE_LABEL) as Role[]).map((k) => ({ key: k, label: ROLE_LABEL[k] }))} />}
        />

        {profiles.length === 0 ? (
          <EmptyState title="Ninguém no time ainda" text="Use Convidar para ver o caminho de criação de usuário." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {load.map(({ p, open, late, owned }) => {
              const st = STATUS[p.status || 'disponivel'] || { label: p.status || 'Sem status', dot: 'idle' as const };
              const isYuri = p.username.toUpperCase() === 'YURI';
              const yuriRunning = isYuri ? yuriMachine?.running : undefined;
              return (
                <Card key={p.id} className="flex flex-col p-5">
                  <div className="flex items-start gap-3">
                    <Avatar name={p.full_name} src={p.avatar_url} size={48} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-base font-medium text-ink">{p.full_name}</span>
                        {p.id === me.id && <Badge tone="accent">você</Badge>}
                      </div>
                      <div className="truncate text-sm text-ink2">{p.title || ROLE_LABEL[p.role]}</div>
                      <div className="mt-1.5 flex items-center gap-2 text-xs text-ink2">
                        <Dot state={st.dot} />
                        {st.label}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <div>
                      <div className="num text-2xl text-ink">{open}</div>
                      <div className="label mt-1">Tarefas</div>
                    </div>
                    <div>
                      <div className={late > 0 ? 'num text-2xl text-err' : 'num text-2xl text-ink'}>{late}</div>
                      <div className="label mt-1">Atrasadas</div>
                    </div>
                    <div>
                      <div className="num text-2xl text-ink">{owned}</div>
                      <div className="label mt-1">Projetos</div>
                    </div>
                  </div>
                  <Progress className="mt-4" value={(open / maxOpen) * 100} tone={late > 0 ? 'warn' : 'accent'} />

                  <div className="mt-4 flex flex-wrap items-center gap-2 pt-1 text-xs">
                    <Badge>{ROLE_LABEL[p.role]}</Badge>
                    {isYuri && (
                      <Badge tone={yuriRunning ? 'accent' : 'neutral'}>
                        <Dot state={yuriRunning ? 'rec' : 'idle'} />
                        Mac do Yuri · worker de vídeo
                      </Badge>
                    )}
                  </div>
                  {isYuri && <p className="mt-2 text-xs text-ink3">{yuriRunning ? `Rodando ${jobKind(yuriRunning.kind)}, ${yuriRunning.progress}%.` : 'Máquina ociosa.'}</p>}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section title="Máquinas" kicker="Onde os jobs rodam" className="lg:col-span-2">
          <Card className="divide-y divide-white/[0.05] p-2">
            {machines.map((m) => (
              <div key={m.key} className="flex items-center gap-4 px-3 py-3.5">
                <Dot state={m.running ? 'rec' : m.queued > 0 ? 'wave' : 'idle'} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">
                    {m.name}
                    <span className="ml-2 text-xs font-normal text-ink3">{m.what}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink2">
                    {m.running ? `${jobKind(m.running.kind)} · ${m.running.progress}% · desde ${relTime(m.running.started_at || m.running.created_at)}` : m.queued > 0 ? `${m.queued} na fila` : 'Ociosa'}
                  </div>
                </div>
                {m.running && (
                  <div className="hidden w-28 sm:block">
                    <Progress value={m.running.progress} />
                  </div>
                )}
                {m.queued > 0 && m.running && <Badge>{m.queued} na fila</Badge>}
              </div>
            ))}
          </Card>
          <p className="text-xs text-ink3">O estado vem dos jobs: rodando, na fila ou ocioso. A fila completa está em Workflow.</p>
        </Section>

        <Section title="Permissões" kicker="Por papel">
          <Table>
            <thead>
              <tr>
                <TH>Papel</TH>
                <TH>Acessa</TH>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((r) => (
                <tr key={r.role}>
                  <TD>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      {ROLE_LABEL[r.role]}
                      {me.role === r.role && <Badge tone="accent">seu papel</Badge>}
                    </div>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1.5">
                      {r.areas.map((a) => (
                        <Badge key={a}>{a}</Badge>
                      ))}
                    </div>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="text-xs text-ink3">Resumo do que cada papel usa no dia a dia. O menu lateral esconde o que o papel não acessa.</p>
        </Section>
      </div>
    </div>
  );
}
