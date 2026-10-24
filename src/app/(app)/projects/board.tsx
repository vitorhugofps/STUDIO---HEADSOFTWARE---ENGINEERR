'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Kanban, type KanbanCard, type KanbanColumn } from '@/components/ui/kanban';
import { ActionForm, Drawer, Modal, SubmitButton } from '@/components/ui/client';
import { Avatar, Badge, Button, Field, Input, Progress, Select, Textarea } from '@/components/ui/primitives';
import { KIND_LABEL, STAGE_LABEL, type MethodStage, type ProjectKind } from '@/lib/db/types';
import { cn, fmtDate } from '@/lib/utils';
import { moveProjectStageAction, toggleTaskAction } from '@/lib/actions/ops';
import { createProjectAction } from '@/lib/actions/clients';

/* ---------- Kanban por etapa do método ---------- */

export type KanbanProject = {
  id: string;
  title: string;
  kind: ProjectKind;
  stage: MethodStage;
  status: string;
  progress: number;
  due_on: string | null;
  late: boolean;
  clientName: string;
  clientColor: string;
  ownerName: string | null;
  href: string;
};

const STAGE_HINT: Record<MethodStage, string> = {
  ponto: 'Briefing e diagnóstico',
  roteiro: 'Planejamento e roteiro',
  set: 'Produção',
  estreia: 'Entrega e publicação',
  temporada: 'Acompanhamento',
};
const COLUMNS: KanbanColumn[] = (Object.keys(STAGE_LABEL) as MethodStage[]).map((k) => ({ id: k, label: STAGE_LABEL[k], hint: STAGE_HINT[k] }));

function ProjectCardContent({ p }: { p: KanbanProject }) {
  return (
    <Link href={p.href} scroll={false} className="block">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Badge>{KIND_LABEL[p.kind]}</Badge>
        {p.late && <Badge tone="err">atrasado</Badge>}
        {!p.late && p.status === 'finalizado' && <Badge tone="ok">finalizado</Badge>}
        {!p.late && p.status === 'aguardando_aprovacao' && <Badge tone="warn">em aprovação</Badge>}
      </div>
      <div className="line-clamp-2 text-sm font-medium text-ink">{p.title}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-ink2">
        <span className="dot" style={{ background: p.clientColor }} />
        <span className="truncate">{p.clientName}</span>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-ink3">
        {p.ownerName ? <Avatar name={p.ownerName} size={20} /> : null}
        <span className="truncate">
          {p.ownerName ? `${p.ownerName.split(' ')[0]} · ` : ''}
          {p.due_on ? `prazo ${fmtDate(p.due_on)}` : 'sem prazo'}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Progress value={p.progress} tone={p.status === 'finalizado' ? 'ok' : p.late ? 'err' : 'accent'} />
        <span className="num text-xs text-ink2">{p.progress}%</span>
      </div>
    </Link>
  );
}

export function ProjectsKanban({ projects }: { projects: KanbanProject[] }) {
  const cards: KanbanCard[] = projects.map((p) => ({ id: p.id, column: p.stage, content: <ProjectCardContent p={p} /> }));
  // O Kanban guarda os cartões no primeiro render. A chave refaz o quadro quando os dados do servidor mudam.
  const signature = projects.map((p) => [p.id, p.stage, p.progress, p.status, p.due_on, p.title, p.late].join(':')).join('|');
  return <Kanban key={signature} columns={COLUMNS} cards={cards} onMove={(id, column) => moveProjectStageAction(id, column)} />;
}

/* ---------- Filtros (cliente e status) ---------- */

export function ProjectFilters({
  view,
  clients,
  client,
  status,
}: {
  view: string;
  clients: { id: string; name: string }[];
  client: string;
  status: string;
}) {
  const router = useRouter();
  const [c, setC] = useState(client);
  const [s, setS] = useState(status);
  useEffect(() => setC(client), [client]);
  useEffect(() => setS(status), [status]);

  function go(nextClient: string, nextStatus: string) {
    const u = new URLSearchParams();
    u.set('view', view);
    if (nextClient) u.set('client', nextClient);
    if (nextStatus) u.set('status', nextStatus);
    router.push(`/projects?${u.toString()}`);
  }

  const pill = 'h-9 w-auto min-w-[160px] rounded-full py-0 text-[13px]';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Filtrar por cliente"
        value={c}
        className={pill}
        onChange={(e) => {
          setC(e.target.value);
          go(e.target.value, s);
        }}
      >
        <option value="">Todos os clientes</option>
        {clients.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filtrar por status"
        value={s}
        className={pill}
        onChange={(e) => {
          setS(e.target.value);
          go(c, e.target.value);
        }}
      >
        <option value="">Em andamento</option>
        <option value="todos">Todos os status</option>
        <option value="ativo">Ativo</option>
        <option value="aguardando_aprovacao">Aguardando aprovação</option>
        <option value="pausado">Pausado</option>
        <option value="finalizado">Finalizado</option>
      </Select>
    </div>
  );
}

/* ---------- Novo projeto ---------- */

export function NewProjectButton({
  clients,
  profiles,
  defaultOwner,
  defaultClient,
}: {
  clients: { id: string; name: string }[];
  profiles: { id: string; name: string }[];
  defaultOwner: string;
  defaultClient?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Novo projeto
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Novo projeto">
        <ActionForm
          className="space-y-3"
          success="Projeto criado"
          action={async (fd) => {
            const r = await createProjectAction(fd);
            if (r.ok) setOpen(false);
            return r;
          }}
        >
          <Field label="Cliente" required>
            <Select name="client_id" defaultValue={defaultClient || ''} required>
              <option value="" disabled>
                Escolha o cliente
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Título" required>
            <Input name="title" placeholder="Ex.: Feed de novembro" required />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Tipo">
              <Select name="kind" defaultValue="feed">
                {Object.entries(KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Responsável">
              <Select name="owner_id" defaultValue={defaultOwner}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Início">
              <Input type="date" name="starts_on" />
            </Field>
            <Field label="Entrega">
              <Input type="date" name="due_on" />
            </Field>
          </div>
          <Field label="Briefing curto">
            <Textarea name="brief" className="min-h-[72px]" />
          </Field>
          <SubmitButton className="w-full">Criar projeto</SubmitButton>
        </ActionForm>
      </Modal>
    </>
  );
}

/* ---------- Detalhe em Drawer (a página renderiza o conteúdo; aqui só o casco) ---------- */

export function RouteDrawer({ title, closeHref, children }: { title: ReactNode; closeHref: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Drawer open onClose={() => router.push(closeHref, { scroll: false })} title={title}>
      {children}
    </Drawer>
  );
}

/** Progresso com régua e valor ao vivo. */
export function ProgressField({ defaultValue }: { defaultValue: number }) {
  const [v, setV] = useState(defaultValue);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-ink">
        <label htmlFor="project-progress">Progresso</label>
        <span className="num text-base">{v}%</span>
      </div>
      <input
        id="project-progress"
        type="range"
        name="progress"
        min={0}
        max={100}
        step={5}
        value={v}
        onChange={(e) => setV(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </div>
  );
}

/** Caixa de seleção de tarefa: marca e desmarca no servidor. */
export function TaskCheck({ id, done, title, meta }: { id: string; done: boolean; title: string; meta?: string }) {
  const router = useRouter();
  const [checked, setChecked] = useState(done);
  const [pending, start] = useTransition();
  useEffect(() => setChecked(done), [done]);

  function toggle() {
    const next = !checked;
    setChecked(next);
    start(async () => {
      try {
        const r = await toggleTaskAction(id, next);
        if (r && r.ok === false) throw new Error(r.error);
        router.refresh();
      } catch (e) {
        setChecked(!next);
        toast.error((e as Error).message || 'Não foi possível atualizar a tarefa.');
      }
    });
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={toggle}
      disabled={pending}
      className="press flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.05] disabled:opacity-70"
    >
      <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors', checked ? 'border-accent bg-accent text-black' : 'border-white/20')}>
        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm', checked ? 'text-ink3 line-through' : 'text-ink')}>{title}</span>
        {meta && <span className="block text-xs text-ink3">{meta}</span>}
      </span>
    </button>
  );
}
