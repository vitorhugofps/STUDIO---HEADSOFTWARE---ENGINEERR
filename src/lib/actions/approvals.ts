'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { isSupabaseMode } from '@/lib/config';
import { localDB } from '@/lib/db/local';
import { supabaseDB, supabaseServer } from '@/lib/db/supabase';
import { ensureSeed } from '@/lib/db/seed';
import { logActivity } from '@/lib/db';
import type { DB } from '@/lib/db/types';

/**
 * Portal de aprovação do cliente: rota pública, sem sessão.
 * Modo local usa o banco local direto; modo Supabase usa o cliente sem sessão (anon).
 * A única credencial é o token do lote (public_token).
 */
async function publicDB(): Promise<DB> {
  if (!isSupabaseMode()) {
    try {
      await ensureSeed(localDB);
    } catch {
      /* segue com o banco como está */
    }
    return localDB;
  }
  return supabaseDB(await supabaseServer());
}

const fail = (error: string) => ({ ok: false as const, error });

export async function decideItemAction(token: string, itemId: string, decision: 'aprovado' | 'ajustar', comment: string) {
  if (!token || !itemId) return fail('Link inválido.');
  if (decision !== 'aprovado' && decision !== 'ajustar') return fail('Decisão inválida.');
  const note = String(comment || '').trim().slice(0, 1000);
  if (decision === 'ajustar' && !note) return fail('Conte o que precisa mudar para o time fazer o ajuste.');

  try {
    const d = await publicDB();
    const [batch] = await d.list('approval_batches', { where: { public_token: token }, limit: 1 });
    if (!batch) return fail('Link não encontrado.');
    if (batch.status === 'expirado' || (batch.expires_at && new Date(batch.expires_at).getTime() < Date.now())) return fail('Este link expirou. Peça um novo ao Studio Impacto.');
    if (batch.status === 'aprovado') return fail('Este lote já foi aprovado por inteiro.');
    if (!batch.item_ids.includes(itemId)) return fail('Esta peça não pertence a este lote.');

    await d.insert('approvals', { batch_id: batch.id, item_id: itemId, decision, comment: note || null, decided_by: null } as any);
    const item = await d.get('content_items', itemId);
    if (item) await d.update('content_items', itemId, { status: decision, version: decision === 'ajustar' ? item.version + 1 : item.version } as any);

    // Fecha o lote quando todas as peças têm decisão.
    const items = batch.item_ids.length ? await d.list('content_items', { where: { id: batch.item_ids } }) : [];
    const decided = items.filter((i) => i.status === 'aprovado' || i.status === 'ajustar');
    const allDecided = items.length > 0 && decided.length === items.length;
    const approved = items.filter((i) => i.status === 'aprovado').length;
    const adjust = items.filter((i) => i.status === 'ajustar').length;
    const nextStatus = allDecided ? (adjust ? 'ajustes' : 'aprovado') : 'aberto';
    if (nextStatus !== batch.status) await d.update('approval_batches', batch.id, { status: nextStatus } as any);

    if (allDecided) {
      try {
        const client = await d.get('clients', batch.client_id);
        if (client?.owner_id) {
          await d.insert('notifications', {
            user_id: client.owner_id,
            kind: 'aprovacao',
            title: `${client.company || client.contact_name} decidiu o lote "${batch.title}": ${approved} aprovadas, ${adjust} para ajustar`,
            link: '/marketing/feed',
          } as any);
        }
        if (!adjust && item?.plan_id) await d.update('content_plans', item.plan_id, { status: 'aprovado' } as any);
      } catch {
        /* notificação é opcional */
      }
    }
    await logActivity(d, {
      actor_name: 'Cliente (portal)',
      action: `${decision === 'aprovado' ? 'aprovou' : 'pediu ajuste em'} a peça "${(item?.hook || '').slice(0, 50)}"${note ? `: ${note.slice(0, 80)}` : ''}`,
      entity: 'approval_batches',
      entity_id: batch.id,
    });
    revalidatePath(`/aprovar/${token}`);
    revalidatePath('/marketing/feed');
    revalidatePath('/aprovacoes');
    return { ok: true as const, batchStatus: nextStatus, approved, adjust, total: items.length };
  } catch {
    return fail('Portal indisponível no momento. Tente novamente em instantes.');
  }
}

/** Versão para <form action> do portal: registra a decisão e volta para a mesma peça. */
export async function decideItemFormAction(fd: FormData): Promise<void> {
  const token = String(fd.get('token') || '');
  const itemId = String(fd.get('item_id') || '');
  const decision = String(fd.get('decision')) === 'aprovado' ? 'aprovado' : 'ajustar';
  const r = await decideItemAction(token, itemId, decision, String(fd.get('comment') || ''));
  if (!r.ok) redirect(`/aprovar/${encodeURIComponent(token)}?item=${encodeURIComponent(itemId)}&erro=${encodeURIComponent(r.error)}#peca-${itemId}`);
  redirect(`/aprovar/${encodeURIComponent(token)}?feito=${encodeURIComponent(itemId)}#peca-${itemId}`);
}
