'use server';

/**
 * Ações de Settings (somente admin e developer) e da página User (qualquer usuário logado).
 * Segredos ficam no config.json do servidor e nunca voltam para o navegador.
 * Este arquivo é 'use server': só funções async podem ser exportadas.
 */

import { revalidatePath } from 'next/cache';
import { db, logActivity } from '@/lib/db';
import { changePassword, getSession } from '@/lib/auth';
import { getSecret, readConfig, writeConfig, type AppConfig } from '@/lib/config';
import type { DB, Service } from '@/lib/db/types';

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Quem pode mexer em Settings: admin e developer. */
async function settingsUser() {
  const user = await getSession();
  if (!user || !['admin', 'developer'].includes(user.role)) return null;
  return user;
}

/** writeConfig engole erro de disco (ambiente somente leitura). Relemos para saber se gravou. */
function wasPersisted(next: AppConfig) {
  return readConfig().updatedAt === next.updatedAt;
}
const READ_ONLY = 'Não foi possível gravar neste ambiente (somente leitura). Use variáveis de ambiente.';

/* ------------------------------------------------------------------ */
/* Studio                                                              */
/* ------------------------------------------------------------------ */

export async function saveStudioAction(fd: FormData) {
  const user = await settingsUser();
  if (!user) return fail('Sem permissão.');
  const studio: NonNullable<AppConfig['studio']> = {};
  for (const k of ['name', 'cnpj', 'whatsapp', 'instagram', 'site', 'city', 'email'] as const) {
    studio[k] = clip(String(fd.get(k) || '').trim(), 200);
  }
  if (!studio.name) return fail('Informe o nome do Studio.');
  if (studio.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studio.email)) return fail('E-mail inválido.');

  const next = writeConfig({ studio });
  if (!wasPersisted(next)) return fail(READ_ONLY);
  const d = await db();
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: 'atualizou os dados do Studio', entity: 'settings' });
  revalidatePath('/settings');
  return { ok: true as const };
}

/* ------------------------------------------------------------------ */
/* Integrações                                                         */
/* ------------------------------------------------------------------ */

const SECRETS = [
  { key: 'anthropicApiKey', provider: 'anthropic', label: 'Chave da Anthropic' },
  { key: 'metaAccessToken', provider: 'meta', label: 'Token da Meta' },
  { key: 'resendApiKey', provider: 'resend', label: 'Chave do Resend' },
  { key: 'apifyToken', provider: 'apify', label: 'Token do Apify' },
] as const;

async function syncIntegration(d: DB, provider: string, connected: boolean) {
  const rows = await d.list('integrations', { where: { provider, scope: 'studio' } });
  const patch = { status: connected ? ('conectado' as const) : ('pendente' as const), connected_at: connected ? new Date().toISOString() : null };
  if (rows[0]) await d.update('integrations', rows[0].id, patch);
  else await d.insert('integrations', { provider, scope: 'studio', ...patch });
}

/**
 * Salva só o que veio preenchido: campo secreto em branco mantém o valor atual.
 * Para apagar, o formulário envia clear_<campo>. Nunca devolve valor de segredo.
 */
export async function saveSecretsAction(fd: FormData) {
  const user = await settingsUser();
  if (!user) return fail('Sem permissão.');

  const patch: Partial<AppConfig> = {};
  const touched: string[] = [];
  for (const s of SECRETS) {
    if (fd.get(`clear_${s.key}`)) {
      patch[s.key] = '';
      touched.push(s.provider);
      continue;
    }
    const v = String(fd.get(s.key) || '').trim();
    if (!v) continue;
    if (/\s/.test(v)) return fail(`${s.label}: o valor não pode ter espaços.`);
    if (v.length > 600) return fail(`${s.label}: valor longo demais.`);
    patch[s.key] = v;
    touched.push(s.provider);
  }
  if (fd.has('metaAppId')) {
    patch.metaAppId = clip(String(fd.get('metaAppId') || '').trim(), 80);
    if (!touched.includes('meta')) touched.push('meta');
  }
  if (fd.has('reportFromEmail')) {
    const email = clip(String(fd.get('reportFromEmail') || '').trim(), 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('E-mail remetente inválido.');
    patch.reportFromEmail = email;
    if (!touched.includes('resend')) touched.push('resend');
  }
  if (!Object.keys(patch).length) return fail('Nada para salvar.');

  const next = writeConfig(patch);
  if (!wasPersisted(next)) return fail(READ_ONLY);

  const d = await db();
  for (const s of SECRETS) {
    if (touched.includes(s.provider)) await syncIntegration(d, s.provider, Boolean(getSecret(s.key)));
  }
  // Só os nomes dos campos vão para o histórico, nunca os valores.
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `atualizou integrações (${touched.join(', ')})`, entity: 'settings' });
  revalidatePath('/settings');
  return { ok: true as const };
}

/* ------------------------------------------------------------------ */
/* IA                                                                  */
/* ------------------------------------------------------------------ */

const STRATEGY_MODELS = ['claude-opus-5-5', 'claude-fable-5-1'];
const COPY_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'];
const EFFORTS = ['max', 'high', 'medium'];

export async function saveModelsAction(fd: FormData) {
  const user = await settingsUser();
  if (!user) return fail('Sem permissão.');
  const strategy = String(fd.get('anthropicModelStrategy') || '');
  const copy = String(fd.get('anthropicModelCopy') || '');
  if (!STRATEGY_MODELS.includes(strategy)) return fail('Modelo de estratégia inválido.');
  if (!COPY_MODELS.includes(copy)) return fail('Modelo de copy inválido.');
  const effort = String(fd.get('anthropicEffort') || 'high');
  if (!EFFORTS.includes(effort)) return fail('Esforço inválido.');
  const next = writeConfig({ anthropicModelStrategy: strategy, anthropicModelCopy: copy, anthropicEffort: effort });
  if (!wasPersisted(next)) return fail(READ_ONLY);
  const d = await db();
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `trocou os modelos de IA (estratégia ${strategy} · esforço ${effort}, copy ${copy})`, entity: 'settings' });
  revalidatePath('/settings');
  return { ok: true as const };
}

/* ------------------------------------------------------------------ */
/* Catálogo de serviços                                                */
/* ------------------------------------------------------------------ */

const SERVICE_KINDS: Service['kind'][] = ['projeto', 'mensal', 'avulso'];

function parsePrice(raw: string) {
  const s = raw.replace(/[^\d.,-]/g, '');
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Com `id` atualiza o serviço; sem `id` cria um novo. */
export async function saveServiceAction(fd: FormData) {
  const user = await settingsUser();
  if (!user) return fail('Sem permissão.');
  const id = String(fd.get('id') || '');
  const name = clip(String(fd.get('name') || '').trim(), 120);
  const front = clip(String(fd.get('front') || '').trim(), 60);
  if (!name) return fail('Dê um nome ao serviço.');
  if (!front) return fail('Informe a frente (Marca, Sites, Conteúdo…).');
  const kind = String(fd.get('kind') || 'projeto');
  if (!SERVICE_KINDS.includes(kind as Service['kind'])) return fail('Tipo inválido.');
  const price = parsePrice(String(fd.get('base_price') || '0'));
  if (!Number.isFinite(price) || price < 0) return fail('Preço inválido.');
  const recurring = ['on', 'true', '1'].includes(String(fd.get('recurring') || ''));

  const d = await db();
  const row: Partial<Service> = { name, front, kind: kind as Service['kind'], base_price: price, recurring };
  if (fd.has('description')) row.description = clip(String(fd.get('description') || '').trim(), 300) || null;

  if (id) {
    if (!(await d.get('services_catalog', id))) return fail('Serviço não encontrado.');
    await d.update('services_catalog', id, row);
  } else {
    await d.insert('services_catalog', row);
  }
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `${id ? 'editou' : 'criou'} o serviço "${name}" no catálogo`, entity: 'services_catalog', entity_id: id || undefined });
  revalidatePath('/settings');
  revalidatePath('/vendas');
  return { ok: true as const };
}

export async function deleteServiceAction(id: string) {
  const user = await settingsUser();
  if (!user) return fail('Sem permissão.');
  const d = await db();
  const s = await d.get('services_catalog', id);
  if (!s) return fail('Serviço não encontrado.');
  await d.remove('services_catalog', id);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `removeu o serviço "${s.name}" do catálogo`, entity: 'services_catalog', entity_id: id });
  revalidatePath('/settings');
  revalidatePath('/vendas');
  return { ok: true as const };
}

/* ------------------------------------------------------------------ */
/* Página User: perfil, preferências e senha                           */
/* ------------------------------------------------------------------ */

const PROFILE_STATUS = ['disponivel', 'em_set', 'ocupado', 'ausente'];

export async function updateProfileAction(fd: FormData) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const status = String(fd.get('status') || '');
  if (!PROFILE_STATUS.includes(status)) return fail('Status inválido.');
  const d = await db();
  await d.update('profiles', user.id, { status });
  revalidatePath('/user');
  revalidatePath('/team');
  return { ok: true as const };
}

/** Liga ou desliga tipos de notificação. Guardado em profiles.preferences.notify. */
export async function updatePreferencesAction(patch: Record<string, boolean>) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const me = await d.get('profiles', user.id);
  if (!me) return fail('Perfil não encontrado.');
  const prefs = (me.preferences || {}) as Record<string, unknown>;
  const notify = { ...(prefs.notify && typeof prefs.notify === 'object' ? (prefs.notify as Record<string, boolean>) : {}) };
  for (const [k, v] of Object.entries(patch)) if (/^[a-z_]{1,30}$/.test(k)) notify[k] = Boolean(v);
  await d.update('profiles', user.id, { preferences: { ...prefs, notify } });
  revalidatePath('/user');
  return { ok: true as const };
}

export async function changePasswordAction(fd: FormData) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const atual = String(fd.get('atual') || '');
  const nova = String(fd.get('nova') || '');
  const confirmar = String(fd.get('confirmar') || '');
  if (!atual || !nova) return fail('Preencha a senha atual e a nova.');
  if (nova !== confirmar) return fail('A confirmação não confere com a nova senha.');
  if (nova === atual) return fail('A nova senha precisa ser diferente da atual.');
  const r = await changePassword(user.id, atual, nova);
  if (!r.ok) return fail(r.error);
  const d = await db();
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: 'trocou a própria senha', entity: 'profiles', entity_id: user.id });
  return { ok: true as const };
}
