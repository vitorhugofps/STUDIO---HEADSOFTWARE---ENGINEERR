import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '@/lib/config';

/**
 * Embute as fontes do Google no brandbook (base64) para o arquivo abrir e imprimir igual
 * em qualquer máquina, mesmo sem internet. Resultado em cache por família na pasta de dados.
 * Se a rede falhar, devolve string vazia e o HTML usa o <link> do Google Fonts.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const WEIGHTS = '400;500;600;700';

function cacheFile(family: string) {
  const dir = path.join(dataDir(), 'fonts-cache');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* somente leitura */
  }
  return path.join(dir, family.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.css');
}

async function fetchText(url: string, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchBuffer(url: string, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

const failed = new Map<string, number>(); // famílias que não baixaram recentemente (não tenta de novo por 10 min)

/** CSS @font-face de uma família, com os arquivos woff2 (só o subconjunto latin) embutidos. */
export async function embedGoogleFamily(family: string): Promise<string> {
  const file = cacheFile(family);
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  } catch {
    /* ignore */
  }
  const lastFail = failed.get(family);
  if (lastFail && Date.now() - lastFail < 10 * 60 * 1000) return '';
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${WEIGHTS}&display=swap`;
    const css = await fetchText(cssUrl);
    // Mantém só os blocos "latin" (o Google separa por unicode-range com um comentário antes de cada bloco).
    const blocks = css.split('/*').filter((b) => /^\s*latin\s*\*\//.test(b) || b.includes('@font-face'));
    const faces: string[] = [];
    for (const b of blocks) {
      const isLatin = /^\s*latin\s*\*\//.test(b) || !/\*\//.test(b);
      if (!isLatin) continue;
      const m = b.match(/@font-face\s*{[^}]*}/);
      if (!m) continue;
      let face = m[0];
      const url = face.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
      if (!url) continue;
      const buf = await fetchBuffer(url);
      face = face.replace(/url\([^)]+\)/, `url(data:font/woff2;base64,${buf.toString('base64')})`).replace(/unicode-range:[^;]+;/, '');
      faces.push(face);
    }
    if (!faces.length) return '';
    const out = faces.join('\n');
    try {
      fs.writeFileSync(file, out);
    } catch {
      /* cache opcional */
    }
    return out;
  } catch (e) {
    failed.set(family, Date.now());
    console.warn('[brandbook] fonte não embutida:', family, (e as Error).message);
    return '';
  }
}

export async function embedGoogleFonts(families: string[]): Promise<string> {
  const parts = await Promise.all(Array.from(new Set(families.filter(Boolean))).map(embedGoogleFamily));
  return parts.filter(Boolean).join('\n');
}
