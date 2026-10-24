'use server';

import { revalidatePath } from 'next/cache';
import { db, logActivity } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateJSON } from '@/lib/ai/claude';
import { PROMPTS, EXAMPLES, clientBrief } from '@/lib/ai/prompts';
import { STUDIO_SYSTEM } from '@/lib/ai/prompts';
import { maturityIndex, painMapFromAnswers } from '@/lib/questionnaire';
import type { Client, Diagnosis } from '@/lib/db/types';
import { token } from '@/lib/utils';

export type NewClientPayload = {
  contact_name: string;
  company?: string;
  segment?: string;
  city?: string;
  state?: string;
  who_is?: string;
  brand_color?: string;
  owner_id?: string | null;
  context: Record<string, string>;
  answers: Record<string, unknown>;
  website?: string;
  whatsapp?: string;
  email?: string;
  report_emails?: string[];
  socials?: { rede: string; url: string }[];
  meta_ad_account_id?: string;
  asset_ids?: string[];
};

export async function createClientAction(payload: NewClientPayload) {
  const user = await getSession();
  if (!user) return { ok: false as const, error: 'Não autorizado' };
  if (!payload.contact_name?.trim()) return { ok: false as const, error: 'Informe o nome do cliente.' };
  const d = await db();

  const pain = payloadHasAnswers(payload.answers) ? painMapFromAnswers(payload.answers) : null;
  const client = await d.insert('clients', {
    contact_name: payload.contact_name.trim(),
    company: payload.company?.trim() || null,
    segment: payload.segment || null,
    city: payload.city || null,
    state: payload.state || null,
    who_is: payload.who_is || null,
    brand_color: payload.brand_color || '#FF5B1F',
    owner_id: payload.owner_id || user.id,
    status: pain ? 'diagnostico' : 'lead',
    health: 'amarelo',
    website: payload.website || null,
    whatsapp: payload.whatsapp || null,
    email: payload.email || null,
    report_emails: payload.report_emails || [],
    socials: payload.socials || [],
    meta_ad_account_id: payload.meta_ad_account_id || null,
    maturity_index: pain ? maturityIndex(pain) : null,
  } as Partial<Client>);

  if (Object.values(payload.context || {}).some(Boolean)) {
    await d.insert('client_contexts', { client_id: client.id, version: 1, blocks: payload.context, created_by: user.id } as any);
  }
  if (payloadHasAnswers(payload.answers)) {
    await d.insert('questionnaire_responses', { client_id: client.id, answers: payload.answers, answered_by: user.name, public_token: token(16), completed_at: new Date().toISOString() } as any);
  }
  for (const id of payload.asset_ids || []) {
    try {
      await d.update('assets', id, { client_id: client.id } as any);
    } catch {}
  }
  await d.insert('deals', { client_id: client.id, title: `${client.company || client.contact_name} · novo projeto`, stage: pain ? 'diagnostico' : 'lead', value: null, probability: pain ? 35 : 15, source: 'cadastro', owner_id: user.id, next_action_at: new Date(Date.now() + 2 * 864e5).toISOString() } as any);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `cadastrou o cliente ${client.company || client.contact_name}`, entity: 'clients', entity_id: client.id });

  let diagnosisId: string | null = null;
  if (payloadHasAnswers(payload.answers)) {
    const diag = await runDiagnosis(client.id);
    diagnosisId = diag?.id || null;
  }
  revalidatePath('/clientes');
  revalidatePath('/');
  return { ok: true as const, id: client.id, diagnosisId };
}

function payloadHasAnswers(a?: Record<string, unknown>) {
  return !!a && Object.values(a).some((v) => (Array.isArray(v) ? v.length : v !== '' && v != null));
}

export async function runDiagnosis(clientId: string): Promise<Diagnosis | null> {
  const user = await getSession();
  if (!user) return null;
  const d = await db();
  const client = await d.get('clients', clientId);
  if (!client) return null;
  const [ctx] = await d.list('client_contexts', { where: { client_id: clientId }, orderBy: 'version', desc: true, limit: 1 });
  const [resp] = await d.list('questionnaire_responses', { where: { client_id: clientId }, orderBy: 'created_at', desc: true, limit: 1 });
  const answers = (resp?.answers || {}) as Record<string, unknown>;
  const basePain = Object.keys(answers).length ? painMapFromAnswers(answers) : null;

  const example = EXAMPLES.diagnosis(client);
  if (basePain) example.pain_map = basePain;

  const r = await generateJSON<typeof example>({
    agent: 'Comercial · Diagnóstico',
    tier: 'strategy',
    system: STUDIO_SYSTEM,
    user: PROMPTS.diagnosis(clientBrief(client, ctx, answers)),
    example,
    db: d,
    clientId,
    maxTokens: 3000,
  });
  const data = r.data;
  const pain = { ...(basePain || {}), ...(data.pain_map || {}) } as Record<string, number>;
  const diag = await d.insert('diagnoses', {
    client_id: clientId,
    summary: data.summary,
    pain_map: pain,
    findings: data.findings || [],
    recommended_services: data.recommended_services || [],
    recommended_plan: data.recommended_plan || null,
    pending_items: data.pending_items || [],
    is_example: r.isExample,
  } as any);
  await d.update('clients', clientId, { maturity_index: maturityIndex(pain), status: client.status === 'lead' ? 'diagnostico' : client.status } as any);
  await logActivity(d, { actor_id: user.id, actor_name: 'Agente Comercial', action: `gerou o diagnóstico de ${client.company || client.contact_name}${r.isExample ? ' (exemplo)' : ''}`, entity: 'diagnoses', entity_id: diag.id });
  revalidatePath(`/clientes/${clientId}`);
  return diag;
}

export async function runDiagnosisAction(clientId: string) {
  const r = await runDiagnosis(clientId);
  return r ? { ok: true as const, id: r.id } : { ok: false as const, error: 'Não foi possível gerar o diagnóstico.' };
}

export async function saveContextAction(clientId: string, fd: FormData) {
  const user = await getSession();
  if (!user) return { ok: false, error: 'Não autorizado' };
  const d = await db();
  const [last] = await d.list('client_contexts', { where: { client_id: clientId }, orderBy: 'version', desc: true, limit: 1 });
  const keys = ['quem_e', 'oferece', 'id_visual', 'linguagem', 'dores', 'notas'];
  const blocks = Object.fromEntries(keys.map((k) => [k, String(fd.get(k) || '')]));
  await d.insert('client_contexts', { client_id: clientId, version: (last?.version || 0) + 1, blocks, created_by: user.id } as any);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: 'atualizou o contexto do cliente', entity: 'clients', entity_id: clientId });
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}

export async function updateClientAction(clientId: string, fd: FormData) {
  const user = await getSession();
  if (!user) return { ok: false, error: 'Não autorizado' };
  const d = await db();
  const patch: Record<string, unknown> = {};
  for (const k of ['contact_name', 'company', 'segment', 'city', 'state', 'who_is', 'website', 'whatsapp', 'email', 'status', 'health', 'brand_color', 'meta_ad_account_id']) {
    if (fd.has(k)) patch[k] = String(fd.get(k) || '') || null;
  }
  if (fd.has('report_emails')) patch.report_emails = String(fd.get('report_emails') || '').split(/[,;\s]+/).filter(Boolean);
  if (fd.has('instagram')) {
    const url = String(fd.get('instagram') || '');
    patch.socials = url ? [{ rede: 'instagram', url }] : [];
  }
  await d.update('clients', clientId, patch as any);
  revalidatePath(`/clientes/${clientId}`);
  revalidatePath('/clientes');
  return { ok: true };
}

export async function createProjectAction(fd: FormData) {
  const user = await getSession();
  if (!user) return { ok: false, error: 'Não autorizado' };
  const d = await db();
  const client_id = String(fd.get('client_id') || '');
  const title = String(fd.get('title') || '').trim();
  if (!client_id || !title) return { ok: false, error: 'Cliente e título são obrigatórios.' };
  const p = await d.insert('projects', {
    client_id,
    title,
    kind: (String(fd.get('kind') || 'outro') as any),
    method_stage: 'ponto',
    status: 'ativo',
    progress: 0,
    starts_on: String(fd.get('starts_on') || '') || null,
    due_on: String(fd.get('due_on') || '') || null,
    owner_id: String(fd.get('owner_id') || user.id),
    brief: { descricao: String(fd.get('brief') || '') },
  } as any);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `abriu o projeto ${title}`, entity: 'projects', entity_id: p.id });
  revalidatePath(`/clientes/${client_id}`);
  revalidatePath('/projects');
  return { ok: true, id: p.id };
}
