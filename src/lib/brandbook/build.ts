import 'server-only';
import type { Asset, BrandKit, Client, DB } from '@/lib/db/types';
import { STUDIO_DEFAULTS, readConfig } from '@/lib/config';
import { getFile } from '@/lib/storage';
import { buildBrandbookData, brandbookFonts, chosenDirection, type BrandbookData } from './model';
import { renderBrandbookHTML, type RenderOptions } from './render';
import { embedGoogleFonts } from './fonts';

const MAX_IMAGE = 4 * 1024 * 1024;
const MAX_TOTAL = 18 * 1024 * 1024;

/** Lê um arquivo do armazenamento (Supabase Storage ou pasta de dados). */
const loadFileBuffer = (rel: string) => getFile(rel);

/** `/api/files/uploads/x.png` → `uploads/x.png` (só para arquivos servidos pelo app). */
function relFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/^\/api\/files\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function toDataUri(url: string, budget: { left: number }): Promise<string> {
  const rel = relFromUrl(url);
  if (!rel) return url;
  const f = await loadFileBuffer(rel);
  if (!f || f.data.length > MAX_IMAGE || f.data.length > budget.left) return url;
  budget.left -= f.data.length;
  return `data:${f.mime};base64,${f.data.toString('base64')}`;
}

export type BrandbookBundle = { data: BrandbookData; html: string; client: Client; kit: BrandKit };

/**
 * Monta o brandbook de um kit: dados do cliente, logo, moodboards, fotos e a configuração do Studio.
 * `selfContained` embute fontes e imagens no HTML (para baixar, enviar ao cliente ou gerar PDF).
 */
export async function buildBrandbook(d: DB, kit: BrandKit, opts: { selfContained?: boolean; render?: RenderOptions } = {}): Promise<BrandbookBundle> {
  const client = await d.get('clients', kit.client_id);
  if (!client) throw new Error('Cliente não encontrado.');
  const assets = (await d.list('assets', { where: { client_id: client.id }, orderBy: 'created_at', desc: true, limit: 200 })) as Asset[];
  const isImg = (x: Asset) => (x.mime || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(x.name || '');
  const logoAsset = assets.find((x) => x.kind === 'logo' && isImg(x));
  const fotos = assets.filter((x) => isImg(x) && ['foto', 'imagem', 'imagem_ia', 'referencia'].includes(x.kind) && x.url).slice(0, 6);
  const dir = chosenDirection(kit);
  const moodboards = [dir.moodboard_url, ...((kit.visual as any)?.direcoes || []).map((x: any) => x?.moodboard_url)].filter((u: unknown, i: number, arr: unknown[]) => typeof u === 'string' && u && arr.indexOf(u) === i) as string[];

  const budget = { left: MAX_TOTAL };
  const inline = opts.selfContained ? (u: string) => toDataUri(u, budget) : async (u: string) => u;
  const logoSrc = (logoAsset?.url || client.logo_url) ? await inline(logoAsset?.url || client.logo_url || '') : null;
  const moods = await Promise.all(moodboards.slice(0, 3).map(async (u) => ({ src: await inline(u), alt: `Moodboard ${String(dir.nome || '')}`.trim() })));
  const photos = await Promise.all(fotos.map(async (x) => ({ src: await inline(x.url || ''), alt: x.name || 'Foto' })));

  const cfg = readConfig();
  const studio = { ...STUDIO_DEFAULTS, ...(cfg.studio || {}) };
  const data = buildBrandbookData(client, kit, { logoSrc, moodboards: moods, fotos: photos, studio });
  const fontsCss = opts.selfContained ? await embedGoogleFonts(brandbookFonts(data)) : '';
  const html = renderBrandbookHTML(data, { fontsCss, exampleBanner: data.isExample, ...(opts.render || {}) });
  return { data, html, client, kit };
}
