import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { dataDir, isSupabaseMode } from '@/lib/config';
import { supabaseServer } from '@/lib/db/supabase';
import { FILES_BUCKET } from '@/lib/file-keys';

/**
 * Armazenamento de arquivos (uploads, imagens geradas por IA, anexos).
 * - Modo Supabase: bucket privado `files` do Supabase Storage, com a sessão do usuário (RLS do bucket).
 *   É o que funciona na Vercel, onde o disco é somente leitura.
 * - Modo local (app desktop e dev): pasta de dados, em `<dataDir>/<chave>`.
 * A chave (`rel`) tem o formato `uploads/<cliente|studio>/<arquivo>`. A URL devolvida é sempre
 * `/api/files/<chave>`: quem entrega o arquivo é a rota, não o endereço do storage.
 */

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.json': 'application/json', '.html': 'text/html; charset=utf-8',
};

/** HTML guardado (brandbooks, portais) abre em origem isolada: o script da página não alcança a sessão do app. */
function extraHeaders(mime: string): Record<string, string> {
  return /text\/html/.test(mime) ? { 'content-security-policy': 'sandbox allow-scripts allow-popups allow-downloads' } : {};
}

export function mimeFromName(name: string) {
  return MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

/** Validade da URL assinada para quem abre um arquivo (segundos). */
const SIGNED_URL_TTL = 3600;

/** Endereço público (da rota) de uma chave. */
export const fileUrl = (rel: string) => `/api/files/${rel}`;

/** Normaliza a chave e recusa qualquer tentativa de sair da pasta de arquivos. */
function cleanKey(rel: string) {
  const key = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!key || key.split('/').some((p) => !p || p === '.' || p === '..')) throw new Error('Caminho inválido');
  return key;
}

/** Caminho no disco (modo local), garantido dentro da pasta de dados. */
function localPath(key: string) {
  const root = path.resolve(dataDir());
  const abs = path.resolve(root, key);
  if (!abs.startsWith(root + path.sep)) throw new Error('Caminho inválido');
  return abs;
}

const text = (body: string, status: number) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** O Storage diz "não existe" com status 400 e statusCode "404" (código NoSuchKey); a RLS que esconde o objeto vem igual. */
function isNotFound(e: unknown) {
  const x = e as { status?: number | string; statusCode?: number | string; code?: string; message?: string } | null;
  if (!x) return false;
  return Number(x.status) === 404 || Number(x.statusCode) === 404 || x.code === 'NoSuchKey' || /not found/i.test(x.message || '');
}

/** Salva o arquivo e devolve a chave e a URL. Lança erro com mensagem legível se não conseguir. */
export async function putFile(rel: string, data: Buffer, mime: string): Promise<{ path: string; url: string }> {
  const key = cleanKey(rel);
  if (isSupabaseMode()) {
    const sb = await supabaseServer();
    const { error } = await sb.storage.from(FILES_BUCKET).upload(key, data, { contentType: mime || mimeFromName(key), upsert: true });
    if (error) throw new Error(`Não foi possível salvar o arquivo no armazenamento do time: ${error.message}`);
  } else {
    const abs = localPath(key);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  }
  return { path: key, url: fileUrl(key) };
}

/**
 * Lê o arquivo inteiro. Devolve null se não existir.
 * No Supabase o download passa pelo CDN: se o mesmo caminho foi sobrescrito ou removido há instantes,
 * a leitura pode devolver a versão anterior por cerca de 1 minuto. Os nomes de upload são sempre novos,
 * então o app não depende disso; quem precisar de leitura fresca logo após sobrescrever deve esperar ou trocar o nome.
 */
export async function getFile(rel: string): Promise<{ data: Buffer; mime: string } | null> {
  let key: string;
  try {
    key = cleanKey(rel);
  } catch {
    return null;
  }
  if (isSupabaseMode()) {
    const sb = await supabaseServer();
    const { data, error } = await sb.storage.from(FILES_BUCKET).download(key);
    if (error || !data) return null;
    return { data: Buffer.from(await data.arrayBuffer()), mime: data.type || mimeFromName(key) };
  }
  try {
    return { data: fs.readFileSync(localPath(key)), mime: mimeFromName(key) };
  } catch {
    return null;
  }
}

/** Tamanho e tipo do arquivo guardado (confere se o upload direto do navegador chegou). Null se não existir. */
export async function statFile(rel: string): Promise<{ size: number; mime: string } | null> {
  let key: string;
  try {
    key = cleanKey(rel);
  } catch {
    return null;
  }
  if (isSupabaseMode()) {
    const sb = await supabaseServer();
    const { data, error } = await sb.storage.from(FILES_BUCKET).info(key);
    if (error || !data) return null;
    return { size: Number(data.size) || 0, mime: data.contentType || mimeFromName(key) };
  }
  try {
    const st = fs.statSync(localPath(key));
    return st.isFile() ? { size: st.size, mime: mimeFromName(key) } : null;
  } catch {
    return null;
  }
}

/**
 * Resposta da rota /api/files. Modo Supabase: redireciona (302) para uma URL assinada de 1 hora, e o
 * navegador (vídeo inclusive, com Range) busca direto no Storage; sem URL assinada, baixa e devolve os bytes.
 * Modo local: lê do disco. Só entrega a pasta `uploads/`: config.json e db.json nunca saem por aqui.
 */
export async function fileResponse(rel: string): Promise<Response> {
  let key: string;
  try {
    key = cleanKey(rel);
  } catch {
    return text('Caminho inválido', 400);
  }
  if (!key.startsWith('uploads/')) return text('Não encontrado', 404);

  if (isSupabaseMode()) {
    const bucket = (await supabaseServer()).storage.from(FILES_BUCKET);
    const signed = await bucket.createSignedUrl(key, SIGNED_URL_TTL);
    if (signed.data?.signedUrl) {
      // O redirecionamento pode ficar no cache do navegador por menos tempo que a validade da URL.
      return new Response(null, { status: 302, headers: { location: signed.data.signedUrl, 'cache-control': 'private, max-age=600' } });
    }
    if (isNotFound(signed.error)) return text('Não encontrado', 404);
    // Plano B (falha ao assinar, não "não existe"): baixa o arquivo e devolve os bytes.
    const dl = await bucket.download(key);
    if (dl.error || !dl.data) return text('Não encontrado', 404);
    const buf = Buffer.from(await dl.data.arrayBuffer());
    const mime = dl.data.type || mimeFromName(key);
    return new Response(buf, { headers: { 'content-type': mime, 'content-length': String(buf.length), 'cache-control': 'private, max-age=3600', ...extraHeaders(mime) } });
  }

  let abs: string;
  let size: number;
  try {
    abs = localPath(key);
    const st = fs.statSync(abs);
    if (!st.isFile()) return text('Não encontrado', 404);
    size = st.size;
  } catch {
    return text('Não encontrado', 404);
  }
  const body = Readable.toWeb(fs.createReadStream(abs)) as unknown as ReadableStream;
  const mime = mimeFromName(key);
  return new Response(body, { headers: { 'content-type': mime, 'content-length': String(size), 'cache-control': 'private, max-age=3600', ...extraHeaders(mime) } });
}

/** Remove o arquivo. Best-effort: nunca lança, devolve se removeu. */
export async function deleteFile(rel: string): Promise<boolean> {
  try {
    const key = cleanKey(rel);
    if (isSupabaseMode()) {
      // O Storage devolve a lista do que removeu: vazia quando o objeto não existe (ou a RLS não deixou).
      const { data, error } = await (await supabaseServer()).storage.from(FILES_BUCKET).remove([key]);
      return !error && (data?.length ?? 0) > 0;
    }
    fs.unlinkSync(localPath(key));
    return true;
  } catch {
    return false;
  }
}
