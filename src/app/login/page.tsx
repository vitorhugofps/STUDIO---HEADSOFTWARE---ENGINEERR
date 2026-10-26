import { redirect } from 'next/navigation';
import { getSession, login } from '@/lib/auth';
import { isSupabaseMode } from '@/lib/config';
import { LoginForm } from './form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; erro?: string }> }) {
  const user = await getSession();
  const sp = await searchParams;
  if (user) redirect(sp.next || '/');

  async function loginAction(_: unknown, fd: FormData) {
    'use server';
    const r = await login(String(fd.get('username') || ''), String(fd.get('password') || ''));
    if (!r.ok) return { error: r.error };
    redirect(String(fd.get('next') || '/'));
  }

  return (
    <main className="nevoa relative grid min-h-screen place-items-center overflow-hidden p-6">
      <div className="drag-region absolute inset-x-0 top-0 h-10" />
      <div className="relative z-10 w-full max-w-[420px]">
        <div className="mb-10 flex items-center gap-3">
          <span className="relative grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-black/50">
            <span className="h-3 w-3 rounded-full bg-accent shadow-[0_0_24px_rgba(255,91,31,1)]" />
          </span>
          <div className="leading-none">
            <div className="display text-[22px] text-ink">Impacto</div>
            <div className="label mt-1">Sistema do Studio Impacto</div>
          </div>
        </div>
        <h1 className="display twotone text-[52px] leading-[0.92] text-ink">
          Do ponto
          <br />
          <em>ao impacto.</em>
        </h1>
        <p className="mt-4 max-w-sm text-sm text-ink2">O sistema operacional do Studio. Clientes, marca, feed, vídeo, tráfego, vendas e financeiro no mesmo lugar.</p>
        <div className="glass-strong mt-8 rounded-3xl p-6">
          <LoginForm action={loginAction} next={sp.next || '/'} mode={isSupabaseMode() ? 'supabase' : 'local'} />
        </div>
        <p className="mt-6 text-[11px] text-ink3">Uberlândia, MG · {new Date().getFullYear()} · Feito em set, não em prompt.</p>
      </div>
    </main>
  );
}
