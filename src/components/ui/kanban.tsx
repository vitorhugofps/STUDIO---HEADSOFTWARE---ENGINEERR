'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { DndContext, PointerSensor, useDroppable, useDraggable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export type KanbanColumn = { id: string; label: string; hint?: string };
export type KanbanCard = { id: string; column: string; content: ReactNode };

export function Kanban({ columns, cards, onMove, className }: { columns: KanbanColumn[]; cards: KanbanCard[]; onMove: (id: string, column: string) => Promise<any>; className?: string }) {
  const [items, setItems] = useState(cards);
  const [, start] = useTransition();
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragEnd(e: DragEndEvent) {
    const over = e.over?.id;
    const id = String(e.active.id);
    if (!over) return;
    const col = String(over);
    const current = items.find((i) => i.id === id);
    if (!current || current.column === col) return;
    const prev = items;
    setItems(items.map((i) => (i.id === id ? { ...i, column: col } : i)));
    start(async () => {
      try {
        const r = await onMove(id, col);
        if (r && r.ok === false) throw new Error(r.error);
        router.refresh();
      } catch (err) {
        setItems(prev);
        toast.error((err as Error).message || 'Não foi possível mover.');
      }
    });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className={cn('grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2', className)}>
        {columns.map((c) => (
          <Column key={c.id} column={c} cards={items.filter((i) => i.column === c.id)} />
        ))}
      </div>
    </DndContext>
  );
}

function Column({ column, cards }: { column: KanbanColumn; cards: KanbanCard[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <div ref={setNodeRef} className={cn('flex min-h-[320px] flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-2 transition-colors', isOver && 'border-accent/50 bg-accent/[0.04]')}>
      <div className="flex items-center justify-between px-2 py-2">
        <div>
          <div className="text-[13px] font-medium text-ink">{column.label}</div>
          {column.hint && <div className="text-[11px] text-ink3">{column.hint}</div>}
        </div>
        <span className="num rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-ink2">{cards.length}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {cards.map((c) => (
          <CardItem key={c.id} card={c} />
        ))}
      </div>
    </div>
  );
}

function CardItem({ card }: { card: KanbanCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn('card cursor-grab p-3 transition-shadow active:cursor-grabbing', isDragging && 'z-10 shadow-pop ring-1 ring-accent/40')}
    >
      {card.content}
    </div>
  );
}
