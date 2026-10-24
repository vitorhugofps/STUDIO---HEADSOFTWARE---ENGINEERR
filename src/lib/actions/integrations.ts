'use server';

/**
 * Integrações por token: teste de conexão de cada provedor, geração de imagem (ChatGPT)
 * e coleta pelo Apify. Nenhum segredo volta para o navegador: só o resultado do teste.
 */

import fs from 'node:fs';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { db, logActivity } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { dataDir, getSecret, readConfig, writeConfig } from '@/lib/config';
import { anthropicTest, estimateCost } from '@/lib/ai/claude';
import { hasOpenAIKey, openaiImage, openaiTest } from '@/lib/ai/openai';
import { slugify, uid } from '@/lib/utils';

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

export type Provider = 'anthropic' | 'openai' | 'meta' | 'resend' | 'apify' | 'supabase';

async function fetchJSON(url: string, init?: RequestInit, timeoutMs = 30_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const json = (await res.json().catch(() => ({}))) as any;
    return { status: res.status, ok: res.ok, json };
  } finally {
    clearTimeout(t);
  }
}

/** Testa a conexão real de um provedor com o token salvo. */
export async function testIntegrationAction(provider: Provider): Promise<{ ok: boolean; detail: string }> {
  const user = await getSession();
  if (!user || !['admin', 'developer'].includes(user.role)) return { ok: false, detail: 'Sem permissão.' };
  const t0 = Date.now();
  let result: { ok: boolean; detail: string };
  try {
    switch (provider) {
      case 'anthropic': {
        if (!getSecret('anthropicApiKey')) throw new Error('Chave da Anthropic não configurada.');
        result = await anthropicTest();
        break;
      }
      case 'openai': {
        if (!hasOpenAIKey()) throw new Error('Chave da OpenAI não configurada.');
        result = await openaiTest();
        break;
      }
      case 'meta': {
        const token = getSecret('metaAccessToken');
        if (!token) throw new Error('Token da Meta não configurado.');
        const me = await fetchJSON(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
        if (!me.ok) throw new Error(me.json?.error?.message || `Meta ${me.status}`);
        const accs = await fetchJSON(`https://graph.facebook.com/v21.0/me/adaccounts?fields=name,account_status,currency&limit=10&access_token=${encodeURIComponent(token)}`);
        const list: any[] = accs.ok ? accs.json?.data || [] : [];
        result = {
          ok: true,
          detail: `Token válido para ${me.json.name} (${me.json.id}). ${list.length ? `Contas de anúncio acessíveis: ${list.map((a) => `${a.name} [${a.account_status === 1 ? 'ativa' : 'status ' + a.account_status}]`).join(', ')}.` : 'Nenhuma conta de anúncio acessível com este token (peça acesso de parceiro no Business Manager do cliente).'}`,
        };
        break;
      }
      case 'resend': {
        const key = getSecret('resendApiKey');
        if (!key) throw new Error('Chave do Resend não configurada.');
        const r = await fetchJSON('https://api.resend.com/domains', { headers: { authorization: `Bearer ${key}` } });
        if (!r.ok) throw new Error(r.json?.message || `Resend ${r.status}`);
        const domains: any[] = r.json?.data || [];
        const from = readConfig().reportFromEmail || 'relatorios@studioimpacto.com.br';
        const fromDomain = from.split('@')[1];
        const verified = domains.filter((d) => d.status === 'verified').map((d) => d.name);
        result = {
          ok: verified.includes(fromDomain),
          detail: `${domains.length} domínio(s) na conta${verified.length ? `, verificados: ${verified.join(', ')}` : ', nenhum verificado'}. Remetente configurado: ${from}${verified.includes(fromDomain) ? ' (pronto para enviar)' : ' (o domínio do remetente precisa estar verificado no Resend)'}.`,
        };
        break;
      }
      case 'apify': {
        const token = getSecret('apifyToken');
        if (!token) throw new Error('Token do Apify não configurado.');
        const r = await fetchJSON(`https://api.apify.com/v2/users/me?token=${encodeURIComponent(token)}`);
        if (!r.ok) throw new Error(r.json?.error?.message || `Apify ${r.status}`);
        const u = r.json?.data || {};
        result = { ok: true, detail: `Conta ${u.username || u.id} (plano ${u.plan?.id || u.plan?.tier || 'n/d'}). Pronta para coletar Instagram e Google Maps.` };
        break;
      }
      case 'supabase': {
        const d = await db();
        const rows = await d.list('services_catalog', { limit: 1 });
        result = { ok: true, detail: `Banco ${d.mode === 'supabase' ? 'Supabase' : 'local'} respondeu (${rows.length ? 'catálogo carregado' : 'catálogo vazio'}).` };
        break;
      }
      default:
        throw new Error('Provedor desconhecido.');
    }
  } catch (e) {
    result = { ok: false, detail: (e as Error).message };
  }
  const ms = Date.now() - t0;
  try {
    const d = await db();
    const rows = await d.list('integrations', { where: { provider, scope: 'studio' } });
    const patch = { status: result.ok ? ('conectado' as const) : ('erro' as const), connected_at: result.ok ? new Date().toISOString() : null, config: { ...((rows[0]?.config as Record<string, unknown>) || {}), lastTest: { ok: result.ok, detail: result.detail, at: new Date().toISOString(), ms } } };
    if (rows[0]) await d.update('integrations', rows[0].id, patch as any);
    else await d.insert('integrations', { provider, scope: 'studio', ...patch } as any);
    await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `testou a integração ${provider}: ${result.ok ? 'ok' : 'falhou'}`, entity: 'integrations' });
  } catch {
    /* ignore */
  }
  revalidatePath('/settings');
  return { ...result, detail: `${result.detail} (${ms} ms)` };
}

/** Salva chave e modelos da OpenAI e a política de reserva. */
export async function saveOpenAIAction(fd: FormData) {
  const user = await getSession();
  if (!user || !['admin', 'developer'].includes(user.role)) return fail('Sem permissão.');
  const patch: Record<string, unknown> = {};
  const key = String(fd.get('openaiApiKey') || '').trim();
  if (fd.get('clear_openaiApiKey')) patch.openaiApiKey = '';
  else if (key) {
    if (/\s/.test(key) || key.length > 400) return fail('Chave da OpenAI inválida.');
    patch.openaiApiKey = key;
  }
  const text = String(fd.get('openaiTextModel') || '').trim();
  const image = String(fd.get('openaiImageModel') || '').trim();
  if (text && !/^[a-z0-9.\-_]{3,60}$/i.test(text)) return fail('Nome do modelo de texto inválido.');
  if (image && !/^[a-z0-9.\-_]{3,60}$/i.test(image)) return fail('Nome do modelo de imagem inválido.');
  if (fd.has('openaiTextModel')) patch.openaiTextModel = text;
  if (fd.has('openaiImageModel')) patch.openaiImageModel = image;
  patch.aiFallbackToOpenAI = ['on', 'true', '1'].includes(String(fd.get('aiFallbackToOpenAI') || ''));
  writeConfig(patch as any);
  const d = await db();
  const rows = await d.list('integrations', { where: { provider: 'openai', scope: 'studio' } });
  const connected = Boolean(getSecret('openaiApiKey'));
  const p = { status: connected ? ('conectado' as const) : ('pendente' as const), connected_at: connected ? new Date().toISOString() : null };
  if (rows[0]) await d.update('integrations', rows[0].id, p as any);
  else await d.insert('integrations', { provider: 'openai', scope: 'studio', ...p } as any);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: 'atualizou a integração OpenAI (ChatGPT)', entity: 'settings' });
  revalidatePath('/settings');
  return { ok: true as const };
}

/** Gera uma imagem com o ChatGPT e salva na Biblioteca (asset do cliente ou do Studio). */
export async function generateImageAction(input: { prompt: string; clientId?: string | null; kind?: string; size?: '1024x1024' | '1024x1536' | '1536x1024'; name?: string }) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const prompt = (input.prompt || '').trim();
  if (prompt.length < 8) return fail('Descreva a imagem com mais detalhes.');
  if (!hasOpenAIKey()) return fail('Geração de imagem usa o ChatGPT: cole a chave da OpenAI em Settings → Integrações.');
  if (process.env.VERCEL) return fail('Geração de imagem indisponível neste ambiente.');
  const d = await db();
  const t0 = Date.now();
  try {
    const img = await openaiImage({ prompt: `${prompt}\n\nEstilo: fotografia ou ilustração de estúdio premiado, sem texto na imagem, sem marcas d'água, sem logotipos reais.`, size: input.size || '1024x1024' });
    const rel = path.join('uploads', input.clientId || 'studio', `${Date.now().toString(36)}-ia-${slugify(input.name || prompt.slice(0, 40)) || uid().slice(0, 6)}.png`);
    const abs = path.join(dataDir(), rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, img.bytes);
    const asset = await d.insert('assets', {
      client_id: input.clientId || null,
      kind: input.kind || 'imagem_ia',
      name: input.name || `Imagem IA · ${prompt.slice(0, 40)}`,
      path: rel,
      url: `/api/files/${rel.split(path.sep).join('/')}`,
      mime: img.mime,
      size_bytes: img.bytes.length,
      source: 'openai',
      tags: ['IA', 'ChatGPT'],
      analysis: { prompt, model: img.model },
      created_by: user.id,
    } as any);
    await d.insert('agent_runs', { agent: 'Imagem (ChatGPT)', model: img.model, input_tokens: Math.round(prompt.length / 4), output_tokens: 1000, cost_usd: estimateCost('openai:gpt-image-1', Math.round(prompt.length / 4), 1000), status: 'ok', client_id: input.clientId || null } as any);
    await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `gerou uma imagem com o ChatGPT (${Date.now() - t0} ms)`, entity: 'assets', entity_id: asset.id });
    revalidatePath('/biblioteca');
    if (input.clientId) revalidatePath(`/clientes/${input.clientId}`);
    revalidatePath('/marketing/brand');
    return { ok: true as const, id: asset.id, url: asset.url as string };
  } catch (e) {
    await d.insert('agent_runs', { agent: 'Imagem (ChatGPT)', model: 'openai:gpt-image-1', input_tokens: 0, output_tokens: 0, cost_usd: 0, status: 'erro', client_id: input.clientId || null } as any);
    return fail(`OpenAI: ${(e as Error).message}`);
  }
}

export async function generateImageFormAction(fd: FormData) {
  return generateImageAction({ prompt: String(fd.get('prompt') || ''), clientId: String(fd.get('client_id') || '') || null, size: (String(fd.get('size') || '1024x1024') as any), name: String(fd.get('name') || '') || undefined });
}

/** Moodboard de uma direção visual do BrandKit, gerado pelo ChatGPT a partir do conceito e da paleta. */
export async function generateDirectionImageAction(kitId: string, index: number) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const d = await db();
  const kit = await d.get('brand_kits', kitId);
  if (!kit) return fail('BrandKit não encontrado.');
  const visual = (kit.visual || {}) as Record<string, any>;
  const dirs: any[] = Array.isArray(visual.direcoes) ? visual.direcoes : [];
  const dir = dirs[index];
  if (!dir) return fail('Direção não encontrada.');
  const client = await d.get('clients', kit.client_id);
  const paleta = dir.paleta ? Object.entries(dir.paleta).filter(([k]) => k !== 'proporcao').map(([k, v]) => `${k} ${v}`).join(', ') : '';
  const prompt = `Moodboard de identidade visual para ${client?.company || client?.contact_name || 'uma marca'} (${client?.segment || ''}). Direção "${dir.nome}": ${dir.conceito}. Paleta: ${paleta}. Fotografia: ${dir.fotografia || ''}. Grafismo: ${dir.grafismo || ''}. Composição em colagem editorial com texturas, materiais e cenas reais da marca.`;
  const r = await generateImageAction({ prompt, clientId: kit.client_id, kind: 'moodboard', size: '1536x1024', name: `Moodboard · ${dir.nome}` });
  if (!r.ok) return r;
  dirs[index] = { ...dir, moodboard_url: r.url, moodboard_asset_id: r.id };
  await d.update('brand_kits', kitId, { visual: { ...visual, direcoes: dirs } } as any);
  revalidatePath('/marketing/brand');
  return { ok: true as const, url: r.url };
}

/** Coleta o perfil público do Instagram de um concorrente pelo Apify (actor apify/instagram-profile-scraper). */
export async function scrapeCompetitorAction(competitorId: string) {
  const user = await getSession();
  if (!user) return fail('Não autorizado');
  const token = getSecret('apifyToken');
  if (!token) return fail('Cole o token do Apify em Settings → Integrações.');
  const d = await db();
  const c = await d.get('competitors', competitorId);
  if (!c) return fail('Concorrente não encontrado.');
  const handle = (c.instagram || '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/^@/, '').split(/[/?]/)[0];
  if (!handle) return fail('Informe o Instagram do concorrente (@usuario ou link).');
  try {
    const r = await fetchJSON(`https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=120`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usernames: [handle] }),
    }, 150_000);
    if (!r.ok) throw new Error(r.json?.error?.message || `Apify ${r.status}`);
    const p = Array.isArray(r.json) ? r.json[0] : null;
    if (!p) throw new Error('Perfil não encontrado ou privado.');
    const resumo = `@${p.username}: ${p.followersCount ?? '?'} seguidores, ${p.postsCount ?? '?'} posts, ${p.followsCount ?? '?'} seguindo. ${p.biography ? `Bio: ${String(p.biography).slice(0, 160)}` : ''} (coletado em ${new Date().toLocaleDateString('pt-BR')})`;
    await d.update('competitors', competitorId, { notes: [c.notes, resumo].filter(Boolean).join('\n') } as any);
    await d.insert('research_reports', { client_id: c.client_id, kind: 'instagram_perfil', title: `Instagram @${p.username}`, findings: { username: p.username, followers: p.followersCount, posts: p.postsCount, follows: p.followsCount, bio: p.biography, verified: p.verified, latest: (p.latestPosts || []).slice(0, 6).map((x: any) => ({ caption: String(x.caption || '').slice(0, 140), likes: x.likesCount, comments: x.commentsCount, url: x.url })) }, sources: [{ title: 'Apify instagram-profile-scraper', url: `https://instagram.com/${p.username}`, date: new Date().toISOString().slice(0, 10) }] } as any);
    await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `coletou o Instagram de ${c.name} pelo Apify`, entity: 'competitors', entity_id: competitorId });
    revalidatePath('/pesquisa');
    return { ok: true as const, detail: resumo };
  } catch (e) {
    return fail(`Apify: ${(e as Error).message}`);
  }
}
