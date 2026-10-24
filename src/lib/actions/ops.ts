'use server';

/**
 * Ações dos módulos de Operação: Projects, Workflow, Sites, Pesquisa, Agenda e Aprovações.
 * Regras: toda ação confere a sessão, devolve { ok } e revalida as rotas afetadas.
 * Este arquivo é 'use server': só funções async podem ser exportadas.
 */

import { revalidatePath } from 'next/cache';
import { db, logActivity } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveClient } from '@/lib/active-client';
import { generateJSON } from '@/lib/ai/claude';
import { STUDIO_SYSTEM, clientBrief } from '@/lib/ai/prompts';
import { KIND_LABEL, STAGE_LABEL } from '@/lib/db/types';
import type { CalendarEvent, ContentItem, DB, Job, MethodStage, Project, Site, Task } from '@/lib/db/types';
import { clamp, uid } from '@/lib/utils';

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const NO_SESSION = 'Não autorizado';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const todayBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
/** Prazo "até o fim do dia" no horário de Brasília (sem horário de verão desde 2019). */
const endOfDay = (date: string) => `${date}T23:59:59-03:00`;
const bust = (...paths: string[]) => paths.forEach((p) => revalidatePath(p));
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Sem chave, generateJSON devolve o exemplo marcado (model 'exemplo') e a tela mostra o aviso.
 * Com chave, exemplo significa que a chamada falhou (rede, chave inválida ou resposta fora do formato):
 * nesse caso não gravamos um relatório de mentira, avisamos.
 */
const AI_FAILED = 'A IA não devolveu uma resposta utilizável. Confira a chave da Anthropic em Settings e tente de novo.';
const aiFailed = (r: { isExample: boolean; model: string }) => r.isExample && r.model !== 'exemplo';

/* ------------------------------------------------------------------ */
/* PROJECTS                                                            */
/* ------------------------------------------------------------------ */

const PROJECT_STATUS: Project['status'][] = ['ativo', 'aguardando_aprovacao', 'pausado', 'finalizado'];
const STAGE_PROGRESS: Record<MethodStage, number> = { ponto: 10, roteiro: 30, set: 55, estreia: 80, temporada: 100 };

/** Modelos de projeto: tarefas padrão por tipo. 'landing' usa o modelo de site. */
const TEMPLATES: Record<string, string[]> = {
  feed: [
    'Briefing e séries do mês',
    'Calendário editorial de 30 dias',
    'Artes e carrosséis do lote',
    'Legendas, texto alternativo e hashtags',
    'Revisão e envio para aprovação',
  ],
  reels: [
    'Roteiro com gancho nos 3 primeiros segundos',
    'Captação ou seleção do material bruto',
    'Edição, legenda e trilha',
    'Revisão e envio para aprovação',
  ],
  trafego: [
    'Briefing e Kit Zero da campanha',
    'Criativos, títulos e descrições',
    'Configuração no Gerenciador (CBO, públicos e pixel)',
    'Revisão de compliance e publicação',
    'Relatório da primeira semana',
  ],
  brand: [
    'Diagnóstico de marca',
    'Estratégia: posicionamento e assinatura',
    'Sistema verbal',
    'Sistema visual com 3 direções',
    'Aplicações da marca',
    'Manual da marca e entrega dos arquivos',
  ],
  site: [
    'Briefing e estrutura de páginas',
    'Design desktop e mobile',
    'Desenvolvimento',
    'QA em 1440, 1920 e 390 px',
    'Domínio, pixel e publicação',
    'Entrega e plano de manutenção',
  ],
};
const templateFor = (kind: string) => TEMPLATES[kind === 'landing' ? 'site' : kind] || null;

/** Títulos do modelo de um tipo de projeto (a tela usa para mostrar o que será criado). */
export async function projectTemplateTitles(kind: string): Promise<string[]> {
  return templateFor(kind) ?? [];
}

/** Distribui prazos entre hoje (ou o início) e a entrega do projeto. */
function spreadDue(starts: string | null | undefined, due: string | null | undefined, n: number): (string | null)[] {
  const none = Array<string | null>(n).fill(null);
  if (!due || !DATE_RE.test(due)) return none;
  const today = todayBR();
  if (due < today) return none;
  const from = starts && DATE_RE.test(starts) && starts > today ? starts : today;
  const DAY = 864e5;
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${due}T12:00:00Z`);
  const span = Math.max(0, Math.round((b - a) / DAY));
  return Array.from({ length: n }, (_, i) => endOfDay(new Date(a + Math.round((span * (i + 1)) / n) * DAY).toISOString().slice(0, 10)));
}

export async function moveProjectStageAction(id: string, stage: string) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  if (!(stage in STAGE_LABEL)) return fail('Etapa inválida.');
  const d = await db();
  const p = await d.get('projects', id);
  if (!p) return fail('Projeto não encontrado.');
  const next = stage as MethodStage;
  const patch: Partial<Project> = { method_stage: next };
  // O progresso só sobe: a etapa define o mínimo (10, 30, 55, 80, 100).
  if ((p.progress || 0) < STAGE_PROGRESS[next]) patch.progress = STAGE_PROGRESS[next];
  await d.update('projects', id, patch);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `moveu "${clip(p.title, 60)}" para ${STAGE_LABEL[next]}`, entity: 'projects', entity_id: id });
  bust('/projects', '/', `/clientes/${p.client_id}`);
  return { ok: true as const, progress: patch.progress ?? p.progress };
}

export async function updateProjectAction(id: string, fd: FormData) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const d = await db();
  const p = await d.get('projects', id);
  if (!p) return fail('Projeto não encontrado.');
  const patch: Partial<Project> = {};

  const status = String(fd.get('status') || '');
  if (status) {
    if (!PROJECT_STATUS.includes(status as Project['status'])) return fail('Status inválido.');
    patch.status = status as Project['status'];
  }
  if (fd.has('progress')) {
    const n = Number(fd.get('progress'));
    if (!Number.isFinite(n)) return fail('Progresso inválido.');
    patch.progress = Math.round(clamp(n, 0, 100));
  }
  if (fd.has('due_on')) {
    const due = String(fd.get('due_on') || '');
    if (due && !DATE_RE.test(due)) return fail('Prazo inválido.');
    patch.due_on = due || null;
  }
  if (fd.has('owner_id')) {
    const owner = String(fd.get('owner_id') || '');
    if (owner && !(await d.get('profiles', owner))) return fail('Responsável não encontrado.');
    patch.owner_id = owner || null;
  }
  // Projeto finalizado fecha em 100%.
  if (patch.status === 'finalizado') patch.progress = 100;

  await d.update('projects', id, patch);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `atualizou o projeto "${clip(p.title, 60)}"`, entity: 'projects', entity_id: id });
  bust('/projects', '/', `/clientes/${p.client_id}`);
  return { ok: true as const };
}

export async function toggleTaskAction(id: string, done?: boolean) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const d = await db();
  const t = await d.get('tasks', id);
  if (!t) return fail('Tarefa não encontrada.');
  const finish = done ?? t.status !== 'feito';
  await d.update('tasks', id, { status: finish ? 'feito' : 'a_fazer' });
  bust('/projects', '/workflow', '/', '/user');
  return { ok: true as const, done: finish };
}

export async function applyTemplateAction(projectId: string) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const d = await db();
  const p = await d.get('projects', projectId);
  if (!p) return fail('Projeto não encontrado.');
  const tpl = templateFor(p.kind);
  if (!tpl) return fail(`Não há modelo para o tipo ${KIND_LABEL[p.kind] || p.kind}.`);

  const existing = await d.list('tasks', { where: { project_id: projectId } });
  const have = new Set(existing.map((t) => t.title.trim().toLowerCase()));
  const todo = tpl.filter((title) => !have.has(title.toLowerCase()));
  if (!todo.length) return fail('O modelo já foi aplicado neste projeto.');

  const dues = spreadDue(p.starts_on, p.due_on, todo.length);
  for (let i = 0; i < todo.length; i++) {
    await d.insert('tasks', {
      project_id: p.id,
      client_id: p.client_id,
      title: todo[i],
      assignee_id: p.owner_id || user.id,
      status: 'a_fazer',
      priority: 2,
      due_at: dues[i],
    });
  }
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `aplicou o modelo ${KIND_LABEL[p.kind]} em "${clip(p.title, 60)}" (${todo.length} tarefas)`, entity: 'projects', entity_id: p.id });
  bust('/projects', '/workflow', '/');
  return { ok: true as const, created: todo.length };
}

/* ------------------------------------------------------------------ */
/* WORKFLOW                                                            */
/* ------------------------------------------------------------------ */

const TASK_STATUS: Task['status'][] = ['a_fazer', 'fazendo', 'revisao', 'feito'];

export async function moveTaskAction(id: string, status: string) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  if (!TASK_STATUS.includes(status as Task['status'])) return fail('Status inválido.');
  const d = await db();
  const t = await d.get('tasks', id);
  if (!t) return fail('Tarefa não encontrada.');
  await d.update('tasks', id, { status: status as Task['status'] });
  bust('/workflow', '/projects', '/', '/user');
  return { ok: true as const };
}

export async function createTaskAction(fd: FormData) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const title = String(fd.get('title') || '').trim();
  if (!title) return fail('Dê um título à tarefa.');
  const d = await db();

  const projectId = String(fd.get('project_id') || '');
  const project = projectId ? await d.get('projects', projectId) : null;
  if (projectId && !project) return fail('Projeto não encontrado.');
  const assignee = String(fd.get('assignee_id') || '') || user.id;
  const due = String(fd.get('due') || '');
  if (due && !DATE_RE.test(due)) return fail('Prazo inválido.');
  const priority = Math.round(clamp(Number(fd.get('priority') || 2), 1, 3));

  const task = await d.insert('tasks', {
    title: clip(title, 200),
    project_id: project?.id ?? null,
    client_id: project?.client_id ?? null,
    assignee_id: assignee,
    status: 'a_fazer',
    priority,
    due_at: due ? endOfDay(due) : null,
  });
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `criou a tarefa "${clip(title, 60)}"`, entity: 'tasks', entity_id: task.id });
  bust('/workflow', '/projects', '/', '/user');
  return { ok: true as const, id: task.id };
}

export async function setJobStatusAction(id: string, status: string) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  if (!['concluido', 'cancelado'].includes(status)) return fail('Status inválido.');
  const d = await db();
  const j = await d.get('jobs', id);
  if (!j) return fail('Job não encontrado.');
  const now = new Date().toISOString();
  const patch: Partial<Job> = { status: status as Job['status'], finished_at: now };
  if (status === 'concluido') patch.progress = 100;
  await d.update('jobs', id, patch);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `${status === 'concluido' ? 'concluiu' : 'cancelou'} o job ${j.kind.replace(/_/g, ' ')}`, entity: 'jobs', entity_id: id });
  bust('/workflow', '/team');
  return { ok: true as const };
}

export async function toggleWorkflowAction(id: string, active: boolean) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const d = await db();
  const w = await d.get('workflows', id);
  if (!w) return fail('Automação não encontrada.');
  await d.update('workflows', id, { active: Boolean(active) });
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `${active ? 'ativou' : 'pausou'} a automação "${clip(w.name, 60)}"`, entity: 'workflows', entity_id: id });
  bust('/workflow');
  return { ok: true as const };
}

export async function createWorkflowAction(fd: FormData) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const trigger = String(fd.get('trigger') || '').trim();
  const action = String(fd.get('action') || '').trim();
  if (!trigger || !action) return fail('Preencha "Quando" e "Faça".');
  const name = String(fd.get('name') || '').trim() || `${clip(trigger, 40)}: ${clip(action, 40)}`;
  const d = await db();
  const w = await d.insert('workflows', { name: clip(name, 120), trigger: clip(trigger, 200), action: clip(action, 300), active: true });
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `criou a automação "${clip(w.name, 60)}"`, entity: 'workflows', entity_id: w.id });
  bust('/workflow');
  return { ok: true as const, id: w.id };
}

/* ------------------------------------------------------------------ */
/* SITES                                                               */
/* ------------------------------------------------------------------ */

const SITE_ORDER: Site['status'][] = ['briefing', 'design', 'desenvolvimento', 'qa', 'publicado', 'manutencao'];
const SITE_TEMPLATES = ['artista-landing', 'artista-v3', 'links-mobile', 'institucional', 'landing-servico', 'loja'];

const normDomain = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/\s+/g, '');

/** Aceita só http(s), sem usuário e senha embutidos. Devolve '' se vazio e null se inválido. */
function normUrl(s: string): string | null {
  const v = s.trim();
  if (!v) return '';
  // Esquema explícito que não seja http(s) (ftp://, file://, javascript://) é recusado.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) && !/^https?:\/\//i.test(v)) return null;
  const full = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(full);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export async function createSiteAction(fd: FormData) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const clientId = String(fd.get('client_id') || '');
  const domain = normDomain(String(fd.get('domain') || ''));
  const name = String(fd.get('name') || '').trim() || domain;
  if (!clientId) return fail('Escolha o cliente.');
  if (!name) return fail('Dê um nome ao site.');
  const d = await db();
  if (!(await d.get('clients', clientId))) return fail('Cliente não encontrado.');
  const template = String(fd.get('template') || '');
  const site = await d.insert('sites', {
    client_id: clientId,
    name: clip(name, 120),
    template: SITE_TEMPLATES.includes(template) ? template : null,
    domain: domain || null,
    status: 'briefing',
  });
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `abriu o site ${clip(site.name, 60)}`, entity: 'sites', entity_id: site.id });
  bust('/sites');
  return { ok: true as const, id: site.id };
}

export async function advanceSiteAction(id: string) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const d = await db();
  const s = await d.get('sites', id);
  if (!s) return fail('Site não encontrado.');
  const i = SITE_ORDER.indexOf(s.status);
  const next = SITE_ORDER[i + 1];
  if (!next) return fail('O site já está em manutenção.');
  const patch: Partial<Site> = { status: next };
  if (next === 'publicado' && !s.url && s.domain) patch.url = `https://${s.domain}`;
  await d.update('sites', id, patch);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `avançou o site ${clip(s.name, 60)} para ${next}`, entity: 'sites', entity_id: id });
  bust('/sites');
  return { ok: true as const, status: next };
}

export async function updateSiteAction(id: string, fd: FormData) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const d = await db();
  const s = await d.get('sites', id);
  if (!s) return fail('Site não encontrado.');
  const patch: Partial<Site> = {};
  if (fd.has('repo')) patch.repo = clip(String(fd.get('repo') || '').trim(), 200) || null;
  if (fd.has('domain')) patch.domain = normDomain(String(fd.get('domain') || '')) || null;
  if (fd.has('url')) {
    const url = normUrl(String(fd.get('url') || ''));
    if (url === null) return fail('URL inválida. Use um endereço http ou https.');
    patch.url = url || null;
  }
  await d.update('sites', id, patch);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `atualizou os dados do site ${clip(s.name, 60)}`, entity: 'sites', entity_id: id });
  bust('/sites');
  return { ok: true as const };
}

/** Checklist de QA do site, guardada em research_reports (kind 'qa_site') porque sites não tem esse campo. */
export async function toggleSiteQaAction(siteId: string, key: string, checked: boolean) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  if (!/^[a-z0-9_]{1,40}$/.test(key)) return fail('Item inválido.');
  const d = await db();
  const site = await d.get('sites', siteId);
  if (!site) return fail('Site não encontrado.');
  const reports = await d.list('research_reports', { where: { kind: 'qa_site' } });
  const existing = reports.find((r) => r.findings?.site_id === siteId);
  const prev = existing?.findings?.checks;
  const checks = { ...(prev && typeof prev === 'object' ? (prev as Record<string, boolean>) : {}), [key]: Boolean(checked) };
  if (existing) {
    await d.update('research_reports', existing.id, { findings: { ...existing.findings, site_id: siteId, checks } });
  } else {
    await d.insert('research_reports', { client_id: site.client_id, kind: 'qa_site', title: `QA · ${site.name}`, findings: { site_id: siteId, checks }, sources: [] });
  }
  bust('/sites');
  return { ok: true as const };
}

/* ------------------------------------------------------------------ */
/* PESQUISA                                                            */
/* ------------------------------------------------------------------ */

export async function createCompetitorAction(fd: FormData) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const name = String(fd.get('name') || '').trim();
  if (!name) return fail('Informe o nome do concorrente.');
  const d = await db();
  const clientId = String(fd.get('client_id') || '') || (await getActiveClient())?.client.id;
  if (!clientId) return fail('Escolha um cliente ativo no topo.');
  const competitor = await d.insert('competitors', {
    client_id: clientId,
    name: clip(name, 120),
    instagram: clip(String(fd.get('instagram') || '').trim(), 120) || null,
    website: clip(String(fd.get('website') || '').trim(), 200) || null,
    notes: clip(String(fd.get('notes') || '').trim(), 1000) || null,
  });
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `cadastrou o concorrente ${clip(name, 60)}`, entity: 'competitors', entity_id: competitor.id });
  bust('/pesquisa');
  return { ok: true as const };
}

export async function deleteCompetitorAction(id: string) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const d = await db();
  await d.remove('competitors', id);
  bust('/pesquisa');
  return { ok: true as const };
}

export async function analyzeCompetitorsAction() {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const active = await getActiveClient();
  if (!active) return fail('Escolha um cliente ativo no topo.');
  const d = await db();
  const { client, context } = active;
  const name = client.company || client.contact_name;
  const competitors = await d.list('competitors', { where: { client_id: client.id } });
  if (!competitors.length) return fail('Cadastre ao menos um concorrente antes de analisar.');

  const list = competitors
    .map((c) => `- ${c.name}${c.instagram ? ` · Instagram ${c.instagram}` : ''}${c.website ? ` · site ${c.website}` : ''}${c.notes ? ` · observações: ${c.notes}` : ''}`)
    .join('\n');

  const example = {
    resumo: `[exemplo] Os concorrentes de ${name} prometem energia e qualidade com as mesmas palavras. Falta prova com número e imagem real de palco.`,
    posicionamento: competitors.map((c) => ({
      concorrente: c.name,
      leitura: c.notes ? `[exemplo] ${c.notes}` : '[exemplo] Comunicação genérica: promete qualidade, não mostra prova nem chamada clara.',
    })),
    linguagem_saturada: ['todos cantam e dançam', 'experiência única', 'energia contagiante', 'qualidade e profissionalismo'],
    oportunidades: [
      { titulo: 'Prova com número', acao: 'Publicar o número real de shows e cidades atendidas [N] no lugar do adjetivo.' },
      { titulo: 'Material de set', acao: 'Trocar banco de imagem por foto e vídeo reais de palco, com data e local.' },
      { titulo: 'Chamada única', acao: 'Fechar cada peça com uma ação só: orçamento pelo WhatsApp.' },
    ],
  };

  const prompt = `PAPEL: estrategista de pesquisa do Studio Impacto.
${clientBrief(client, context)}
CONCORRENTES CADASTRADOS:
${list}
TAREFA: leia o posicionamento de cada concorrente com base só no que está cadastrado acima (nome, Instagram, site, observações). Não invente número, seguidor, preço ou depoimento. Onde faltar dado, escreva [N].
FORMATO JSON:
{"resumo":"2 frases sobre como o setor se comunica","posicionamento":[{"concorrente":"nome","leitura":"1 frase: o que promete e para quem"}],"linguagem_saturada":["palavras e frases que todos repetem, 3 a 6 itens"],"oportunidades":[{"titulo":"território livre","acao":"o que ${name} faz com isso, 1 frase"}]}
Dê de 3 a 5 oportunidades. Sem vocabulário proibido, sem travessão.`;

  const r = await generateJSON({ agent: 'Pesquisa · Concorrentes', tier: 'strategy', system: STUDIO_SYSTEM, user: prompt, example, db: d, clientId: client.id, maxTokens: 2500 });
  if (aiFailed(r)) return fail(AI_FAILED);
  const report = await d.insert('research_reports', {
    client_id: client.id,
    kind: 'concorrentes',
    title: `Análise de concorrentes · ${name}`,
    findings: { ...r.data, is_example: r.isExample },
    sources: [],
  });
  await logActivity(d, { actor_id: user.id, actor_name: 'Agente de Pesquisa', action: `analisou os concorrentes de ${name}${r.isExample ? ' (exemplo)' : ''}`, entity: 'research_reports', entity_id: report.id });
  bust('/pesquisa');
  return { ok: true as const, id: report.id, isExample: r.isExample };
}

export async function generatePublicoAction() {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const active = await getActiveClient();
  if (!active) return fail('Escolha um cliente ativo no topo.');
  const d = await db();
  const { client, context, diagnosis } = active;
  const name = client.company || client.contact_name;

  const example = {
    resumo: `[exemplo] O público de ${name} decide por prova e por indicação. Quem contrata quer ver o trabalho feito antes de falar de preço.`,
    personas: [
      { nome: 'Quem decide a compra', dor: 'Medo de contratar sem ver resultado real', desejo: 'Uma proposta clara, com prazo e prova', objecao: 'Já foi mal atendido por outro fornecedor' },
      { nome: 'Quem indica', dor: 'Não sabe o que dizer ao indicar', desejo: 'Um material curto para encaminhar', objecao: 'Receio de queimar a própria reputação' },
    ],
    onde_estao: ['Instagram', 'WhatsApp', 'Indicação de pessoas conhecidas'],
    como_falar: ['Mostrar o trabalho antes de prometer', 'Usar número real no lugar de adjetivo', 'Uma chamada só por peça'],
  };

  const prompt = `PAPEL: estrategista de público do Studio Impacto.
${clientBrief(client, context)}
${diagnosis ? `DIAGNÓSTICO: ${diagnosis.summary || ''}` : ''}
TAREFA: descreva o público de ${name} com base só no briefing acima. Não invente pesquisa, estatística ou depoimento. Onde faltar dado, escreva [N].
FORMATO JSON:
{"resumo":"2 frases","personas":[{"nome":"papel na compra","dor":"...","desejo":"...","objecao":"..."}],"onde_estao":["canais onde encontrar"],"como_falar":["regras de linguagem para esse público"]}
Dê 2 a 3 personas. Sem vocabulário proibido, sem travessão.`;

  const r = await generateJSON({ agent: 'Pesquisa · Público', tier: 'strategy', system: STUDIO_SYSTEM, user: prompt, example, db: d, clientId: client.id, maxTokens: 2500 });
  if (aiFailed(r)) return fail(AI_FAILED);
  const report = await d.insert('research_reports', {
    client_id: client.id,
    kind: 'publico',
    title: `Leitura de público · ${name}`,
    findings: { ...r.data, is_example: r.isExample },
    sources: [],
  });
  await logActivity(d, { actor_id: user.id, actor_name: 'Agente de Pesquisa', action: `leu o público de ${name}${r.isExample ? ' (exemplo)' : ''}`, entity: 'research_reports', entity_id: report.id });
  bust('/pesquisa');
  return { ok: true as const, id: report.id, isExample: r.isExample };
}

export async function refreshRadarAction() {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const d = await db();
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date());

  const example = {
    destaques: [
      '[exemplo] Reels com gancho nos 3 primeiros segundos seguem como o formato de alcance para conta pequena.',
      '[exemplo] No Meta Ads, o criativo virou o público: variar ângulo pesa mais que refinar segmentação.',
      '[exemplo] Pedir comentário ou salvamento pesa mais no alcance do que pedir curtida.',
    ],
    acoes: ['Testar 3 ganchos por Reel neste mês', 'Subir conceitos de anúncio com ângulos diferentes, não variações de texto'],
    fontes: [] as { title: string; url: string; date?: string }[],
  };

  const prompt = `PAPEL: analista de tendências do Studio Impacto (marketing, conteúdo, tráfego e vídeo).
TAREFA: radar de ${month} para um estúdio criativo de Uberlândia (MG). Cubra: Instagram, Meta Ads, TikTok, LinkedIn, YouTube e vídeo com IA.
LIMITE: nesta chamada você não tem acesso à web. Liste só o que sabe com segurança. Não invente número, data ou fonte. Se não conhece a fonte, deixe "fontes" vazio.
FORMATO JSON:
{"destaques":["3 a 6 frases curtas, uma novidade por frase"],"acoes":["2 a 4 ações práticas para o Studio"],"fontes":[{"title":"nome da fonte","url":"https://...","date":"AAAA-MM"}]}
Sem vocabulário proibido, sem travessão.`;

  const r = await generateJSON({ agent: 'Pesquisa · Radar', tier: 'light', system: STUDIO_SYSTEM, user: prompt, example, db: d, clientId: null, maxTokens: 2000 });
  if (aiFailed(r)) return fail(AI_FAILED);
  const rawSources = Array.isArray(r.data?.fontes) ? r.data.fontes : [];
  // Só guardamos fontes com endereço http(s) válido.
  const sources = rawSources
    .filter((s): s is { title: string; url: string; date?: string } => !!s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url) && typeof s.title === 'string')
    .slice(0, 8)
    .map((s) => ({ title: clip(s.title, 120), url: s.url, ...(s.date ? { date: String(s.date) } : {}) }));
  const report = await d.insert('research_reports', {
    client_id: null,
    kind: 'radar',
    title: `Radar de tendências · ${month}`,
    findings: { destaques: r.data?.destaques ?? [], acoes: r.data?.acoes ?? [], is_example: r.isExample },
    sources,
  });
  await logActivity(d, { actor_id: user.id, actor_name: 'Agente de Pesquisa', action: `atualizou o radar de tendências${r.isExample ? ' (exemplo)' : ''}`, entity: 'research_reports', entity_id: report.id });
  bust('/pesquisa');
  return { ok: true as const, id: report.id, isExample: r.isExample };
}

/* Prospecção: a lista vive em um único research_reports (kind 'prospeccao', findings.lista). */

type ProspectSignals = Record<'ads' | 'reviews' | 'site' | 'insta' | 'rating', boolean>;
type Prospect = {
  id: string;
  name: string;
  segment: string;
  city: string;
  contact: string;
  signals: ProspectSignals;
  step: number; // toques já feitos (0 a 6)
  added_at: string;
  added_by: string;
};

async function prospectReport(d: DB) {
  const rows = await d.list('research_reports', { where: { kind: 'prospeccao' } });
  return rows[0] || null;
}

function readProspects(findings: Record<string, unknown> | undefined): Prospect[] {
  const raw = findings?.lista;
  return Array.isArray(raw) ? (raw as Prospect[]) : [];
}

async function saveProspects(d: DB, lista: Prospect[]) {
  const rep = await prospectReport(d);
  if (rep) await d.update('research_reports', rep.id, { findings: { ...rep.findings, lista } });
  else await d.insert('research_reports', { client_id: null, kind: 'prospeccao', title: 'Lista de prospecção', findings: { lista }, sources: [] });
}

export async function addProspectAction(fd: FormData) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const name = String(fd.get('name') || '').trim();
  if (!name) return fail('Informe o nome da empresa.');
  const d = await db();
  const on = (k: string) => fd.get(k) === 'on';
  const prospect: Prospect = {
    id: uid(),
    name: clip(name, 120),
    segment: clip(String(fd.get('segment') || '').trim(), 80),
    city: clip(String(fd.get('city') || '').trim(), 80),
    contact: clip(String(fd.get('contact') || '').trim(), 160),
    signals: { ads: on('ads'), reviews: on('reviews'), site: on('site'), insta: on('insta'), rating: on('rating') },
    step: 0,
    added_at: new Date().toISOString(),
    added_by: user.name,
  };
  const rep = await prospectReport(d);
  await saveProspects(d, [...readProspects(rep?.findings), prospect]);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `adicionou o prospect ${clip(name, 60)}`, entity: 'research_reports', entity_id: rep?.id });
  bust('/pesquisa');
  return { ok: true as const, id: prospect.id };
}

export async function advanceProspectAction(id: string) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const d = await db();
  const rep = await prospectReport(d);
  const lista = readProspects(rep?.findings);
  const p = lista.find((x) => x.id === id);
  if (!p) return fail('Prospect não encontrado.');
  if (p.step >= 6) return fail('A cadência deste prospect já terminou.');
  await saveProspects(d, lista.map((x) => (x.id === id ? { ...x, step: x.step + 1 } : x)));
  bust('/pesquisa');
  return { ok: true as const };
}

export async function removeProspectAction(id: string) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const d = await db();
  const rep = await prospectReport(d);
  const lista = readProspects(rep?.findings);
  if (!lista.some((x) => x.id === id)) return fail('Prospect não encontrado.');
  await saveProspects(d, lista.filter((x) => x.id !== id));
  bust('/pesquisa');
  return { ok: true as const };
}

/* ------------------------------------------------------------------ */
/* AGENDA                                                              */
/* ------------------------------------------------------------------ */

const EVENT_KINDS: CalendarEvent['kind'][] = ['reuniao', 'diaria', 'entrega', 'publicacao', 'outro'];

export async function createEventAction(fd: FormData) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const title = String(fd.get('title') || '').trim();
  if (!title) return fail('Dê um título ao evento.');
  const date = String(fd.get('date') || '');
  if (!DATE_RE.test(date)) return fail('Informe a data.');
  const timeRaw = String(fd.get('time') || '');
  const time = TIME_RE.test(timeRaw) ? timeRaw : '09:00';
  const kindRaw = String(fd.get('kind') || 'outro');
  const kind = (EVENT_KINDS.includes(kindRaw as CalendarEvent['kind']) ? kindRaw : 'outro') as CalendarEvent['kind'];
  const d = await db();
  const clientId = String(fd.get('client_id') || '');
  if (clientId && !(await d.get('clients', clientId))) return fail('Cliente não encontrado.');

  const ev = await d.insert('events', { title: clip(title, 160), kind, starts_at: `${date}T${time}:00-03:00`, client_id: clientId || null });
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `agendou "${clip(title, 60)}"`, entity: 'events', entity_id: ev.id });
  bust('/agenda', '/');
  return { ok: true as const, id: ev.id };
}

export async function deleteEventAction(id: string) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  const d = await db();
  const ev = await d.get('events', id);
  if (!ev) return fail('Evento não encontrado.');
  await d.remove('events', id);
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action: `removeu o evento "${clip(ev.title, 60)}"`, entity: 'events', entity_id: id });
  bust('/agenda', '/');
  return { ok: true as const };
}

/* ------------------------------------------------------------------ */
/* APROVAÇÕES                                                          */
/* ------------------------------------------------------------------ */

const CONTENT_STATUS: ContentItem['status'][] = ['rascunho', 'revisado', 'em_aprovacao', 'aprovado', 'ajustar', 'agendado', 'publicado'];

export async function setContentStatusAction(id: string, status: string) {
  const user = await getSession();
  if (!user) return fail(NO_SESSION);
  if (!CONTENT_STATUS.includes(status as ContentItem['status'])) return fail('Status inválido.');
  const d = await db();
  const item = await d.get('content_items', id);
  if (!item) return fail('Peça não encontrada.');
  await d.update('content_items', id, { status: status as ContentItem['status'] });
  const hook = clip(item.hook, 60);
  const action = status === 'aprovado' ? `aprovou a peça "${hook}"` : status === 'ajustar' ? `pediu ajuste na peça "${hook}"` : `marcou a peça "${hook}" como ${status.replace('_', ' ')}`;
  await logActivity(d, { actor_id: user.id, actor_name: user.name, action, entity: 'content_items', entity_id: id });
  bust('/aprovacoes', '/', '/user');
  return { ok: true as const };
}
