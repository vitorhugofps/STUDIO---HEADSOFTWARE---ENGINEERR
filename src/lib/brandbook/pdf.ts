import 'server-only';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * PDF do brandbook. Três caminhos, nesta ordem:
 * 1. Serviço de PDF do app de mesa (Electron abre o HTML numa janela escondida e imprime; IHS_PDF_SERVICE).
 * 2. Playwright/Chromium, quando instalado no ambiente (desenvolvimento e QA; IHS_PLAYWRIGHT_PATH opcional).
 * 3. Nenhum: o chamador abre o HTML em modo de impressão e o navegador salva o PDF.
 */

const PAGE = { width: 1600, height: 1000 };

async function viaElectron(html: string): Promise<Buffer | null> {
  const base = process.env.IHS_PDF_SERVICE;
  if (!base) return null;
  const tmp = path.join(os.tmpdir(), `impacto-brandbook-${Date.now().toString(36)}.html`);
  fs.writeFileSync(tmp, html);
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: tmp, width: PAGE.width, height: PAGE.height }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) throw new Error(`serviço de PDF respondeu ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

async function viaPlaywright(html: string): Promise<Buffer | null> {
  const spec = process.env.IHS_PLAYWRIGHT_PATH || 'playwright';
  let pw: any;
  try {
    const dyn = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    pw = await dyn(spec);
  } catch {
    return null;
  }
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: PAGE });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => (document as any).fonts?.ready);
    await page.waitForTimeout(300);
    const buf: Buffer = await page.pdf({ printBackground: true, preferCSSPageSize: true, width: `${PAGE.width}px`, height: `${PAGE.height}px`, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}

export async function brandbookPDF(html: string): Promise<Buffer | null> {
  try {
    const a = await viaElectron(html);
    if (a) return a;
  } catch (e) {
    console.warn('[brandbook] PDF pelo app falhou:', (e as Error).message);
  }
  try {
    return await viaPlaywright(html);
  } catch (e) {
    console.warn('[brandbook] PDF pelo Playwright falhou:', (e as Error).message);
    return null;
  }
}
