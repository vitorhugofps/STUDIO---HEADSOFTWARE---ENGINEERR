import 'server-only';
import { getSecret, readConfig } from '@/lib/config';

/**
 * OpenAI (ChatGPT) como reserva do Claude e como motor de imagem.
 * Política do Studio: Claude primeiro em toda execução; ChatGPT entra no que o Claude não resolve
 * (geração de imagens) e como fallback quando a chamada ao Claude falha ou não há chave da Anthropic.
 */

export const OPENAI_DEFAULTS = { text: 'gpt-5', image: 'gpt-image-1' } as const;

export function hasOpenAIKey() {
  return Boolean(getSecret('openaiApiKey'));
}

export function openaiModels() {
  const cfg = readConfig();
  return { text: cfg.openaiTextModel || OPENAI_DEFAULTS.text, image: cfg.openaiImageModel || OPENAI_DEFAULTS.image };
}

export function fallbackEnabled() {
  const cfg = readConfig();
  return cfg.aiFallbackToOpenAI !== false; // ligado por padrão
}

async function call<T>(path: string, body: unknown, init?: { method?: string; timeoutMs?: number }): Promise<T> {
  const key = getSecret('openaiApiKey');
  if (!key) throw new Error('Chave da OpenAI não configurada');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init?.timeoutMs || 120_000);
  try {
    const res = await fetch(`https://api.openai.com/v1${path}`, {
      method: init?.method || 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: init?.method === 'GET' ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new Error(json?.error?.message || `OpenAI ${res.status}`);
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

type ChatResult = { text: string; model: string; inTok: number; outTok: number };

/** Texto (ou JSON) pelo ChatGPT. Usa response_format json_object quando `json` é true. */
export async function openaiChat(opts: { system: string; user: string; json?: boolean; maxTokens?: number; model?: string }): Promise<ChatResult> {
  const model = opts.model || openaiModels().text;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.json ? `${opts.user}\n\nResponda somente com um objeto JSON válido.` : opts.user },
    ],
    max_completion_tokens: opts.maxTokens || 4000,
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  const r = await call<any>('/chat/completions', body);
  const text = r.choices?.[0]?.message?.content || '';
  return { text, model: `openai:${model}`, inTok: r.usage?.prompt_tokens || 0, outTok: r.usage?.completion_tokens || 0 };
}

/** Imagem pelo ChatGPT (gpt-image-1 devolve base64). */
export async function openaiImage(opts: { prompt: string; size?: '1024x1024' | '1024x1536' | '1536x1024'; quality?: 'low' | 'medium' | 'high'; model?: string }): Promise<{ bytes: Buffer; mime: string; model: string }> {
  const model = opts.model || openaiModels().image;
  const body: Record<string, unknown> = { model, prompt: opts.prompt, n: 1, size: opts.size || '1024x1024' };
  if (model.startsWith('gpt-image')) body.quality = opts.quality || 'medium';
  else body.response_format = 'b64_json';
  const r = await call<any>('/images/generations', body, { timeoutMs: 180_000 });
  const item = r.data?.[0];
  if (!item) throw new Error('A OpenAI não devolveu imagem.');
  if (item.b64_json) return { bytes: Buffer.from(item.b64_json, 'base64'), mime: 'image/png', model: `openai:${model}` };
  if (item.url) {
    const img = await fetch(item.url);
    return { bytes: Buffer.from(await img.arrayBuffer()), mime: img.headers.get('content-type') || 'image/png', model: `openai:${model}` };
  }
  throw new Error('Formato de imagem não reconhecido.');
}

/** Teste de conexão: lista modelos e confere se os configurados existem. */
export async function openaiTest(): Promise<{ ok: boolean; detail: string }> {
  const r = await call<any>('/models', undefined, { method: 'GET', timeoutMs: 30_000 });
  const ids: string[] = (r.data || []).map((m: any) => m.id);
  const { text, image } = openaiModels();
  const missing = [text, image].filter((m) => !ids.includes(m));
  return {
    ok: missing.length === 0,
    detail: `${ids.length} modelos disponíveis. ${missing.length ? `Não encontrados nesta conta: ${missing.join(', ')}. Troque em Settings.` : `Texto ${text} e imagem ${image} disponíveis.`}`,
  };
}
