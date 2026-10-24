'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Drawer, Toggle } from '@/components/ui/client';
import { Progress } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { toggleSiteQaAction } from '@/lib/actions/ops';

/** Casco do detalhe do site. A página renderiza o conteúdo no servidor; aqui só o fechamento pela URL. */
export function SiteDrawer({ title, children }: { title: ReactNode; children: ReactNode }) {
  const router = useRouter();
  return (
    <Drawer open onClose={() => router.push('/sites', { scroll: false })} title={title}>
      {children}
    </Drawer>
  );
}

export type QaItem = { key: string; label: string; hint?: string };

/**
 * Checklist de QA. O estado local é a fonte da verdade enquanto o drawer está aberto.
 * As gravações entram em fila para duas trocas rápidas não se atropelarem no servidor.
 */
export function QaChecklist({ siteId, items, initial }: { siteId: string; items: QaItem[]; initial: Record<string, boolean> }) {
  const router = useRouter();
  const [checks, setChecks] = useState<Record<string, boolean>>(initial);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const done = items.filter((i) => checks[i.key]).length;

  function set(key: string, value: boolean) {
    setChecks((c) => ({ ...c, [key]: value }));
    queue.current = queue.current.then(async () => {
      try {
        const r = await toggleSiteQaAction(siteId, key, value);
        if (r.ok === false) throw new Error(r.error);
        router.refresh();
      } catch (e) {
        setChecks((c) => ({ ...c, [key]: !value }));
        toast.error((e as Error).message || 'Não foi possível salvar o item.');
      }
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Progress value={(done / Math.max(1, items.length)) * 100} tone={done === items.length ? 'ok' : 'accent'} />
        <span className="num whitespace-nowrap text-xs text-ink2">
          {done} de {items.length}
        </span>
      </div>
      <ul className="divide-y divide-white/[0.05]">
        {items.map((it) => (
          <li key={it.key} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className={cn('text-sm', checks[it.key] ? 'text-ink' : 'text-ink2')}>{it.label}</div>
              {it.hint && <div className="text-xs text-ink3">{it.hint}</div>}
            </div>
            <Toggle checked={Boolean(checks[it.key])} onChange={(v) => set(it.key, v)} label={it.label} />
          </li>
        ))}
      </ul>
    </div>
  );
}
