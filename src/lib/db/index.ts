import 'server-only';
import { configOnDisk, isSupabaseMode, persistConfigToDb, syncConfigFromDb, writeConfig, type AppConfig } from '@/lib/config';
import { localDB } from './local';
import { supabaseDB, supabaseServer } from './supabase';
import { ensureSeed } from './seed';
import type { DB } from './types';

export type { DB } from './types';

/** Retorna o banco da requisição atual (Supabase com a sessão do usuário, ou o banco local). */
export async function db(): Promise<DB> {
  let d: DB;
  if (isSupabaseMode()) {
    const client = await supabaseServer();
    // Chaves e dados do Studio são compartilhados pelo time: toda requisição enxerga a versão mais recente.
    await syncConfigFromDb(client);
    d = supabaseDB(client);
  } else {
    d = localDB;
  }
  try {
    await ensureSeed(d);
  } catch (e) {
    console.warn('[seed] ignorado:', (e as Error).message);
  }
  return d;
}

/**
 * Salva ajustes do Studio (chaves, modelos, dados). No modo Supabase vão primeiro para a linha
 * compartilhada app_config (só admin escreve; para os outros volta o motivo) e o arquivo local acompanha.
 * No modo local vale o arquivo; se o disco não aceitar a gravação, volta o erro.
 */
export async function saveConfig(patch: Partial<AppConfig>): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isSupabaseMode()) {
    const r = await persistConfigToDb(await supabaseServer(), patch);
    if (!r.ok) return { ok: false, error: r.error || 'Não foi possível gravar a configuração compartilhada.' };
    writeConfig(patch);
    return { ok: true };
  }
  const next = writeConfig(patch);
  if (!configOnDisk(next)) return { ok: false, error: 'Não foi possível gravar neste ambiente (somente leitura). Use variáveis de ambiente.' };
  return { ok: true };
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
