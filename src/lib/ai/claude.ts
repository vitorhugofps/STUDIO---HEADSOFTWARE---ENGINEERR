import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { getSecret, readConfig } from '@/lib/config';
import { extractJSON } from '@/lib/utils';
import type { DB } from '@/lib/db/types';

/**
 * Roteador de IA do Studio.
 * 1. Todo texto, estratégia e roteiro passam só pelo Claude: estratégia em Opus 5.5 ou Fable 5.1 (com esforço), copy em Sonnet 5.5, leve em Haiku 5.5.
 * 2. O ChatGPT (OpenAI) não escreve texto nem serve de reserva: fica restrito às imagens (src/lib/ai/openai.ts).
 * 3. Sem chave da Anthropic: devolve o exemplo marcado, nunca trava a tela.
 */

export const MODELS = {
  strategy: 'claude-opus-5-5',
  copy: 'claude-sonnet-5-5',
  light: 'claude-haiku-5-5',
} as const;

export const STRATEGY_MODELS = ['claude-opus-5-5', 'claude-fable-5-1'] as const;
export const COPY_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'] as const;
export const EFFORTS = ['max', 'high', 'medium'] as const;
export type Effort = (typeof EFFORTS)[number];

/** Esforço de raciocínio → orçamento de pensamento (tokens) do Claude. */
const THINKING_BUDGET: Record<Effort, number> = { max: 32_000, high: 16_000, medium: 8_000 };

export type ModelTier = keyof typeof MODELS;

// Preço de referência (USD por milhão de tokens) para a métrica de custo do painel.
const PRICE: Record<string, { in: number; out: number }> = {
  'claude-fable-5-1': { in: 25, out: 125 },
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

export function resolveEffort(): Effort {
  const e = readConfig().anthropicEffort as Effort | undefined;
  return e && EFFORTS.includes(e) ? e : 'high';
}

export function hasAIKey() {
  return Boolean(getSecret('anthropicApiKey'));
}

/** Há motor de texto disponível? Só o Claude escreve texto, então é o mesmo que ter a chave da Anthropic. */
export function hasAnyTextAI() {
  return hasAIKey();
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

export function estimateCost(model: string, inTok: number, outTok: number) {
  const p = PRICE[model] || PRICE['claude-sonnet-5-5'];
  return Number(((inTok * p.in + outTok * p.out) / 1_000_000).toFixed(4));
}

async function callClaude(opts: GenOpts): Promise<{ text: string; model: string; inTok: number; outTok: number }> {
  const client = new Anthropic({ apiKey: getSecret('anthropicApiKey'), timeout: 10 * 60 * 1000, maxRetries: 2 });
  const tier = opts.tier || 'copy';
  const model = resolveModel(tier);
  const maxTokens = opts.maxTokens || 4000;
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  };
  // Esforço: só na camada de estratégia (Opus 5.5 / Fable 5.1), onde pensar mais compensa.
  if (tier === 'strategy') {
    const budget = THINKING_BUDGET[resolveEffort()];
    params.max_tokens = maxTokens + budget;
    (params as any).thinking = { type: 'enabled', budget_tokens: budget };
  }
  // Streaming evita o limite de tempo das chamadas longas e junta o resultado no fim.
  const res = await client.messages.stream(params).finalMessage();
  const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  return { text, model, inTok: res.usage?.input_tokens || 0, outTok: res.usage?.output_tokens || 0 };
}

async function record(opts: GenOpts, model: string, inTok: number, outTok: number, status: 'ok' | 'erro' | 'exemplo') {
  if (!opts.db) return;
  try {
    await opts.db.insert('agent_runs', { agent: opts.agent, model, input_tokens: inTok, output_tokens: outTok, cost_usd: estimateCost(model, inTok, outTok), status, client_id: opts.clientId || null } as any);
  } catch {
    /* ignore */
  }
}

/** Executa com o Claude. Sem chave da Anthropic devolve null (quem chamou usa o exemplo marcado); se a chamada falhar, propaga o erro. */
async function runText(opts: GenOpts): Promise<{ text: string; model: string; inTok: number; outTok: number } | null> {
  if (!hasAIKey()) return null;
  try {
    return await callClaude(opts);
  } catch (e) {
    console.error('[claude]', (e as Error).message);
    await record(opts, resolveModel(opts.tier || 'copy'), 0, 0, 'erro');
    throw e;
  }
}

/** Gera JSON. Sem motor disponível, devolve o exemplo marcado (isExample=true). */
export async function generateJSON<T>(opts: GenOpts & { example: T }): Promise<GenResult<T>> {
  if (!hasAnyTextAI()) {
    await record(opts, resolveModel(opts.tier || 'copy'), 0, 0, 'exemplo');
    return { data: opts.example, isExample: true, model: 'exemplo' };
  }
  try {
    const r = await runText({ ...opts, system: opts.system + '\n\nResponda SOMENTE com JSON válido, sem comentários, no formato pedido.' });
    if (!r) return { data: opts.example, isExample: true, model: 'exemplo' };
    const parsed = extractJSON<T>(r.text);
    await record(opts, r.model, r.inTok, r.outTok, parsed ? 'ok' : 'erro');
    if (!parsed) return { data: opts.example, isExample: true, model: r.model, raw: r.text };
    return { data: parsed, isExample: false, model: r.model, raw: r.text };
  } catch (e) {
    console.error('[ia]', (e as Error).message);
    return { data: opts.example, isExample: true, model: 'erro' };
  }
}

/** Gera texto livre. Sem motor, devolve o fallback marcado. */
export async function generateText(opts: GenOpts & { fallback: string }): Promise<GenResult<string>> {
  if (!hasAnyTextAI()) {
    await record(opts, resolveModel(opts.tier || 'copy'), 0, 0, 'exemplo');
    return { data: opts.fallback, isExample: true, model: 'exemplo' };
  }
  try {
    const r = await runText(opts);
    if (!r) return { data: opts.fallback, isExample: true, model: 'exemplo' };
    await record(opts, r.model, r.inTok, r.outTok, 'ok');
    return { data: r.text.trim(), isExample: false, model: r.model };
  } catch (e) {
    console.error('[ia]', (e as Error).message);
    return { data: opts.fallback, isExample: true, model: 'erro' };
  }
}

/** Streaming para o Assistente Impacto (Claude). */
export async function streamChat(system: string, messages: { role: 'user' | 'assistant'; content: string }[], tier: ModelTier = 'copy') {
  const client = new Anthropic({ apiKey: getSecret('anthropicApiKey') });
  return client.messages.stream({ model: resolveModel(tier), max_tokens: 2000, system, messages });
}

/** Teste de conexão com a Anthropic: uma chamada mínima no modelo leve. */
export async function anthropicTest(): Promise<{ ok: boolean; detail: string }> {
  const client = new Anthropic({ apiKey: getSecret('anthropicApiKey'), timeout: 30_000, maxRetries: 0 });
  const t0 = Date.now();
  const res = await client.messages.create({ model: resolveModel('light'), max_tokens: 12, messages: [{ role: 'user', content: 'Responda só: ok' }] });
  const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim();
  return { ok: true, detail: `${res.model} respondeu "${text.slice(0, 20)}" em ${Date.now() - t0} ms. Estratégia: ${resolveModel('strategy')} (esforço ${resolveEffort()}), copy: ${resolveModel('copy')}.` };
}
