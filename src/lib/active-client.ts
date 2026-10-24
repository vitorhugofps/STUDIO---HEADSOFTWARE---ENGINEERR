import 'server-only';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import type { BrandKit, Client, ClientContext, Diagnosis } from '@/lib/db/types';

/** Cliente ativo escolhido no topo (cookie ihs_client). Marketing, Tráfego e Sites trabalham nele. */
export async function getActiveClient(): Promise<{ client: Client; context: ClientContext | null; diagnosis: Diagnosis | null; brandKit: BrandKit | null } | null> {
  const store = await cookies();
  const id = store.get('ihs_client')?.value;
  const d = await db();
  let client = id ? await d.get('clients', id) : null;
  if (!client) {
    const [first] = await d.list('clients', { where: { status: 'ativo' }, orderBy: 'company', limit: 1 });
    client = first || null;
  }
  if (!client) return null;
  const [ctx] = await d.list('client_contexts', { where: { client_id: client.id }, orderBy: 'version', desc: true, limit: 1 });
  const [diag] = await d.list('diagnoses', { where: { client_id: client.id }, orderBy: 'created_at', desc: true, limit: 1 });
  const [kit] = await d.list('brand_kits', { where: { client_id: client.id }, orderBy: 'version', desc: true, limit: 1 });
  return { client, context: ctx || null, diagnosis: diag || null, brandKit: kit || null };
}
