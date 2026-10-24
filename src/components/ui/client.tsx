'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, Loader2, Check, Copy as CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from './primitives';

/* ---------- Submit button (dentro de <form action>) ---------- */
export function SubmitButton({ children, pendingText, ...rest }: Parameters<typeof Button>[0] & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...rest}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

/* ---------- Botão que roda uma server action com confirmação opcional ---------- */
export function ActionButton({
  action,
  confirm,
  success,
  children,
  afterPath,
  ...rest
}: Parameters<typeof Button>[0] & { action: () => Promise<any>; confirm?: string; success?: string; afterPath?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      disabled={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          try {
            const r = await action();
            if (r && r.ok === false) toast.error(r.error || 'Não deu certo.');
            else {
              if (success) toast.success(success);
              if (afterPath) router.push(afterPath);
              router.refresh();
            }
          } catch (e) {
            toast.error((e as Error).message);
          }
        });
      }}
      {...rest}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </Button>
  );
}

/* ---------- Modal / Drawer ---------- */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4" role="dialog" aria-modal>
      <button className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Fechar" />
      <div className={cn('glass-strong rise relative max-h-[90vh] w-full overflow-y-auto rounded-3xl p-6', wide ? 'max-w-4xl' : 'max-w-xl')}>
        <div className="mb-4 flex items-start justify-between gap-4">
          {title && <h3 className="display text-2xl text-ink">{title}</h3>}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <div className={cn('fixed inset-0 z-[70] transition-opacity', open ? 'opacity-100' : 'pointer-events-none opacity-0')} aria-hidden={!open}>
      <button className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="Fechar" />
      <aside
        className={cn('glass-strong absolute right-3 top-3 bottom-3 w-full max-w-md overflow-y-auto rounded-3xl p-6 transition-transform duration-300 ease-out', open ? 'translate-x-0' : 'translate-x-[calc(100%+24px)]')}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          {title && <h3 className="display text-2xl text-ink">{title}</h3>}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </aside>
    </div>
  );
}

/* ---------- Copiar ---------- */
export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      variant="subtle"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1400);
      }}
    >
      {ok ? <Check className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
      {ok ? 'Copiado' : label}
    </Button>
  );
}

/* ---------- Toggle ---------- */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn('press relative inline-flex h-6 w-11 items-center rounded-full transition-colors', checked ? 'bg-accent' : 'bg-white/15')}
      aria-label={label}
    >
      <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out', checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}

/* ---------- Formulário com feedback (toast) ---------- */
export function ActionForm({
  action,
  children,
  className,
  success,
  resetOnSuccess,
  afterPath,
}: {
  action: (fd: FormData) => Promise<any>;
  children: ReactNode;
  className?: string;
  success?: string;
  resetOnSuccess?: boolean;
  afterPath?: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  return (
    <form
      ref={ref}
      className={className}
      action={async (fd) => {
        try {
          const r = await action(fd);
          if (r && r.ok === false) {
            toast.error(r.error || 'Não deu certo.');
            return;
          }
          if (success) toast.success(success);
          if (resetOnSuccess) ref.current?.reset();
          if (afterPath) router.push(afterPath);
          router.refresh();
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
    >
      {children}
    </form>
  );
}
