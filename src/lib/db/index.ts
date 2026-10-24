import 'server-only';
import { isSupabaseMode } from '@/lib/config';
import { localDB } from './local';
import { supabaseDB, supabaseServer } from './supabase';
import { ensureSeed } from './seed';
import type { DB } from './types';

export type { DB } from './types';

/** Retorna o banco da requisição atual (Supabase com a sessão do usuário, ou o banco local). */
export async function db(): Promise<DB> {
  const d = isSupabaseMode() ? supabaseDB(await supabaseServer()) : localDB;
  try {
    await ensureSeed(d);
  } catch (e) {
    console.warn('[seed] ignorado:', (e as Error).message);
  }
  return d;
}

/** Registra uma atividade no histórico (nunca falha a operação principal). */
export async function logActivity(
  d: DB,
  a: { actor_id?: string | null; actor_name?: string | null; action: string; entity?: string; entity_id?: string; meta?: Record<string, unknown> },
) {
  try {
    await d.insert('activity_log', a as any);
  } catch {
    /* ignore */
  }
}
