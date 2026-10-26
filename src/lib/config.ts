import 'server-only';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Configuração do servidor: variáveis de ambiente + arquivo config.json na pasta de dados.
 * Chaves salvas em Configurações ficam no config.json (nunca vão para o cliente).
 * No modo Supabase a configuração é compartilhada pelo time na tabela app_config (linha "main"):
 * o cache em memória espelha essa linha e vale mais que o arquivo local.
 */

export const APP_NAME = 'IMPACTO HEADSOFTWARE';
export const APP_VERSION = '0.1.0';

export function dataDir() {
  // Na Vercel o disco é somente leitura, exceto /tmp: lá fica só um rascunho volátil da instância.
  const dir = process.env.IHS_DATA_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), 'impacto-data') : path.join(process.cwd(), '.data'));
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* somente leitura */
  }
  return dir;
}

export type AppConfig = {
  anthropicApiKey?: string;
  anthropicModelStrategy?: string; // claude-opus-5-5 | claude-fable-5-1
  anthropicModelCopy?: string; // claude-sonnet-5-5 | claude-haiku-5-5
  anthropicEffort?: string; // max | high | medium (orçamento de pensamento na estratégia)
  openaiApiKey?: string;
  openaiTextModel?: string; // gpt-5 por padrão
  openaiImageModel?: string; // gpt-image-1 por padrão
  aiFallbackToOpenAI?: boolean; // ChatGPT como reserva do Claude (ligado por padrão)
  metaAccessToken?: string;
  metaAppId?: string;
  resendApiKey?: string;
  reportFromEmail?: string;
  apifyToken?: string;
  studio?: {
    name?: string;
    cnpj?: string;
    whatsapp?: string;
    instagram?: string;
    site?: string;
    city?: string;
    email?: string;
  };
  updatedAt?: string;
};

const configPath = () => path.join(dataDir(), 'config.json');

/* ------------------------------------------------------------------ */
/* Cache da configuração compartilhada (Supabase · tabela app_config)  */
/* ------------------------------------------------------------------ */

const CONFIG_ROW = 'main';
const CONFIG_TTL_MS = 30_000; // quanto tempo uma instância confia no que leu do banco
const CONFIG_RETRY_MS = 5_000; // depois de uma falha de leitura, tenta de novo logo

type ConfigCache = { data: AppConfig; loadedAt: number; version: number };
const g = globalThis as unknown as { __ihsConfig?: ConfigCache; __ihsConfigSync?: Promise<void> };
const cache = (): ConfigCache => (g.__ihsConfig ||= { data: {}, loadedAt: 0, version: 0 });

/** O que sobe para o banco: nada que valha só para a máquina (segredo de sessão do modo local). */
function shareable(cfg: AppConfig): AppConfig {
  const out = { ...cfg } as AppConfig & { sessionSecret?: string };
  delete out.sessionSecret;
  return out;
}

/** `over` vence `base`; o objeto `studio` é mesclado campo a campo. */
function mergeConfig(base: AppConfig, over: Partial<AppConfig>): AppConfig {
  const out: AppConfig = { ...base, ...over };
  if (base.studio || over.studio) out.studio = { ...(base.studio || {}), ...(over.studio || {}) };
  return out;
}

function readFileConfig(): AppConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8')) as AppConfig;
  } catch {
    return {};
  }
}

/** Arquivo local + cache da configuração compartilhada (o cache vence). */
export function readConfig(): AppConfig {
  return mergeConfig(readFileConfig(), cache().data);
}

export function writeConfig(patch: Partial<AppConfig>) {
  const next: AppConfig = { ...mergeConfig(readConfig(), patch), updatedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
  } catch {
    /* disco somente leitura: no modo Supabase a fonte é a linha app_config */
  }
  // No modo Supabase o cache vale na hora para esta instância. No modo local o arquivo é a fonte
  // (relido a cada leitura) e o cache fica de fora, então nada muda para o app desktop.
  if (isSupabaseMode()) {
    const c = cache();
    c.data = shareable(next);
    c.version++;
  }
  return next;
}

/** Confere no arquivo (não no cache) se a gravação `next` chegou ao disco. */
export function configOnDisk(next: AppConfig) {
  return readFileConfig().updatedAt === next.updatedAt;
}

type DbError = { code?: string; message?: string };

function friendlyDbError(e: DbError) {
  const msg = e.message || '';
  if (/row-level security/i.test(msg)) return 'Só o admin pode gravar a configuração compartilhada do time (chaves e dados do Studio).';
  if (e.code === 'PGRST205' || e.code === '42P01' || (/app_config/.test(msg) && /schema cache|does not exist/i.test(msg))) {
    return 'A tabela app_config não existe neste Supabase. Aplique a migração supabase/migrations/0002_arquivos_e_config.sql.';
  }
  return `Não foi possível gravar a configuração compartilhada: ${msg || 'erro desconhecido'}`;
}

/** Lê a linha compartilhada. `row` é null quando nenhuma linha é visível para a sessão. */
async function fetchConfigRow(client: SupabaseClient): Promise<{ error: DbError } | { row: AppConfig | null; authed: boolean }> {
  const { data, error } = await client.from('app_config').select('data').eq('id', CONFIG_ROW).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  if (error) return { error };
  if (data?.data && typeof data.data === 'object') return { row: data.data as AppConfig, authed: true };
  // Sem linha: quem não tem sessão também recebe vazio (RLS). Só vale como "carregado" com sessão.
  const { data: s } = await client.auth.getSession();
  return { row: null, authed: Boolean(s.session) };
}

/**
 * Carrega a configuração compartilhada para o cache desta instância (no máximo uma vez a cada 30 s,
 * a menos que `force`). Erros são ignorados: o app segue com o arquivo local e as variáveis de ambiente.
 */
export async function syncConfigFromDb(client: SupabaseClient, force = false): Promise<void> {
  const c = cache();
  if (!force && Date.now() - c.loadedAt < CONFIG_TTL_MS) return;
  if (!force && g.__ihsConfigSync) return g.__ihsConfigSync;

  const version = c.version;
  const run = (async () => {
    try {
      const r = await fetchConfigRow(client);
      // Se a configuração foi gravada enquanto esta leitura estava no ar, o cache novo vale mais.
      if (c.version !== version) return;
      if ('error' in r) {
        c.loadedAt = Date.now() - CONFIG_TTL_MS + CONFIG_RETRY_MS;
        return;
      }
      if (r.row) {
        c.data = shareable(r.row);
        c.loadedAt = Date.now();
      } else if (r.authed) {
        c.data = {};
        c.loadedAt = Date.now();
      }
    } catch {
      c.loadedAt = Date.now() - CONFIG_TTL_MS + CONFIG_RETRY_MS;
    }
  })();
  g.__ihsConfigSync = run;
  try {
    await run;
  } finally {
    if (g.__ihsConfigSync === run) g.__ihsConfigSync = undefined;
  }
}

/**
 * Grava `patch` na linha compartilhada (app_config, id "main"), sobre o que há de mais novo no banco.
 * Só admin escreve (RLS): para os outros papéis volta `{ ok: false, error }` com a explicação.
 */
export async function persistConfigToDb(client: SupabaseClient, patch: Partial<AppConfig>): Promise<{ ok: boolean; error?: string }> {
  try {
    // Base fresca: não apaga o que outro admin salvou há poucos segundos em outra instância.
    const current = await fetchConfigRow(client);
    if ('error' in current) return { ok: false, error: friendlyDbError(current.error) };
    const c = cache();
    if (current.row) c.data = shareable(current.row);

    const next = shareable({ ...mergeConfig(readConfig(), patch), updatedAt: new Date().toISOString() });
    const { data: u } = await client.auth.getUser();
    const { error } = await client
      .from('app_config')
      .upsert({ id: CONFIG_ROW, data: next, updated_at: next.updatedAt, updated_by: u.user?.id ?? null }, { onConflict: 'id' });
    if (error) return { ok: false, error: friendlyDbError(error) };

    c.data = next;
    c.loadedAt = Date.now();
    c.version++;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Não foi possível gravar a configuração compartilhada: ${(e as Error).message}` };
  }
}

export function getSecret(name: 'anthropicApiKey' | 'openaiApiKey' | 'metaAccessToken' | 'resendApiKey' | 'apifyToken') {
  const envMap: Record<string, string | undefined> = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    metaAccessToken: process.env.META_ACCESS_TOKEN,
    resendApiKey: process.env.RESEND_API_KEY,
    apifyToken: process.env.APIFY_TOKEN,
  };
  return readConfig()[name] || envMap[name] || '';
}

export function supabaseEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  return { url, anon };
}

export function isSupabaseMode() {
  const { url, anon } = supabaseEnv();
  return Boolean(url && anon);
}

export function sessionSecret() {
  if (process.env.IHS_SECRET) return process.env.IHS_SECRET;
  const cfg = readConfig() as AppConfig & { sessionSecret?: string };
  if (cfg.sessionSecret) return cfg.sessionSecret;
  const generated = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  writeConfig({ ...(cfg as any), sessionSecret: generated } as any);
  return generated;
}

export const STUDIO_DEFAULTS = {
  name: 'Studio Impacto',
  cnpj: '68.967.380/0001-71',
  whatsapp: '(34) 99899-0606',
  instagram: '@astudioimpacto',
  site: 'studioimpacto.com.br',
  city: 'Uberlândia, MG',
  email: 'contato@studioimpacto.com.br',
};
