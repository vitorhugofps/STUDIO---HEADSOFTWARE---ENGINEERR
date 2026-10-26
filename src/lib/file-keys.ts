import { slugify, uid } from '@/lib/utils';

/**
 * Nomes e chaves de arquivos enviados. Sem dependência de servidor: o navegador usa as mesmas
 * funções do servidor para montar a chave do upload direto ao Supabase Storage, e o servidor
 * confere a chave recebida com `isUploadKey` antes de registrar o asset.
 */

/** Bucket privado do Supabase Storage com os arquivos do time. */
export const FILES_BUCKET = 'files';

/** Pasta do arquivo: id do cliente (só letras, números, _ e -) ou "studio". */
export function uploadFolder(clientId?: string | null) {
  const v = String(clientId ?? '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : 'studio';
}

/** `<tempo em base36>-<slug>.<ext>`: nome único e seguro para chave de Storage e para disco. */
export function uploadName(fileName: string) {
  const ext = /\.[A-Za-z0-9]{1,10}$/.exec(fileName)?.[0].toLowerCase() ?? '';
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  return `${Date.now().toString(36)}-${slugify(base).slice(0, 60) || uid().slice(0, 8)}${ext}`;
}

/** Chave completa: `uploads/<cliente|studio>/<nome>`. */
export function uploadKey(clientId: string | null | undefined, fileName: string) {
  return `uploads/${uploadFolder(clientId)}/${uploadName(fileName)}`;
}

/** Confere uma chave vinda do navegador (upload direto): `uploads/<pasta>/<arquivo>`, sem sair da pasta. */
export function isUploadKey(key: unknown): key is string {
  return typeof key === 'string' && !key.includes('..') && /^uploads\/[A-Za-z0-9_-]{1,64}\/[a-z0-9][a-z0-9._-]{0,150}$/.test(key);
}
