import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn, initials } from '@/lib/utils';

/* ---------- Button ---------- */
type ButtonProps = {
  variant?: 'primary' | 'ghost' | 'glass' | 'outline' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  href?: string;
  /** Com target, download ou href de API, vira um <a> comum (sem navegação do Next). */
  target?: string;
  download?: boolean | string;
  rel?: string;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentProps<'button'>, 'className' | 'children'>;

const btnBase =
  'press focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium select-none disabled:opacity-50 disabled:pointer-events-none';
const btnVariant: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent text-black hover:bg-[#ff6b36] shadow-[0_8px_30px_-12px_rgba(255,91,31,0.7)]',
  ghost: 'text-ink2 hover:text-ink hover:bg-white/[0.06]',
  glass: 'glass text-ink hover:bg-white/[0.08]',
  outline: 'border border-white/[0.12] text-ink hover:bg-white/[0.05]',
  danger: 'bg-err/15 text-err hover:bg-err/25',
  subtle: 'bg-white/[0.06] text-ink hover:bg-white/[0.1]',
};
const btnSize: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-[15px]',
  icon: 'h-9 w-9 p-0',
};

export function Button({ variant = 'primary', size = 'md', href, target, download, rel, className, children, ...rest }: ButtonProps) {
  const cls = cn(btnBase, btnVariant[variant], btnSize[size], className);
  if (href && (target || download !== undefined || href.startsWith('/api/') || /^https?:/.test(href))) {
    return (
      <a href={href} className={cls} target={target} download={download === true ? '' : download || undefined} rel={rel || (target === '_blank' ? 'noreferrer' : undefined)}>
        {children}
      </a>
    );
  }
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} type={rest.type || 'button'} {...rest}>
      {children}
    </button>
  );
}

/* ---------- Surfaces ---------- */
export function Card({ className, children, nevoa, ...rest }: ComponentProps<'div'> & { nevoa?: boolean }) {
  return (
    <div className={cn('card', nevoa && 'nevoa nevoa-soft', className)} {...rest}>
      {children}
    </div>
  );
}

export function Glass({ className, children, strong, ...rest }: ComponentProps<'div'> & { strong?: boolean }) {
  return (
    <div className={cn(strong ? 'glass-strong' : 'glass', 'rounded-2xl', className)} {...rest}>
      {children}
    </div>
  );
}

export function Section({ title, kicker, action, children, className }: { title?: ReactNode; kicker?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3', className)}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-4">
          <div>
            {kicker && <div className="label mb-1">{kicker}</div>}
            {title && <h2 className="display text-xl text-ink">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ kicker, title, subtitle, actions, className }: { kicker?: string; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {kicker && <div className="label mb-2">{kicker}</div>}
        <h1 className="display twotone text-[34px] leading-[0.95] text-ink md:text-[40px]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm text-ink2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- Stat / KPI ---------- */
export function Stat({ label, value, hint, delta, icon, className, accent }: { label: string; value: ReactNode; hint?: ReactNode; delta?: { value: string; up?: boolean }; icon?: ReactNode; className?: string; accent?: boolean }) {
  return (
    <div className={cn('card relative overflow-hidden p-5', accent && 'nevoa nevoa-soft', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="label">{label}</div>
        {icon && <div className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-ink2">{icon}</div>}
      </div>
      <div className="num mt-4 text-[40px] text-ink">{value}</div>
      <div className="mt-2 flex items-center gap-2 text-xs text-ink2">
        {delta && <span className={cn('num text-sm', delta.up === false ? 'text-err' : 'text-ok')}>{delta.up === false ? '↓' : '↑'} {delta.value}</span>}
        {hint}
      </div>
    </div>
  );
}

/* ---------- Badges, pills, dots ---------- */
const tones = {
  neutral: 'bg-white/[0.07] text-ink2',
  accent: 'bg-accent/15 text-accent',
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  err: 'bg-err/15 text-err',
  info: 'bg-sky-400/15 text-sky-300',
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium', tones[tone], className)}>{children}</span>;
}

export function Dot({ state = 'idle', className }: { state?: 'idle' | 'rec' | 'done' | 'wave' | 'err' | 'off'; className?: string }) {
  const m = { idle: 'bg-ink3', rec: 'dot-rec', done: 'bg-ok', wave: 'dot-wave', err: 'bg-err', off: 'bg-white/20' };
  return <span className={cn('dot', m[state], className)} aria-hidden />;
}

export function PillTabs({ tabs, current, className }: { tabs: { href: string; label: string; count?: number }[]; current: string; className?: string }) {
  return (
    <nav className={cn('flex flex-wrap items-center gap-1 rounded-full bg-white/[0.04] p-1', className)}>
      {tabs.map((t) => {
        const active = current === t.href || (t.href !== '/' && t.href.length > 1 && current === t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn('press rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors', active ? 'bg-ink text-bg' : 'text-ink2 hover:text-ink')}
          >
            {t.label}
            {t.count != null && <span className={cn('ml-1.5 text-[11px]', active ? 'text-bg/70' : 'text-ink3')}>{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/* ---------- Forms ---------- */
const fieldBase =
  'focus-ring w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-3.5 py-2.5 text-sm text-ink placeholder:text-ink3 transition-colors hover:border-white/[0.16] focus:border-accent/60 disabled:opacity-50';

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cn(fieldBase, className)} {...rest} />;
}
export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldBase, 'min-h-[96px] resize-y leading-relaxed', className)} {...rest} />;
}
export function Select({ className, children, ...rest }: ComponentProps<'select'>) {
  return (
    <select className={cn(fieldBase, 'appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23a3a3a0%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-[length:12px] bg-[position:right_12px_center] bg-no-repeat pr-9', className)} {...rest}>
      {children}
    </select>
  );
}
export function Field({ label, hint, error, children, className, required }: { label?: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      {label && (
        <span className="flex items-baseline justify-between text-[13px] font-medium text-ink">
          <span>
            {label}
            {required && <span className="ml-1 text-accent">*</span>}
          </span>
        </span>
      )}
      {children}
      {hint && !error && <span className="block text-xs text-ink3">{hint}</span>}
      {error && <span className="block text-xs text-err">{error}</span>}
    </label>
  );
}

/* ---------- Misc ---------- */
export function Avatar({ name, src, size = 32, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  return (
    <span
      className={cn('grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-accent/80 to-accent2 text-[11px] font-semibold text-black', className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size / 2.8) }}
      aria-label={name}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}

export function Progress({ value, className, tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'ok' | 'warn' | 'err' }) {
  const bar = { accent: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err' }[tone];
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-500 ease-out', bar)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, text, action, className }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('card grid place-items-center gap-3 px-6 py-14 text-center', className)}>
      {icon && <div className="grid h-12 w-12 place-items-center rounded-full border border-white/10 text-ink2">{icon}</div>}
      <div className="display text-2xl text-ink">{title}</div>
      {text && <p className="max-w-md text-sm text-ink2">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-ink2">{children}</kbd>;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('card overflow-x-auto', className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}
export function TH({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn('label whitespace-nowrap border-b border-white/[0.07] px-4 py-3 font-medium', className)}>{children}</th>;
}
export function TD({ children, className, ...rest }: ComponentProps<'td'>) {
  return (
    <td className={cn('border-b border-white/[0.05] px-4 py-3 align-middle text-ink', className)} {...rest}>
      {children}
    </td>
  );
}

export function Stepper({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  return (
    <ol className={cn('flex flex-wrap items-center gap-2', className)}>
      {steps.map((s, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'now' : 'next';
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={cn(
                'num grid h-7 w-7 place-items-center rounded-full text-[12px] transition-colors',
                state === 'done' && 'bg-ok/20 text-ok',
                state === 'now' && 'bg-accent text-black',
                state === 'next' && 'border border-white/10 text-ink3',
              )}
            >
              {n}
            </span>
            <span className={cn('text-[13px]', state === 'now' ? 'text-ink' : 'text-ink3')}>{s}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-white/10" />}
          </li>
        );
      })}
    </ol>
  );
}

export function Example({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <Badge tone="warn" className="ml-2 align-middle">
      exemplo · configure a chave da IA
    </Badge>
  );
}

export function ListRow({ href, left, title, meta, right, className }: { href?: string; left?: ReactNode; title: ReactNode; meta?: ReactNode; right?: ReactNode; className?: string }) {
  const inner = (
    <>
      {left}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{title}</div>
        {meta && <div className="mt-0.5 truncate text-xs text-ink2">{meta}</div>}
      </div>
      {right}
    </>
  );
  const cls = cn('flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors', href && 'press hover:bg-white/[0.05]', className);
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
