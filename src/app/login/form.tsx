'use client';

import { useActionState } from 'react';
import { Loader2, ArrowRight } from 'lucide-react';
import { Field, Input } from '@/components/ui/primitives';

export function LoginForm({ action, next, mode }: { action: (state: unknown, fd: FormData) => Promise<{ error?: string } | void>; next: string; mode: 'local' | 'supabase' }) {
  const [state, formAction, pending] = useActionState(action, undefined as unknown);
  const err = (state as { error?: string } | undefined)?.error;
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Usuário">
        <Input name="username" placeholder="VITOR" autoCapitalize="characters" autoComplete="username" autoFocus required className="uppercase placeholder:normal-case" />
      </Field>
      <Field label="Senha">
        <Input name="password" type="password" placeholder="••••••••" autoComplete="current-password" required />
      </Field>
      {err && <p className="rounded-xl bg-err/10 px-3 py-2 text-xs text-err">{err}</p>}
      <button type="submit" disabled={pending} className="press focus-ring flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-medium text-black hover:bg-[#ff6b36] disabled:opacity-60">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Entrar
        {!pending && <ArrowRight className="h-4 w-4" />}
      </button>
      <p className="text-center text-[11px] text-ink3">
        {mode === 'supabase' ? 'Autenticação via Supabase' : 'Modo local: usuários do time com senha inicial'} · YURI · MARCOS · PEDROPAULO · VITOR
      </p>
    </form>
  );
}
