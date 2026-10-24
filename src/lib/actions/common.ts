'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSession, logout } from '@/lib/auth';
import type { TableName, Tables } from '@/lib/db/types';

export async function setActiveClientAction(id: string) {
  const store = await cookies();
  store.set('ihs_client', id, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}

export async function getActiveClientId() {
  const store = await cookies();
  return store.get('ihs_client')?.value || null;
}

export async function markNotificationsReadAction() {
  const user = await getSession();
  if (!user) return;
  const d = await db();
  const list = await d.list('notifications', { where: { user_id: user.id } });
  const now = new Date().toISOString();
  for (const n of list) if (!n.read_at) await d.update('notifications', n.id, { read_at: now } as any);
  revalidatePath('/', 'layout');
}

export async function logoutAction() {
  await logout();
  redirect('/login');
}

/** Atualização genérica de um campo (usada por kanbans e toggles). */
export async function updateRowAction<K extends TableName>(table: K, id: string, patch: Partial<Tables[K]>, paths: string[] = ['/']) {
  const user = await getSession();
  if (!user) return { ok: false, error: 'Não autorizado' };
  const d = await db();
  await d.update(table, id, patch);
  for (const p of paths) revalidatePath(p);
  return { ok: true };
}

export async function deleteRowAction<K extends TableName>(table: K, id: string, paths: string[] = ['/']) {
  const user = await getSession();
  if (!user) return { ok: false, error: 'Não autorizado' };
  const d = await db();
  await d.remove(table, id);
  for (const p of paths) revalidatePath(p);
  return { ok: true };
}

export async function insertRowAction<K extends TableName>(table: K, row: Partial<Tables[K]>, paths: string[] = ['/']) {
  const user = await getSession();
  if (!user) return { ok: false as const, error: 'Não autorizado' };
  const d = await db();
  const created = await d.insert(table, row);
  for (const p of paths) revalidatePath(p);
  return { ok: true as const, id: created.id };
}
