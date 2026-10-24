import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { getSecret, readConfig } from '@/lib/config';
import { extractJSON } from '@/lib/utils';
import type { DB } from '@/lib/db/types';

export const MODELS = {
  strategy: 'claude-opus-5-5',
  copy: 'claude-sonnet-5-5',
  light: 'claude-haiku-5-5',
} as const;

export type ModelTier = keyof typeof MODELS;

// Preço de referência (USD por milhão de tokens) para a métrica de custo do painel.
const PRICE: Record<string, { in: number; out: number }> = {
  'claude-opus-5-5': { in: 15, out: 75 },
  'claude-sonnet-5-5': { in: 3, out: 15 },
  'claude-haiku-5-5': { in: 0.8, out: 4 },
};

export function resolveModel(tier: ModelTier) {
  const cfg = readConfig();
  if (tier === 'strategy' && cfg.anthropicModelStrategy) return cfg.anthropicModelStrategy;
  if (tier === 'copy' && cfg.anthropicModelCopy) return cfg.anthropicModelCopy;
  return MODELS[tier];
}

export function hasAIKey() {
  return Boolean(getSecret('anthropicApiKey'));
}

type GenOpts = {
  agent: string;
  tier?: ModelTier;
  system: string;
  user: string;
  maxTokens?: number;
  db?: DB;
  clientId?: string | null;
};

export type GenResult<T> = { data: T; isExample: boolean; model: string; raw?: string };

async function callClaude(opts: GenOpts): Promise<{ text: string; model: string; inTok: number; outTok: number }> {
  const key = getSecret('anthropicApiKey');
  const client = new Anthropic({ apiKey: key });
  const model = resolveModel(opts.tier || 'copy');
  const res = await client.messages.create({
    model,
    max_tokens: opts.maxTokens || 4000,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });
  const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  return { text, model, inTok: res.usage?.input_tokens || 0, outTok: res.usage?.output_tokens || 0 };
}

async function record(opts: GenOpts, model: string, inTok: number, outTok: number, status: 'ok' | 'erro' | 'exemplo') {
  if (!opts.db) return;
  const p = PRICE[model] || PRICE['claude-sonnet-5-5'];
  const cost = (inTok * p.in + outTok * p.out) / 1_000_000;
  try {
    await opts.db.insert('agent_runs', { agent: opts.agent, model, input_tokens: inTok, output_tokens: outTok, cost_usd: Number(cost.toFixed(4)), status, client_id: opts.clientId || null } as any);
  } catch {
    /* ignore */
  }
}

/** Gera JSON com o Claude. Sem chave configurada, devolve o exemplo marcado (isExample=true). */
export async function generateJSON<T>(opts: GenOpts & { example: T }): Promise<GenResult<T>> {
  if (!hasAIKey()) {
    await record(opts, resolveModel(opts.tier || 'copy'), 0, 0, 'exemplo');
    return { data: opts.example, isExample: true, model: 'exemplo' };
  }
  try {
    const { text, model, inTok, outTok } = await callClaude({
      ...opts,
      system: opts.system + '\n\nResponda SOMENTE com JSON válido, sem comentários, no formato pedido.',
    });
    const parsed = extractJSON<T>(text);
    await record(opts, model, inTok, outTok, parsed ? 'ok' : 'erro');
    if (!parsed) return { data: opts.example, isExample: true, model, raw: text };
    return { data: parsed, isExample: false, model, raw: text };
  } catch (e) {
    console.error('[claude]', (e as Error).message);
    await record(opts, resolveModel(opts.tier || 'copy'), 0, 0, 'erro');
    return { data: opts.example, isExample: true, model: 'erro' };
  }
}

/** Gera texto livre. Sem chave, devolve o fallback marcado. */
export async function generateText(opts: GenOpts & { fallback: string }): Promise<GenResult<string>> {
  if (!hasAIKey()) {
    await record(opts, resolveModel(opts.tier || 'copy'), 0, 0, 'exemplo');
    return { data: opts.fallback, isExample: true, model: 'exemplo' };
  }
  try {
    const { text, model, inTok, outTok } = await callClaude(opts);
    await record(opts, model, inTok, outTok, 'ok');
    return { data: text.trim(), isExample: false, model };
  } catch (e) {
    console.error('[claude]', (e as Error).message);
    await record(opts, resolveModel(opts.tier || 'copy'), 0, 0, 'erro');
    return { data: opts.fallback, isExample: true, model: 'erro' };
  }
}

/** Streaming para o Assistente Impacto. */
export async function streamChat(system: string, messages: { role: 'user' | 'assistant'; content: string }[], tier: ModelTier = 'copy') {
  const client = new Anthropic({ apiKey: getSecret('anthropicApiKey') });
  return client.messages.stream({ model: resolveModel(tier), max_tokens: 2000, system, messages });
}
