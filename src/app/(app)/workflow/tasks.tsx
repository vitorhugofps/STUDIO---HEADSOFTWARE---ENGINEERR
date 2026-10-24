'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Kanban, type KanbanCard, type KanbanColumn } from '@/components/ui/kanban';
import { Toggle } from '@/components/ui/client';
import { Avatar, Badge } from '@/components/ui/primitives';
import { cn, fmtDate } from '@/lib/utils';
import { moveTaskAction, toggleWorkflowAction } from '@/lib/actions/ops';

/* ---------- Kanban de tarefas ---------- */

export type TaskCardData = {
  id: string;
  title: string;
  status: 'a_fazer' | 'fazendo' | 'revisao' | 'feito';
  priority: number;
  due_at: string | null;
  late: boolean;
  project: string | null;
  client: string | null;
  clientColor: string | null;
  assignee: string | null;
};

const COLUMNS: KanbanColumn[] = [
  { id: 'a_fazer', label: 'A fazer' },
  { id: 'fazendo', label: 'Fazendo' },
  { id: 'revisao', label: 'Revisão', hint: 'Aguarda conferência' },
  { id: 'feito', label: 'Feito', hint: 'Últimos 14 dias' },
];

function TaskCardContent({ t }: { t: TaskCardData }) {
  const done = t.status === 'feito';
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className={cn('text-sm font-medium', done ? 'text-ink3 line-through' : 'text-ink')}>{t.title}</div>
        {t.priority === 1 && !done && <Badge tone="warn">alta</Badge>}
      </div>
      {(t.project || t.client) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-ink3">
          {t.clientColor && <span className="dot" style={{ background: t.clientColor }} />}
          <span className="truncate">{[t.project, t.client].filter(Boolean).join(' · ')}</span>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <span className={cn(t.late && !done ? 'text-err' : 'text-ink3')}>
          {t.due_at ? `${t.late && !done ? 'venceu ' : 'até '}${fmtDate(t.due_at)}` : 'sem prazo'}
        </span>
        <span className="flex items-center gap-2">
          {t.priority === 3 && !done && <span className="text-ink3">baixa</span>}
          {t.assignee && <Avatar name={t.assignee} size={20} />}
        </span>
      </div>
    </div>
  );
}

export function TasksKanban({ tasks }: { tasks: TaskCardData[] }) {
  const cards: KanbanCard[] = tasks.map((t) => ({ id: t.id, column: t.status, content: <TaskCardContent t={t} /> }));
  // O Kanban só lê os cartões no primeiro render: a chave refaz o quadro quando o servidor devolve dados novos.
  const signature = tasks.map((t) => [t.id, t.status, t.priority, t.due_at, t.title, t.assignee].join(':')).join('|');
  return <Kanban key={signature} columns={COLUMNS} cards={cards} onMove={(id, column) => moveTaskAction(id, column)} />;
}

/* ---------- Liga e desliga uma automação ---------- */

export function WorkflowToggle({ id, active, name }: { id: string; active: boolean; name: string }) {
  const router = useRouter();
  const [on, setOn] = useState(active);
  const [, start] = useTransition();
  useEffect(() => setOn(active), [active]);

  return (
    <Toggle
      checked={on}
      label={`${on ? 'Pausar' : 'Ativar'} a automação ${name}`}
      onChange={(next) => {
        setOn(next);
        start(async () => {
          try {
            const r = await toggleWorkflowAction(id, next);
            if (r.ok === false) throw new Error(r.error);
            router.refresh();
          } catch (e) {
            setOn(!next);
            toast.error((e as Error).message || 'Não foi possível alterar a automação.');
          }
        });
      }}
    />
  );
}
