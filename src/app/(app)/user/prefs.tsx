'use client';

import { useEffect, useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { Toggle } from '@/components/ui/client';
import { cn } from '@/lib/utils';
import { updatePreferencesAction } from '@/lib/actions/settings';

/** Tema claro ou escuro. Mesma regra do botão do topo: classe `light` no html e `ihs.theme` no localStorage. */
export function ThemeToggle() {
  const [light, setLight] = useState<boolean | null>(null);

  useEffect(() => {
    const el = document.documentElement;
    const read = () => setLight(el.classList.contains('light'));
    read();
    // O botão do topo também troca o tema: acompanhamos a classe para não ficar defasado.
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  function apply(next: boolean) {
    document.documentElement.classList.toggle('light', next);
    try {
      localStorage.setItem('ihs.theme', next ? 'light' : 'dark');
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
    setLight(next);
  }

  const options = [
    { value: false, label: 'Escuro', Icon: Moon },
    { value: true, label: 'Claro', Icon: Sun },
  ];

  return (
    <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-full bg-white/[0.04] p-1">
      {options.map(({ value, label, Icon }) => {
        const active = light === value;
        return (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => apply(value)}
            className={cn('press focus-ring inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors', active ? 'bg-ink text-bg' : 'text-ink2 hover:text-ink')}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export type NotifyItem = { key: string; label: string; hint: string };

/**
 * Tipos de notificação. Tudo começa ligado; só o que foi desligado fica gravado como false.
 * As gravações entram em fila para duas trocas rápidas não se atropelarem no servidor.
 */
export function NotifyToggles({ items, initial }: { items: NotifyItem[]; initial: Record<string, boolean> }) {
  const [values, setValues] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map((i) => [i.key, initial[i.key] !== false])));
  const queue = useRef<Promise<void>>(Promise.resolve());

  function set(key: string, value: boolean) {
    setValues((v) => ({ ...v, [key]: value }));
    queue.current = queue.current.then(async () => {
      try {
        const r = await updatePreferencesAction({ [key]: value });
        if (r.ok === false) throw new Error(r.error);
      } catch (e) {
        setValues((v) => ({ ...v, [key]: !value }));
        toast.error((e as Error).message || 'Não foi possível salvar a preferência.');
      }
    });
  }

  return (
    <ul className="divide-y divide-white/[0.05]">
      {items.map((it) => (
        <li key={it.key} className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className="text-sm text-ink">{it.label}</div>
            <div className="text-xs text-ink3">{it.hint}</div>
          </div>
          <Toggle checked={values[it.key]} onChange={(v) => set(it.key, v)} label={it.label} />
        </li>
      ))}
    </ul>
  );
}
