import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { ROLE_LABEL } from '@/lib/db/types';
import { Avatar, Badge, Card, Dot, EmptyState, Field, PageHeader, Section, Select } from '@/components/ui/primitives';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { updateProfileAction } from '@/lib/actions/settings';
import { fmtDate } from '@/lib/utils';
import { PasswordForm } from './password';
import { NotifyToggles, ThemeToggle, type NotifyItem } from './prefs';

export const metadata = { title: 'Seu perfil' };

const STATUS = [
  { value: 'disponivel', label: 'Disponível' },
  { value: 'em_set', label: 'Em set' },
  { value: 'ocupado', label: 'Ocupado' },
  { value: 'ausente', label: 'Ausente' },
] as const;

// Os tipos seguem os `kind` das notificações que o sistema cria.
const NOTIFY: NotifyItem[] = [
  { key: 'aprovacao', label: 'Aprovações', hint: 'Quando o cliente decide um lote' },
  { key: 'job', label: 'Jobs e renders', hint: 'Fila do seu Mac, conclusão e erro' },
  { key: 'projeto', label: 'Projetos e prazos', hint: 'Tarefas e entregas perto do vencimento' },
  { key: 'vendas', label: 'Vendas', hint: 'Follow-ups e propostas' },
  { key: 'financeiro', label: 'Financeiro', hint: 'Faturas vencidas' },
];

const SHOW = 8;

export default async function UserPage() {
  const user = await requireUser();
  const d = await db();
  const [profile, tasks, pending, projects, clients] = await Promise.all([
    d.get('profiles', user.id),
    d.list('tasks', { where: { assignee_id: user.id } }),
    d.list('content_items', { where: { status: 'em_aprovacao' } }),
    d.list('projects'),
    d.list('clients'),
  ]);

  const now = Date.now();
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const clientName = (id?: string | null) => {
    const c = id ? clientById.get(id) : undefined;
    return c ? c.company || c.contact_name : '';
  };

  const open = tasks
    .filter((t) => t.status !== 'feito')
    .sort((a, b) => a.priority - b.priority || (a.due_at || '9999').localeCompare(b.due_at || '9999'));
  const late = open.filter((t) => t.due_at && new Date(t.due_at).getTime() < now).length;

  // Aprovações "minhas": dos clientes que eu acompanho. Admin enxerga todas.
  const mine = pending.filter((i) => user.role === 'admin' || clientById.get(i.client_id)?.owner_id === user.id);

  const notifyPrefs = (() => {
    const n = (profile?.preferences as Record<string, unknown> | null | undefined)?.notify;
    return n && typeof n === 'object' ? (n as Record<string, boolean>) : {};
  })();
  const status = profile?.status && STATUS.some((s) => s.value === profile.status) ? profile.status : 'disponivel';

  return (
    <div>
      <PageHeader
        kicker="Conta"
        title="Seu perfil"
        subtitle={`${open.length} ${open.length === 1 ? 'tarefa aberta' : 'tarefas abertas'}${late ? `, ${late} atrasada${late === 1 ? '' : 's'}` : ''} e ${mine.length} ${mine.length === 1 ? 'aprovação pendente' : 'aprovações pendentes'} na sua mão.`}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <Card className="p-6">
            <div className="flex items-center gap-4">
              <Avatar name={user.name} src={profile?.avatar_url || user.avatar_url} size={64} />
              <div className="min-w-0">
                <h2 className="display truncate text-2xl text-ink">{user.name}</h2>
                <div className="mt-1 truncate text-sm text-ink2">{profile?.title || user.title || ROLE_LABEL[user.role]}</div>
              </div>
            </div>
            <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <dt className="label">Usuário</dt>
                <dd className="mt-1 font-mono text-[13px] text-ink">{user.username}</dd>
              </div>
              <div>
                <dt className="label">Papel</dt>
                <dd className="mt-1">
                  <Badge>{ROLE_LABEL[user.role]}</Badge>
                </dd>
              </div>
              <div>
                <dt className="label">Cargo</dt>
                <dd className="mt-1 text-sm text-ink">{profile?.title || user.title || 'Sem cargo'}</dd>
              </div>
            </dl>
            <ActionForm key={status} action={updateProfileAction} success="Status atualizado" className="mt-6 flex flex-wrap items-end gap-3 border-t border-white/[0.06] pt-5">
              <Field label="Status" className="min-w-[200px]">
                <Select name="status" defaultValue={status}>
                  {STATUS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <SubmitButton variant="subtle">Salvar status</SubmitButton>
              <p className="basis-full text-xs text-ink3">O time vê o seu status na página Team.</p>
            </ActionForm>
          </Card>

          <Section title="Minhas tarefas" kicker={`${open.length} abertas`} action={open.length > SHOW ? <Link href="/workflow?who=me" className="text-xs text-ink2 hover:text-ink">Ver todas</Link> : undefined}>
            {open.length === 0 ? (
              <EmptyState title="Nada aberto com você" text="Quando alguém atribuir uma tarefa, ela aparece aqui e no Workflow." />
            ) : (
              <Card className="divide-y divide-white/[0.05] p-2">
                {open.slice(0, SHOW).map((t) => {
                  const isLate = Boolean(t.due_at && new Date(t.due_at).getTime() < now);
                  const where = [projectById.get(t.project_id || '')?.title, clientName(t.client_id || projectById.get(t.project_id || '')?.client_id)].filter(Boolean).join(' · ');
                  return (
                    <Link key={t.id} href="/workflow?who=me" className="press flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.05]">
                      <Dot state={isLate ? 'err' : t.status === 'fazendo' ? 'rec' : t.status === 'revisao' ? 'wave' : 'idle'} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{t.title}</span>
                        {where && <span className="block truncate text-xs text-ink3">{where}</span>}
                      </span>
                      <span className={isLate ? 'shrink-0 text-xs text-err' : 'shrink-0 text-xs text-ink3'}>{t.due_at ? `${isLate ? 'venceu ' : 'até '}${fmtDate(t.due_at)}` : 'sem prazo'}</span>
                    </Link>
                  );
                })}
              </Card>
            )}
          </Section>

          <Section title="Aprovações pendentes" kicker={user.role === 'admin' ? 'Todas as peças' : 'Dos seus clientes'} action={mine.length > 0 ? <Link href="/aprovacoes" className="text-xs text-ink2 hover:text-ink">Abrir fila</Link> : undefined}>
            {mine.length === 0 ? (
              <EmptyState title="Nenhuma aprovação pendente" text="Peças em aprovação dos seus clientes aparecem aqui. A fila completa fica em Aprovações." />
            ) : (
              <Card className="divide-y divide-white/[0.05] p-2">
                {mine.slice(0, SHOW).map((i) => {
                  const c = clientById.get(i.client_id);
                  return (
                    <Link key={i.id} href="/aprovacoes" className="press flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.05]">
                      <span className="dot" style={{ background: c?.brand_color || '#FF5B1F' }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{i.hook}</span>
                        <span className="block truncate text-xs text-ink3">{clientName(i.client_id)}</span>
                      </span>
                      <Badge>{i.series || 'Peça'}</Badge>
                    </Link>
                  );
                })}
              </Card>
            )}
            {mine.length > SHOW && <p className="text-xs text-ink3">Mostrando {SHOW} de {mine.length}.</p>}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Preferências" kicker="Só para você">
            <Card className="space-y-5 p-5">
              <div>
                <div className="label mb-2">Tema</div>
                <ThemeToggle />
                <p className="mt-2 text-xs text-ink3">Fica salvo neste navegador.</p>
              </div>
              <div>
                <div className="label mb-1">Notificações</div>
                <NotifyToggles items={NOTIFY} initial={notifyPrefs} />
                <p className="mt-2 text-xs text-ink3">A escolha fica salva no seu perfil. O sino do topo ainda mostra todos os tipos.</p>
              </div>
            </Card>
          </Section>

          <Section title="Senha" kicker="Segurança">
            <Card className="p-5">
              <PasswordForm />
            </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}
