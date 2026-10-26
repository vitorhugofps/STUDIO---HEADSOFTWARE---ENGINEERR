import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { isSupabaseMode, sessionSecret, syncConfigFromDb } from '@/lib/config';
import { verifyPassword, hashPassword } from '@/lib/password';
import { localDB } from '@/lib/db/local';
import { ensureSeed } from '@/lib/db/seed';
import { supabaseServer } from '@/lib/db/supabase';
import type { Profile, Role } from '@/lib/db/types';

export const SESSION_COOKIE = 'ihs_session';
export const AUTH_EMAIL_DOMAIN = 'headsoftware.studioimpacto.com.br';

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  role: Role;
  title?: string | null;
  avatar_url?: string | null;
  mode: 'local' | 'supabase';
};

export function usernameToEmail(username: string) {
  return `${username.trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
}

function profileToUser(p: Profile, mode: 'local' | 'supabase'): SessionUser {
  return { id: p.id, username: p.username, name: p.full_name, role: p.role, title: p.title, avatar_url: p.avatar_url, mode };
}

export async function getSession(): Promise<SessionUser | null> {
  if (isSupabaseMode()) {
    try {
      const sb = await supabaseServer();
      const { data } = await sb.auth.getUser();
      const user = data.user;
      if (!user) return null;
      // Com a sessão confirmada, já carrega a configuração compartilhada do time (cache de 30 s):
      // páginas como Settings leem as chaves logo depois de requireUser(), antes de qualquer db().
      const [{ data: profile }] = await Promise.all([sb.from('profiles').select('*').eq('id', user.id).maybeSingle(), syncConfigFromDb(sb)]);
      if (profile) return profileToUser(profile as Profile, 'supabase');
      const meta = (user.user_metadata || {}) as Record<string, string>;
      return {
        id: user.id,
        username: meta.username || (user.email || '').split('@')[0].toUpperCase(),
        name: meta.full_name || meta.username || 'Usuário',
        role: (meta.role as Role) || 'comercial',
        mode: 'supabase',
      };
    } catch {
      return null;
    }
  }
  const store = await cookies();
  const tokenValue = store.get(SESSION_COOKIE)?.value;
  if (!tokenValue) return null;
  try {
    const { payload } = await jwtVerify(tokenValue, new TextEncoder().encode(sessionSecret()));
    await ensureSeed(localDB);
    const p = await localDB.get('profiles', String(payload.sub));
    return p ? profileToUser(p, 'local') : null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSession();
  if (!u) redirect('/login');
  return u;
}

export async function requireRole(roles: Role[]) {
  const u = await requireUser();
  if (!roles.includes(u.role) && u.role !== 'admin') redirect('/?negado=1');
  return u;
}

export async function login(username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const uname = username.trim();
  if (!uname || !password) return { ok: false, error: 'Informe usuário e senha.' };

  if (isSupabaseMode()) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.signInWithPassword({ email: usernameToEmail(uname), password });
    if (error) {
      const msg = /invalid login/i.test(error.message) ? 'Usuário ou senha incorretos.' : /confirm/i.test(error.message) ? 'Usuário ainda não confirmado no Supabase.' : error.message;
      return { ok: false, error: msg };
    }
    return { ok: true };
  }

  await ensureSeed(localDB);
  const profiles = await localDB.list('profiles');
  const p = profiles.find((x) => x.username.toLowerCase() === uname.toLowerCase());
  if (!p || !verifyPassword(password, p.password_hash)) return { ok: false, error: 'Usuário ou senha incorretos.' };
  const jwt = await new SignJWT({ role: p.role, username: p.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(p.id)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(new TextEncoder().encode(sessionSecret()));
  const store = await cookies();
  store.set(SESSION_COOKIE, jwt, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30, secure: process.env.NODE_ENV === 'production' && !process.env.IHS_DESKTOP });
  return { ok: true };
}

export async function logout() {
  if (isSupabaseMode()) {
    const sb = await supabaseServer();
    await sb.auth.signOut();
  }
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function changePassword(userId: string, current: string, next: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (next.length < 8) return { ok: false, error: 'A nova senha precisa de pelo menos 8 caracteres.' };
  if (isSupabaseMode()) {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    if (!data.user?.email) return { ok: false, error: 'Sessão inválida.' };
    const check = await sb.auth.signInWithPassword({ email: data.user.email, password: current });
    if (check.error) return { ok: false, error: 'Senha atual incorreta.' };
    const { error } = await sb.auth.updateUser({ password: next });
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  const p = await localDB.get('profiles', userId);
  if (!p || !verifyPassword(current, p.password_hash)) return { ok: false, error: 'Senha atual incorreta.' };
  await localDB.update('profiles', userId, { password_hash: hashPassword(next) } as any);
  return { ok: true };
}
