import { requireRole } from '@/lib/auth';
import { STUDIO_DEFAULTS, isSupabaseMode, readConfig, supabaseEnv, type AppConfig } from '@/lib/config';
import { resolveModel, resolveEffort, STRATEGY_MODELS, COPY_MODELS, EFFORTS } from '@/lib/ai/claude';
import { IMAGE_MODELS, openaiImageModel, type ImageModel } from '@/lib/ai/openai';
import { IntegrationTest } from './test-button';
import { saveOpenAIAction } from '@/lib/actions/integrations';
import { db } from '@/lib/db';
import { QUESTIONNAIRE, type QType } from '@/lib/questionnaire';
import { Badge, Card, Dot, EmptyState, Field, Input, PageHeader, PillTabs, Section, Select, Stat, Table, TD, TH, Textarea } from '@/components/ui/primitives';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { saveModelsAction, saveSecretsAction, saveServiceAction, saveStudioAction } from '@/lib/actions/settings';
import { fmtDateTime, num } from '@/lib/utils';
import { ServiceRow } from './forms';

export const metadata = { title: 'Settings' };

type SP = { t?: string };

const TABS = [
  { key: 'studio', label: 'Studio' },
  { key: 'integracoes', label: 'Integrações' },
  { key: 'ia', label: 'IA' },
  { key: 'catalogo', label: 'Catálogo' },
  { key: 'questionario', label: 'Questionário' },
  { key: 'seguranca', label: 'Segurança' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const TZ = 'America/Sao_Paulo';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireRole(['admin', 'developer']);
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.t) ? (sp.t as TabKey) : 'studio';
  // A configuração lida do disco guarda as chaves de verdade. Só o resumo sem segredo desce como prop:
  // em desenvolvimento o React serializa as props dos componentes de servidor para o navegador.
  const view = buildView(readConfig());

  return (
    <div>
      <PageHeader kicker="Studio" title="Settings" subtitle="Dados do Studio, integrações, modelos de IA, catálogo e segurança. Só admin e developer entram aqui." />
      <div className="mb-5">
        <PillTabs tabs={TABS.map((t) => ({ href: `/settings?t=${t.key}`, label: t.label }))} current={`/settings?t=${tab}`} />
      </div>

      {tab === 'studio' && <StudioTab studio={view.studio} />}
      {tab === 'integracoes' && <IntegrationsTab view={view} />}
      {tab === 'ia' && <AITab />}
      {tab === 'catalogo' && <CatalogTab />}
      {tab === 'questionario' && <QuestionnaireTab />}
      {tab === 'seguranca' && <SecurityTab />}
    </div>
  );
}

/* ================================================================== */
/* STUDIO                                                              */
/* ================================================================== */

function StudioTab({ studio }: { studio: NonNullable<AppConfig['studio']> }) {
  // Campo em branco volta ao padrão, igual às propostas e à página de aprovação.
  const saved = Object.fromEntries(Object.entries(studio).filter(([, v]) => v));
  const v = { ...STUDIO_DEFAULTS, ...saved } as typeof STUDIO_DEFAULTS;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="p-6 lg:col-span-2">
        <ActionForm key={JSON.stringify(v)} action={saveStudioAction} success="Dados do Studio salvos" className="space-y-4">
          <Field label="Nome do Studio" required>
            <Input name="name" defaultValue={v.name} required />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="CNPJ">
              <Input name="cnpj" defaultValue={v.cnpj} inputMode="numeric" />
            </Field>
            <Field label="WhatsApp">
              <Input name="whatsapp" defaultValue={v.whatsapp} inputMode="tel" />
            </Field>
            <Field label="Instagram">
              <Input name="instagram" defaultValue={v.instagram} autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field label="Site">
              <Input name="site" defaultValue={v.site} autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field label="Cidade">
              <Input name="city" defaultValue={v.city} />
            </Field>
            <Field label="E-mail">
              <Input type="email" name="email" defaultValue={v.email} />
            </Field>
          </div>
          <SubmitButton>Salvar dados do Studio</SubmitButton>
        </ActionForm>
      </Card>

      <Card className="h-fit p-5">
        <div className="text-sm font-medium text-ink">Onde estes dados aparecem</div>
        <p className="mt-2 text-xs text-ink2">Propostas, contratos, relatórios e a página pública de aprovação. Campo em branco volta ao padrão.</p>
        <dl className="mt-4 space-y-2 text-sm">
          {[
            ['Padrão de nome', STUDIO_DEFAULTS.name],
            ['Padrão de Instagram', STUDIO_DEFAULTS.instagram],
            ['Padrão de site', STUDIO_DEFAULTS.site],
          ].map(([k, val]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-ink3">{k}</dt>
              <dd className="text-ink2">{val}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

/* ================================================================== */
/* INTEGRAÇÕES                                                         */
/* ================================================================== */

const SECRETS = {
  anthropicApiKey: { env: 'ANTHROPIC_API_KEY', field: 'Chave da API' },
  openaiApiKey: { env: 'OPENAI_API_KEY', field: 'Chave da API da OpenAI' },
  metaAccessToken: { env: 'META_ACCESS_TOKEN', field: 'Token de acesso' },
  resendApiKey: { env: 'RESEND_API_KEY', field: 'Chave da API' },
  apifyToken: { env: 'APIFY_TOKEN', field: 'Token' },
} as const;
type SecretKey = keyof typeof SECRETS;

function maskUrl(raw: string) {
  try {
    const u = new URL(raw);
    const [sub, ...rest] = u.hostname.split('.');
    const keep = Math.min(4, Math.floor(sub.length / 2));
    return `${u.protocol}//${sub.slice(0, keep)}••••${rest.length ? `.${rest.join('.')}` : ''}`;
  } catch {
    return 'URL inválida';
  }
}

type SecretState = { stored: boolean; env: boolean; ok: boolean; label: string };

function secretState(cfg: AppConfig, key: SecretKey): SecretState {
  const stored = Boolean(cfg[key]);
  const env = Boolean(process.env[SECRETS[key].env]);
  return { stored, env, ok: stored || env, label: stored ? 'Configurada em Settings' : env ? 'Configurada por variável de ambiente' : 'Pendente' };
}

/** O que as abas podem receber: dados do Studio, campos que não são segredo e só o estado (sim ou não) de cada chave. */
type SettingsView = {
  studio: NonNullable<AppConfig['studio']>;
  metaAppId: string;
  reportFromEmail: string;
  secrets: Record<SecretKey, SecretState>;
};

function buildView(cfg: AppConfig): SettingsView {
  return {
    studio: { ...(cfg.studio || {}) },
    metaAppId: cfg.metaAppId || '',
    reportFromEmail: cfg.reportFromEmail || '',
    secrets: {
      anthropicApiKey: secretState(cfg, 'anthropicApiKey'),
      openaiApiKey: secretState(cfg, 'openaiApiKey'),
      metaAccessToken: secretState(cfg, 'metaAccessToken'),
      resendApiKey: secretState(cfg, 'resendApiKey'),
      apifyToken: secretState(cfg, 'apifyToken'),
    },
  };
}

/** Campo de segredo. Nunca recebe o valor: só sabe se existe. Em branco, mantém o que já está salvo. */
function SecretInput({ state: s, name }: { state: SecretState; name: SecretKey }) {
  return (
    <div className="space-y-2">
      <Field label={SECRETS[name].field} hint={s.ok ? 'Em branco mantém o valor atual. Cole outro para trocar.' : 'Cole o valor. Ele fica só no servidor.'}>
        <Input type="password" name={name} autoComplete="new-password" spellCheck={false} placeholder={s.ok ? '••••••••••••' : 'Cole aqui'} />
      </Field>
      {s.stored && (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink2">
          <input type="checkbox" name={`clear_${name}`} className="h-3.5 w-3.5 accent-accent" />
          Remover o valor salvo em Settings
        </label>
      )}
    </div>
  );
}

function IntegrationHead({ name, what, ok, label }: { name: string; what: string; ok: boolean; label: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{name}</div>
        <p className="mt-1 text-xs text-ink2">{what}</p>
      </div>
      <span className="flex shrink-0 items-center gap-2 text-xs text-ink2">
        <Dot state={ok ? 'done' : 'idle'} />
        {label}
      </span>
    </div>
  );
}

const IMAGE_MODEL_LABEL: Record<ImageModel, string> = {
  'gpt-image-1': 'gpt-image-1 · recomendado',
  'gpt-image-1-mini': 'gpt-image-1-mini · mais barato',
  'dall-e-3': 'dall-e-3 · anterior',
};

function IntegrationsTab({ view }: { view: SettingsView }) {
  const supabase = isSupabaseMode();
  const { url } = supabaseEnv();
  const { anthropicApiKey: anthropic, openaiApiKey: openai, metaAccessToken: meta, resendApiKey: resend, apifyToken: apify } = view.secrets;
  const imageModel = openaiImageModel();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="space-y-4 p-5">
          <IntegrationHead name="Supabase" what="Banco de dados, login e arquivos do time." ok={supabase} label={supabase ? 'Conectado' : 'Modo local'} />
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink3">Endereço</dt>
              <dd className="truncate font-mono text-[12px] text-ink2">{supabase && url ? maskUrl(url) : 'não configurado'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink3">Banco em uso</dt>
              <dd className="text-ink2">{supabase ? 'Supabase (Postgres)' : 'Arquivo local (.data/db.json)'}</dd>
            </div>
          </dl>
          <p className="text-xs text-ink3">A conexão vem das variáveis SUPABASE_URL e SUPABASE_ANON_KEY do ambiente. Para trocar, altere as variáveis e reinicie.</p>
          <IntegrationTest provider="supabase" />
        </Card>

        <Card className="space-y-4 p-5">
          <IntegrationHead name="Anthropic" what="Claude para diagnóstico, plano de conteúdo, roteiros, anúncios, propostas e pesquisa." ok={anthropic.ok} label={anthropic.label} />
          <ActionForm action={saveSecretsAction} success="Chave da Anthropic salva" resetOnSuccess className="space-y-3">
            <SecretInput state={anthropic} name="anthropicApiKey" />
            <SubmitButton variant="subtle">Salvar Anthropic</SubmitButton>
          </ActionForm>
          <IntegrationTest provider="anthropic" disabled={!anthropic.ok} />
        </Card>

        <Card className="space-y-4 p-5">
          <IntegrationHead name="ChatGPT · Imagens" what="Usado só para criar e gerar imagens (moodboards, imagens de apoio, variações). Todo texto, estratégia e roteiro continuam no Claude." ok={openai.ok} label={openai.label} />
          <ActionForm action={saveOpenAIAction} success="ChatGPT (imagens) salvo" resetOnSuccess className="space-y-3">
            <SecretInput state={openai} name="openaiApiKey" />
            <Field label="Modelo de imagem" hint="Testar conexão confere se a chave acessa o modelo escolhido.">
              <Select key={imageModel} name="openaiImageModel" defaultValue={imageModel}>
                {IMAGE_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {IMAGE_MODEL_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton variant="subtle">Salvar ChatGPT</SubmitButton>
          </ActionForm>
          <IntegrationTest provider="openai" disabled={!openai.ok} />
        </Card>

        <Card className="space-y-4 p-5">
          <IntegrationHead name="Meta Ads" what="Publicar campanhas pausadas na conta de anúncios do cliente." ok={meta.ok} label={meta.label} />
          <ActionForm action={saveSecretsAction} success="Meta salva" resetOnSuccess className="space-y-3">
            <SecretInput state={meta} name="metaAccessToken" />
            <Field label="ID do app da Meta" hint="Opcional. Não é segredo.">
              <Input key={view.metaAppId || 'sem-app'} name="metaAppId" defaultValue={view.metaAppId} inputMode="numeric" />
            </Field>
            <SubmitButton variant="subtle">Salvar Meta</SubmitButton>
          </ActionForm>
          <IntegrationTest provider="meta" disabled={!meta.ok} />
        </Card>

        <Card className="space-y-4 p-5">
          <IntegrationHead name="Resend" what="Envio dos relatórios por e-mail ao cliente e ao time." ok={resend.ok} label={resend.label} />
          <ActionForm action={saveSecretsAction} success="Resend salvo" resetOnSuccess className="space-y-3">
            <SecretInput state={resend} name="resendApiKey" />
            <Field label="E-mail remetente" hint="Sem valor, usamos relatorios@studioimpacto.com.br.">
              <Input key={view.reportFromEmail || 'sem-remetente'} type="email" name="reportFromEmail" defaultValue={view.reportFromEmail} autoCapitalize="none" />
            </Field>
            <SubmitButton variant="subtle">Salvar Resend</SubmitButton>
          </ActionForm>
          <IntegrationTest provider="resend" disabled={!resend.ok} />
        </Card>

        <Card className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <IntegrationHead name="Apify" what="Coleta de dados públicos (Google Maps, Instagram) para prospecção e pesquisa." ok={apify.ok} label={apify.label} />
          </div>
          <ActionForm action={saveSecretsAction} success="Apify salvo" resetOnSuccess className="space-y-3">
            <SecretInput state={apify} name="apifyToken" />
            <div className="flex items-center gap-3">
              <SubmitButton variant="subtle">Salvar Apify</SubmitButton>
              <span className="text-xs text-ink3">Usado em Pesquisa → Concorrentes (perfil do Instagram)</span>
            </div>
          </ActionForm>
          <IntegrationTest provider="apify" disabled={!apify.ok} />
        </Card>

        <Card className="space-y-4 p-5">
          <IntegrationHead name="Google Drive" what="Importar pastas de clientes e vídeos grandes direto do Drive." ok={false} label="Não conectado" />
          <div className="flex items-center gap-3 text-xs text-ink3">
            <Badge tone="info">próxima fase</Badge>
            Por enquanto, cole o link do Drive na Biblioteca ou na página do cliente.
          </div>
        </Card>
      </div>
      <p className="text-xs text-ink3">As chaves ficam só no servidor. A tela mostra apenas se existem, nunca o valor. Política de IA: todo texto, estratégia e roteiro ficam com o Claude (Opus 5.5 ou Fable 5.1 na estratégia, Sonnet 5.5 na copy); o ChatGPT é usado só para criar imagens.</p>
    </div>
  );
}

/* ================================================================== */
/* IA                                                                  */
/* ================================================================== */

const MODEL_NAME: Record<string, string> = {
  'claude-fable-5-1': 'Claude Fable 5.1',
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};
const modelName = (id: string) => MODEL_NAME[id] || id;

function ModelSelect({ name, label, hint, options, current }: { name: string; label: string; hint: string; options: string[]; current: string }) {
  const all = Array.from(new Set([current, ...options]));
  return (
    <Field label={label} hint={hint}>
      <Select name={name} defaultValue={current}>
        {all.map((m) => (
          <option key={m} value={m} disabled={!options.includes(m)}>
            {modelName(m)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

async function AITab() {
  const d = await db();
  const runs = await d.list('agent_runs', { orderBy: 'created_at', desc: true, limit: 3000 });
  const month = dayFmt.format(new Date()).slice(0, 7);
  const inMonth = runs.filter((r) => {
    const dt = new Date(r.created_at);
    return !Number.isNaN(dt.getTime()) && dayFmt.format(dt).slice(0, 7) === month;
  });

  const groups = new Map<string, { agent: string; model: string; calls: number; examples: number; input: number; output: number; cost: number }>();
  for (const r of inMonth) {
    const key = `${r.agent}|${r.model}`;
    const g = groups.get(key) || { agent: r.agent, model: r.model, calls: 0, examples: 0, input: 0, output: 0, cost: 0 };
    if (r.status === 'exemplo') g.examples++;
    else g.calls++;
    g.input += r.input_tokens || 0;
    g.output += r.output_tokens || 0;
    g.cost += r.cost_usd || 0;
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.cost - a.cost || b.calls - a.calls || a.agent.localeCompare(b.agent, 'pt-BR'));
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalCalls = rows.reduce((s, r) => s + r.calls, 0);
  const totalTokens = rows.reduce((s, r) => s + r.input + r.output, 0);
  const totalExamples = rows.reduce((s, r) => s + r.examples, 0);
  const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <ActionForm key={`${resolveModel('strategy')}|${resolveModel('copy')}|${resolveEffort()}`} action={saveModelsAction} success="Modelos salvos" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <ModelSelect name="anthropicModelStrategy" label="Modelo de estratégia" hint="Diagnóstico, proposta, marca, kit zero e pesquisa." options={[...STRATEGY_MODELS]} current={resolveModel('strategy')} />
              <Field label="Esforço de raciocínio" hint="Só na estratégia. Máximo pensa mais e custa mais.">
                <Select name="anthropicEffort" defaultValue={resolveEffort()}>
                  {EFFORTS.map((e) => (
                    <option key={e} value={e}>
                      {e === 'max' ? 'Máximo' : e === 'high' ? 'Alto' : 'Médio'}
                    </option>
                  ))}
                </Select>
              </Field>
              <ModelSelect name="anthropicModelCopy" label="Modelo de copy" hint="Plano de conteúdo, revisão, roteiros, anúncios e insights." options={[...COPY_MODELS]} current={resolveModel('copy')} />
            </div>
            <p className="text-xs text-ink3">Claude executa todo texto, estratégia e roteiro. O ChatGPT (OpenAI) é usado só para criar imagens, configurado em Integrações.</p>
            <SubmitButton>Salvar modelos</SubmitButton>
          </ActionForm>
        </Card>
        <Card className="h-fit p-5">
          <div className="text-sm font-medium text-ink">Modelo leve</div>
          <p className="mt-2 text-xs text-ink2">Relatórios diários e o radar usam {modelName(resolveModel('light'))}, fixo. Não muda aqui.</p>
        </Card>
      </div>

      <Section title="Custo do mês" kicker={monthName}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Custo estimado" value={usd.format(totalCost)} hint="Preço de referência por token" />
          <Stat label="Chamadas" value={num(totalCalls)} hint={totalExamples > 0 ? `${num(totalExamples)} de exemplo, sem custo` : 'Com a chave da Anthropic'} />
          <Stat label="Tokens" value={num(totalTokens)} hint="Entrada mais saída" />
        </div>

        {rows.length === 0 ? (
          <EmptyState title="Nenhuma chamada neste mês" text="Quando um agente rodar, o custo por agente e por modelo aparece aqui." />
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>Agente</TH>
                <TH>Modelo</TH>
                <TH className="text-right">Chamadas</TH>
                <TH className="text-right">Tokens de entrada</TH>
                <TH className="text-right">Tokens de saída</TH>
                <TH className="text-right">Custo</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.agent}|${r.model}`} className="transition-colors hover:bg-white/[0.03]">
                  <TD className="font-medium">{r.agent}</TD>
                  <TD className="text-ink2">{r.model === 'exemplo' ? 'Exemplo' : modelName(r.model)}</TD>
                  <TD className="num text-right">
                    {num(r.calls)}
                    {r.examples > 0 && <span className="ml-1.5 font-sans text-[11px] text-ink3">+{num(r.examples)} ex.</span>}
                  </TD>
                  <TD className="num text-right text-ink2">{num(r.input)}</TD>
                  <TD className="num text-right text-ink2">{num(r.output)}</TD>
                  <TD className="num text-right">{usd.format(r.cost)}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  );
}

/* ================================================================== */
/* CATÁLOGO                                                            */
/* ================================================================== */

async function CatalogTab() {
  const d = await db();
  const services = await d.list('services_catalog', { orderBy: 'front' });
  const fronts = Array.from(new Set(['Marca', 'Conteúdo', 'Vídeo', 'Tráfego', 'Sites', 'Impacto 360', ...services.map((s) => s.front)]));
  const sorted = [...services].sort((a, b) => a.front.localeCompare(b.front, 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR'));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <datalist id="catalog-fronts">
          {fronts.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        {sorted.length === 0 ? (
          <EmptyState title="Catálogo vazio" text="Adicione o primeiro serviço ao lado. O comercial usa esta tabela como referência de preço nas propostas." />
        ) : (
          <Card className="divide-y divide-white/[0.05] p-2">
            <div className="hidden gap-2 px-3 pb-1 pt-2 sm:grid sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_112px_132px]">
              <span className="label">Serviço</span>
              <span className="label">Frente</span>
              <span className="label">Cobrança</span>
              <span className="label">Preço base</span>
            </div>
            {sorted.map((s) => (
              <ServiceRow key={[s.id, s.name, s.front, s.kind, s.base_price, s.recurring, s.description || ''].join('|')} service={s} />
            ))}
          </Card>
        )}
        <p className="text-xs text-ink3">Diária de captação é sempre cobrada à parte e nunca entra como item incluso em plano mensal.</p>
      </div>

      <Section title="Novo serviço" kicker="Catálogo">
        <Card className="p-5">
          <ActionForm action={saveServiceAction} success="Serviço adicionado" resetOnSuccess className="space-y-3">
            <Field label="Nome" required>
              <Input name="name" required />
            </Field>
            <Field label="Frente" required>
              <Input name="front" list="catalog-fronts" placeholder="Ex.: Sites" required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cobrança">
                <Select name="kind" defaultValue="projeto">
                  <option value="projeto">Projeto</option>
                  <option value="mensal">Mensal</option>
                  <option value="avulso">Avulso</option>
                </Select>
              </Field>
              <Field label="Preço base (R$)">
                <Input name="base_price" inputMode="decimal" placeholder="3500" required />
              </Field>
            </div>
            <Field label="Descrição">
              <Textarea name="description" className="min-h-[72px]" />
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink2">
              <input type="checkbox" name="recurring" className="h-4 w-4 accent-accent" />
              Cobrança recorrente
            </label>
            <SubmitButton className="w-full">Adicionar ao catálogo</SubmitButton>
          </ActionForm>
        </Card>
      </Section>
    </div>
  );
}

/* ================================================================== */
/* QUESTIONÁRIO                                                        */
/* ================================================================== */

const QTYPE: Record<QType, string> = {
  single: 'Escolha única',
  multi: 'Várias escolhas',
  text: 'Texto curto',
  long: 'Texto longo',
  scale: 'Escala de 1 a 5',
  number: 'Número',
  url: 'Link',
  date: 'Data',
};

function QuestionnaireTab() {
  const base = QUESTIONNAIRE.filter((b) => !b.niche?.length);
  const niche = QUESTIONNAIRE.filter((b) => b.niche?.length);
  const questions = QUESTIONNAIRE.reduce((s, b) => s + b.questions.length, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Blocos base" value={base.length} hint="Todo cliente responde" />
        <Stat label="Blocos por nicho" value={niche.length} hint="Entram conforme o segmento" />
        <Stat label="Perguntas" value={questions} hint="Somando todos os blocos" />
      </div>

      <div className="space-y-2">
        {QUESTIONNAIRE.map((b) => (
          <details key={b.id} className="card group">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
              <span className="num grid h-7 min-w-7 place-items-center rounded-full bg-white/[0.07] px-1.5 text-xs text-ink2">{b.id}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{b.title}</span>
                {b.niche?.length ? <span className="mt-0.5 block truncate text-xs text-ink3">Nicho: {b.niche.join(', ')}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-ink3">
                {b.questions.length} {b.questions.length === 1 ? 'pergunta' : 'perguntas'}
              </span>
            </summary>
            <div className="border-t border-white/[0.06] px-4 py-4">
              <p className="mb-3 text-sm text-ink2">{b.intro}</p>
              <ol className="divide-y divide-white/[0.05]">
                {b.questions.map((q) => (
                  <li key={q.id} className="flex gap-3 py-3">
                    <span className="num w-9 shrink-0 pt-0.5 text-xs text-ink3">{q.id}</span>
                    <div className="min-w-0">
                      <div className="text-sm text-ink">{q.label}</div>
                      {q.hint && <div className="mt-0.5 text-xs text-ink3">{q.hint}</div>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone="info">{QTYPE[q.type] || q.type}</Badge>
                        {q.options?.map((o) => (
                          <Badge key={o}>{o}</Badge>
                        ))}
                      </div>
                      <div className="mt-2 text-xs text-ink3">
                        Revela: {q.reveals}
                        {q.showIf ? ` · Aparece se ${q.showIf.id} for ${q.showIf.in.join(' ou ')}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </details>
        ))}
      </div>
      <p className="text-xs text-ink3">Somente leitura. As perguntas vivem em src/lib/questionnaire.ts e mudam por código.</p>
    </div>
  );
}

/* ================================================================== */
/* SEGURANÇA                                                           */
/* ================================================================== */

async function SecurityTab() {
  const d = await db();
  const log = await d.list('activity_log', { orderBy: 'created_at', desc: true, limit: 50 });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Section title="Atividade recente" kicker={`Últimos ${log.length}`} className="lg:col-span-2">
        {log.length === 0 ? (
          <EmptyState title="Sem atividade registrada" text="Cada ação do time entra aqui com quem fez e quando." />
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>Quando</TH>
                <TH>Quem</TH>
                <TH>O que aconteceu</TH>
                <TH>Onde</TH>
              </tr>
            </thead>
            <tbody>
              {log.map((a) => (
                <tr key={a.id} className="transition-colors hover:bg-white/[0.03]">
                  <TD className="whitespace-nowrap text-xs text-ink3">{fmtDateTime(a.created_at)}</TD>
                  <TD className="whitespace-nowrap text-ink2">{a.actor_name || 'Sistema'}</TD>
                  <TD>{a.action}</TD>
                  <TD className="whitespace-nowrap text-xs text-ink3">{a.entity || ''}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <div className="space-y-6">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-ink">Autenticação em dois fatores</div>
            <Badge tone="info">próxima fase</Badge>
          </div>
          <p className="mt-2 text-xs text-ink2">Hoje o acesso é por usuário e senha. Cada pessoa troca a própria senha na página User.</p>
        </Card>
        <Card className="p-5">
          <div className="text-sm font-medium text-ink">Chaves e segredos</div>
          <p className="mt-2 text-xs text-ink2">Ficam só no servidor. As telas mostram se existem, nunca o valor, e o histórico guarda apenas o nome do campo alterado.</p>
        </Card>
        <Card className="p-5">
          <div className="text-sm font-medium text-ink">Quem entra aqui</div>
          <p className="mt-2 text-xs text-ink2">Admin e developer. Qualquer outro papel é redirecionado para o início.</p>
        </Card>
      </div>
    </div>
  );
}
