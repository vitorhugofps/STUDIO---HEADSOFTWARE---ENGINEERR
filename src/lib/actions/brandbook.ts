'use server';

import { revalidatePath } from 'next/cache';
import { db, logActivity } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateJSON } from '@/lib/ai/claude';
import { PROMPTS, STUDIO_SYSTEM, clientBrief } from '@/lib/ai/prompts';
import { slugify } from '@/lib/utils';
import { putFile } from '@/lib/storage';
import { buildBrandbook } from '@/lib/brandbook/build';
import type { BrandKit } from '@/lib/db/types';

const fail = (error: string) => ({ ok: false as const, error });
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

function kitSummary(kit: BrandKit) {
  const apps = obj(kit.applications);
  const payload = {
    modo: kit.mode,
    diagnostico: kit.diagnosis,
    estrategia: kit.strategy,
    verbal: kit.verbal,
    visual: { ...obj(kit.visual), direcoes: (obj(kit.visual).direcoes || []).map((x: any) => ({ ...obj(x), moodboard_url: undefined })) },
    tokens: kit.tokens,
    aplicacoes: { aplicacoes: apps.aplicacoes, regras_uso: apps.regras_uso, manual: { capitulos: obj(apps.manual).capitulos } },
  };
  return JSON.stringify(payload).slice(0, 14000);
}

/**
 * Gera o brandbook completo: a IA escreve o conteúdo editorial que o kit não tem (manifesto, valores,
 * significados do símbolo, nomes das cores, regras de grafismo, tom por canal...), o renderizador monta
 * o HTML no padrão do manual do Studio e o arquivo vai para a Biblioteca do cliente.
 */
export async function generateBrandbookAction(kitId: string, opts: { skipAI?: boolean } = {}) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const kit = await d.get('brand_kits', kitId);
  if (!kit) return fail('BrandKit não encontrado.');
  const client = await d.get('clients', kit.client_id);
  if (!client) return fail('Cliente não encontrado.');
  const [ctx] = await d.list('client_contexts', { where: { client_id: client.id }, orderBy: 'version', desc: true, limit: 1 });
  const name = client.company || client.contact_name;

  let isExample = false;
  if (!opts.skipAI) {
    const r = await generateJSON<Record<string, any>>({
      agent: 'Brand · Brandbook',
      tier: 'strategy',
      system: STUDIO_SYSTEM,
      user: PROMPTS.brandbook(clientBrief(client, ctx || null, null, null), kitSummary(kit)),
      example: { _example: true },
      db: d,
      clientId: client.id,
      maxTokens: 9000,
    });
    isExample = r.isExample;
    const brandbook = r.isExample ? { _example: true } : { ...obj(r.data), _example: undefined, generated_at: new Date().toISOString(), model: r.model };
    const apps = obj(kit.applications);
    await d.update('brand_kits', kitId, { applications: { ...apps, manual: { ...obj(apps.manual), brandbook } } } as any);
  }

  const fresh = (await d.get('brand_kits', kitId)) || kit;
  const bundle = await buildBrandbook(d, fresh, { selfContained: true });
  const slug = slugify(name).slice(0, 40) || 'marca';
  // Mesmo lugar dos uploads (Supabase Storage no time e na Vercel; pasta de dados no modo local).
  const rel = `uploads/${client.id}/brandbook-${slug}-v${fresh.version}.html`;
  const stored = await putFile(rel, Buffer.from(bundle.html, 'utf8'), 'text/html; charset=utf-8');

  // Substitui o brandbook anterior da mesma versão na Biblioteca
  const previous = await d.list('assets', { where: { client_id: client.id, kind: 'brandbook' } });
  for (const p of previous) if (p.path === rel) await d.remove('assets', p.id);
  const asset = await d.insert('assets', {
    client_id: client.id,
    kind: 'brandbook',
    name: `Brandbook ${name} v${fresh.version}.html`,
    path: stored.path,
    url: stored.url,
    mime: 'text/html',
    size_bytes: Buffer.byteLength(bundle.html, 'utf8'),
    source: 'brandbook',
    created_by: user.id,
    tags: ['Brandbook', `v${fresh.version}`],
    analysis: { kit_id: kitId, version: fresh.version, example: isExample || bundle.data.isExample },
  } as any);
  await logActivity(d, { actor_id: user.id, actor_name: 'Agente de Marca', action: `gerou o brandbook v${fresh.version} de ${name}${isExample ? ' (exemplo)' : ''}`, entity: 'brand_kits', entity_id: kitId });
  revalidatePath('/marketing/brand');
  revalidatePath('/biblioteca');
  revalidatePath(`/clientes/${client.id}`);
  return { ok: true as const, assetId: asset.id, url: stored.url, isExample: isExample || bundle.data.isExample };
}
