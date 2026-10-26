import 'server-only';
import { getSecret, readConfig } from '@/lib/config';

/**
 * OpenAI (ChatGPT) no Studio: SÓ imagens (moodboards, imagens de apoio, variações).
 * Todo texto, estratégia, copy e roteiro ficam no Claude (src/lib/ai/claude.ts). Aqui não existe chat
 * nem reserva de texto: sem chave da OpenAI, apenas a geração de imagem fica indisponível.
 */

export const IMAGE_MODELS = ['gpt-image-1', 'gpt-image-1-mini', 'dall-e-3'] as const;
export type ImageModel = (typeof IMAGE_MODELS)[number];
export const DEFAULT_IMAGE_MODEL: ImageModel = 'gpt-image-1';

/** Formatos do Studio: quadrado, horizontal 3:2 e vertical 2:3. No dall-e-3 o lado maior vira 1792. */
export const IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
export type ImageQuality = 'low' | 'medium' | 'high';

const DALLE3_SIZE: Record<ImageSize, string> = { '1024x1024': '1024x1024', '1536x1024': '1792x1024', '1024x1536': '1024x1792' };

// Preço de referência (USD) só para a métrica de custo do painel. Os gpt-image cobram por milhão de tokens
// (a API devolve o uso); o dall-e-3 cobra por imagem, em qualidade standard.
const TOKEN_PRICE = { 'gpt-image-1': { in: 5, out: 40 }, 'gpt-image-1-mini': { in: 2, out: 8 } } as const;
const DALLE3_PRICE: Record<string, number> = { '1024x1024': 0.04, '1792x1024': 0.08, '1024x1792': 0.08 };

export function isImageModel(v: unknown): v is ImageModel {
  return typeof v === 'string' && (IMAGE_MODELS as readonly string[]).includes(v);
}

export function isImageSize(v: unknown): v is ImageSize {
  return typeof v === 'string' && (IMAGE_SIZES as readonly string[]).includes(v);
}

export function hasOpenAIKey() {
  return Boolean(getSecret('openaiApiKey'));
}

/** Modelo de imagem em uso: o salvo em Settings, se for um dos suportados; senão o padrão. */
export function openaiImageModel(): ImageModel {
  const saved = readConfig().openaiImageModel;
  return isImageModel(saved) ? saved : DEFAULT_IMAGE_MODEL;
}

/** Erro vindo da chamada à OpenAI, já com mensagem pronta para o time. */
export class OpenAIError extends Error {}

/** Traduz os erros mais comuns da API para uma mensagem que o time entende e sabe resolver. */
function friendlyError(status: number, message: string, code: string, model?: string): string {
  const msg = message.toLowerCase();
  const modelName = model || 'o modelo pedido';
  if (status === 401) return 'A OpenAI recusou a chave (inválida, revogada ou de outro projeto). Cole uma chave nova em Settings → Integrações.';
  if (code === 'model_not_found' || status === 404) return `Esta chave não tem acesso a ${modelName}. Escolha outro modelo de imagem em Settings → Integrações.`;
  if (status === 403 && msg.includes('verif')) return `A OpenAI só libera ${modelName} para organizações verificadas (platform.openai.com → Settings → Organization → General). Verifique a organização ou escolha outro modelo de imagem em Settings.`;
  if (status === 403) return 'Esta chave não tem permissão para isso. No painel da OpenAI, libere para a chave a leitura de modelos e a geração de imagens.';
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return 'A conta da OpenAI está sem saldo ou no limite de gasto. Confira em platform.openai.com → Billing.';
  if (status === 429) return 'A OpenAI limitou as chamadas por agora. Espere um minuto e tente de novo.';
  if (code === 'content_policy_violation' || code === 'moderation_blocked' || msg.includes('safety system')) return 'A OpenAI recusou o pedido pela política de conteúdo. Reescreva a descrição sem marcas, pessoas reais ou temas sensíveis.';
  if (status >= 500) return `A OpenAI está instável agora (erro ${status}). Tente de novo em instantes.`;
  return message ? `OpenAI: ${message}` : `A OpenAI respondeu com erro ${status}.`;
}

async function call<T>(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs: number; model?: string }): Promise<T> {
  const key = getSecret('openaiApiKey');
  if (!key) throw new OpenAIError('Chave da OpenAI não configurada.');
  const get = opts.method === 'GET';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  let res: Response;
  let json: any = {};
  try {
    res = await fetch(`https://api.openai.com/v1${path}`, {
      method: get ? 'GET' : 'POST',
      headers: get ? { authorization: `Bearer ${key}` } : { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: get ? undefined : JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = {}; // corpo que não é JSON (erro de proxy, por exemplo): a mensagem sai do status
    }
  } catch (e) {
    throw new OpenAIError(
      (e as Error)?.name === 'AbortError'
        ? 'A OpenAI demorou demais para responder. Tente de novo.'
        : 'Sem conexão com a OpenAI (api.openai.com). Confira a rede do servidor e tente de novo.',
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new OpenAIError(friendlyError(res.status, String(json?.error?.message || ''), String(json?.error?.code || ''), opts.model));
  return json as T;
}

export type ImageResult = {
  bytes: Buffer;
  mime: string;
  /** Identificador gravado nos registros: `openai:<modelo>`. */
  model: string;
  /** Formato realmente pedido à API (no dall-e-3, 1792 no lado maior). */
  size: string;
  inTok: number;
  outTok: number;
  /** Custo de referência em USD, para o painel de custos. */
  costUsd: number;
};

type ImagesResponse = { data?: { b64_json?: string; url?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };

/**
 * Gera uma imagem. Padrão: gpt-image-1 em /v1/images/generations, que devolve base64 (b64_json → Buffer).
 * No dall-e-3 os formatos viram 1024x1024, 1792x1024 e 1024x1792 e a resposta é pedida em b64_json.
 */
export async function openaiImage(opts: { prompt: string; size?: ImageSize; quality?: ImageQuality; model?: ImageModel }): Promise<ImageResult> {
  const model = isImageModel(opts.model) ? opts.model : openaiImageModel();
  const wanted = isImageSize(opts.size) ? opts.size : '1024x1024';
  const dalle = model === 'dall-e-3';
  const size = dalle ? DALLE3_SIZE[wanted] : wanted;
  const prompt = opts.prompt.trim().slice(0, dalle ? 4000 : 32_000);
  const body: Record<string, unknown> = { model, prompt, n: 1, size };
  if (dalle) body.response_format = 'b64_json';
  else body.quality = opts.quality || 'medium';

  const r = await call<ImagesResponse>('/images/generations', { body, timeoutMs: 180_000, model });
  const item = r.data?.[0];
  let bytes: Buffer;
  let mime = 'image/png';
  if (item?.b64_json) {
    bytes = Buffer.from(item.b64_json, 'base64');
  } else if (item?.url) {
    const img = await fetch(item.url);
    if (!img.ok) throw new OpenAIError(`A OpenAI gerou a imagem, mas o download falhou (erro ${img.status}). Tente de novo.`);
    bytes = Buffer.from(await img.arrayBuffer());
    mime = img.headers.get('content-type') || mime;
  } else {
    throw new OpenAIError('A OpenAI não devolveu a imagem. Tente de novo.');
  }

  // Uso em tokens (gpt-image) vem da própria resposta; sem ele, estimamos pelo tamanho do prompt e por uma imagem média.
  const inTok = dalle ? 0 : r.usage?.input_tokens ?? Math.ceil(prompt.length / 4);
  const outTok = dalle ? 0 : r.usage?.output_tokens ?? 1056;
  const costUsd = dalle
    ? DALLE3_PRICE[size] ?? 0.04
    : Number(((inTok * TOKEN_PRICE[model].in + outTok * TOKEN_PRICE[model].out) / 1_000_000).toFixed(4));
  return { bytes, mime, model: `openai:${model}`, size, inTok, outTok, costUsd };
}

/** Teste de conexão: lista os modelos da chave e confere se o modelo de imagem configurado está entre eles. */
export async function openaiTest(): Promise<{ ok: boolean; detail: string }> {
  const r = await call<{ data?: { id: string }[] }>('/models', { method: 'GET', timeoutMs: 30_000 });
  const ids = new Set((r.data || []).map((m) => m.id));
  const model = openaiImageModel();
  const usable = IMAGE_MODELS.filter((m) => ids.has(m));
  if (ids.has(model)) {
    const others = usable.filter((m) => m !== model);
    return { ok: true, detail: `Chave válida. Modelo de imagem ${model} disponível${others.length ? `; a chave também acessa ${others.join(' e ')}` : ''}.` };
  }
  if (usable.length) {
    return { ok: false, detail: `Chave válida, mas o modelo de imagem ${model} não está disponível nesta conta. Modelos de imagem que a chave pode usar: ${usable.join(', ')}. Troque o modelo no card ChatGPT · Imagens.` };
  }
  return { ok: false, detail: `Chave válida, mas ela não acessa nenhum modelo de imagem (${IMAGE_MODELS.join(', ')}). Na OpenAI, confira a verificação da organização e as permissões da chave; sem isso a geração de imagens não funciona.` };
}
