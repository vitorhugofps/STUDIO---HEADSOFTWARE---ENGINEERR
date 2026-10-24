import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Configuração do servidor: variáveis de ambiente + arquivo config.json na pasta de dados.
 * Chaves salvas em Configurações ficam no config.json (nunca vão para o cliente).
 */

export const APP_NAME = 'IMPACTO HEADSOFTWARE';
export const APP_VERSION = '0.1.0';

export function dataDir() {
  const dir = process.env.IHS_DATA_DIR || path.join(process.cwd(), '.data');
  if (!process.env.VERCEL) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* somente leitura */
    }
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

export function readConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return JSON.parse(raw) as AppConfig;
  } catch {
    return {};
  }
}

export function writeConfig(patch: Partial<AppConfig>) {
  const next = { ...readConfig(), ...patch, updatedAt: new Date().toISOString() };
  if (patch.studio) next.studio = { ...(readConfig().studio || {}), ...patch.studio };
  try {
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
  } catch {
    /* read-only (Vercel) */
  }
  return next;
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
