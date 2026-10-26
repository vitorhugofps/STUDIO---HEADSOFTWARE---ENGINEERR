import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { buildBrandbook } from '@/lib/brandbook/build';
import { brandbookPDF } from '@/lib/brandbook/pdf';
import { slugify } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/brandbook/<kitId>
 *   (sem parâmetros)  → HTML navegável (usado no preview e para abrir em nova aba)
 *   ?download=1       → arquivo .html autocontido (fontes e imagens embutidas)
 *   ?format=pdf       → PDF (app de mesa ou Chromium do servidor); sem motor, abre em modo de impressão
 *   ?print=1          → HTML autocontido que chama a impressão do navegador ao carregar
 */
export async function GET(req: Request, { params }: { params: Promise<{ kitId: string }> }) {
  const user = await getSession();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });
  const { kitId } = await params;
  const url = new URL(req.url);
  const download = url.searchParams.get('download') === '1';
  const format = url.searchParams.get('format');
  const print = url.searchParams.get('print') === '1';
  const d = await db();
  const kit = await d.get('brand_kits', kitId);
  if (!kit) return new NextResponse('BrandKit não encontrado', { status: 404 });

  const selfContained = download || format === 'pdf' || print;
  const bundle = await buildBrandbook(d, kit, {
    selfContained,
    render: {
      autoPrint: print,
      actions: selfContained ? {} : { html: `/api/brandbook/${kitId}?download=1`, pdf: `/api/brandbook/${kitId}?format=pdf` },
    },
  });
  const base = `Brandbook ${slugify(bundle.client.company || bundle.client.contact_name) || 'marca'} v${kit.version}`;

  if (format === 'pdf') {
    const pdf = await brandbookPDF(bundle.html);
    if (pdf) {
      return new NextResponse(new Uint8Array(pdf), {
        headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${base}.pdf"`, 'cache-control': 'private, no-store' },
      });
    }
    // Sem motor de PDF no servidor: o navegador imprime (Salvar como PDF).
    return NextResponse.redirect(new URL(`/api/brandbook/${kitId}?print=1`, req.url));
  }

  return new NextResponse(bundle.html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      ...(download ? { 'content-disposition': `attachment; filename="${base}.html"` } : {}),
    },
  });
}
