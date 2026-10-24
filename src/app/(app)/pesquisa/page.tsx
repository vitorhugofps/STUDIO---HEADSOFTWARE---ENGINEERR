import Link from 'next/link';
import { ExternalLink, Radar, Sparkles, Trash2, Users } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveClient } from '@/lib/active-client';
import { hasAIKey } from '@/lib/ai/claude';
import type { Competitor, ResearchReport } from '@/lib/db/types';
import { Badge, Card, Dot, EmptyState, Example, Field, Input, PageHeader, PillTabs, Progress, Section, Stepper, Table, TD, TH, Textarea } from '@/components/ui/primitives';
import { ActionButton, ActionForm, SubmitButton } from '@/components/ui/client';
import {
  addProspectAction,
  advanceProspectAction,
  analyzeCompetitorsAction,
  createCompetitorAction,
  deleteCompetitorAction,
  generatePublicoAction,
  refreshRadarAction,
  removeProspectAction,
} from '@/lib/actions/ops';
import { relTime } from '@/lib/utils';

export const metadata = { title: 'Pesquisa' };

type SP = { t?: string; r?: string };

const TABS = [
  { key: 'concorrentes', label: 'Concorrentes' },
  { key: 'publico', label: 'Público' },
  { key: 'radar', label: 'Radar' },
  { key: 'prospeccao', label: 'Prospecção' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/* ---------- Leitura defensiva do JSON gerado pela IA ---------- */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strings = (v: unknown) => list(v).map(str).filter(Boolean);

/** Só endereços http e https viram link. */
function safeHref(v?: string | null) {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
const siteHref = (raw?: string | null) => {
  const v = (raw || '').trim();
  return v ? safeHref(/^https?:\/\//i.test(v) ? v : `https://${v}`) : null;
};
function instaHref(raw?: string | null) {
  const v = (raw || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return safeHref(v);
  const handle = v.replace(/^@/, '').replace(/^(www\.)?instagram\.com\//i, '').replace(/\/$/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `https://instagram.com/${handle}` : null;
}

/* ---------- Prospecção ---------- */

const RULES = [
  { key: 'ads', label: 'Anúncio ativo', short: 'Anúncio', points: 3 },
  { key: 'reviews', label: 'Mais de 50 avaliações', short: 'Avaliações', points: 2 },
  { key: 'site', label: 'Site lento ou ausente', short: 'Site', points: 2 },
  { key: 'insta', label: 'Instagram parado há 30 dias', short: 'Instagram', points: 2 },
  { key: 'rating', label: 'Nota abaixo de 4,5', short: 'Nota', points: 1 },
] as const;

const CADENCE = [
  { day: 'D0', label: 'Seguir e comentar', detail: 'Seguir a conta e comentar em um post recente.' },
  { day: 'D1', label: 'Mensagem', detail: 'Mensagem de 3 linhas.' },
  { day: 'D3', label: 'Vídeo-auditoria', detail: 'Vídeo de 60 s com 3 achados.' },
  { day: 'D7', label: 'Case', detail: 'Um case parecido com o negócio dele.' },
  { day: 'D12', label: 'Convite para o Diagnóstico', detail: 'Convite com dois horários.' },
  { day: 'D21', label: 'Encerramento', detail: 'Encerramento educado. Sem insistir.' },
] as const;

type Prospect = {
  id: string;
  name: string;
  segment: string;
  city: string;
  contact: string;
  signals: Partial<Record<(typeof RULES)[number]['key'], boolean>>;
  step: number;
};

function readProspects(rep?: ResearchReport): Prospect[] {
  return list(rep?.findings?.lista)
    .map(obj)
    .filter((p) => typeof p.id === 'string' && typeof p.name === 'string')
    .map((p) => ({
      id: String(p.id),
      name: str(p.name),
      segment: str(p.segment),
      city: str(p.city),
      contact: str(p.contact),
      signals: obj(p.signals) as Prospect['signals'],
      step: Math.min(6, Math.max(0, Number(p.step) || 0)),
    }));
}
const impactIndex = (p: Prospect) => RULES.reduce((s, r) => s + (p.signals[r.key] ? r.points : 0), 0);

/* ---------- Página ---------- */

export default async function PesquisaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.t) ? (sp.t as TabKey) : 'concorrentes';
  const d = await db();
  const aiReady = hasAIKey();
  const canConfigure = user.role === 'admin' || user.role === 'developer';

  // Cada aba busca só o que mostra.
  const active = tab === 'concorrentes' || tab === 'publico' ? await getActiveClient() : null;
  const clientId = active?.client.id;
  const competitors: Competitor[] = tab === 'concorrentes' && clientId ? await d.list('competitors', { where: { client_id: clientId }, orderBy: 'created_at', desc: true }) : [];
  const conReports = tab === 'concorrentes' && clientId ? await d.list('research_reports', { where: { kind: 'concorrentes', client_id: clientId }, orderBy: 'created_at', desc: true, limit: 1 }) : [];
  const pubReports = tab === 'publico' && clientId ? await d.list('research_reports', { where: { kind: 'publico', client_id: clientId }, orderBy: 'created_at', desc: true }) : [];
  const radarReports = tab === 'radar' ? await d.list('research_reports', { where: { kind: 'radar' }, orderBy: 'created_at', desc: true }) : [];
  const prospectRep = tab === 'prospeccao' ? (await d.list('research_reports', { where: { kind: 'prospeccao' } }))[0] : undefined;
  const prospects = readProspects(prospectRep).sort((a, b) => impactIndex(b) - impactIndex(a) || a.name.localeCompare(b.name, 'pt-BR'));

  const clientName = active ? active.client.company || active.client.contact_name : '';
  const radar = radarReports.find((r) => r.id === sp.r) || radarReports[0];

  const headerAction =
    tab === 'concorrentes' && active && competitors.length > 0 ? (
      <ActionButton action={analyzeCompetitorsAction} success="Análise pronta">
        <Sparkles className="h-4 w-4" /> Analisar concorrentes com IA
      </ActionButton>
    ) : tab === 'publico' && active ? (
      <ActionButton action={generatePublicoAction} success="Leitura do público pronta">
        <Sparkles className="h-4 w-4" /> Gerar leitura do público
      </ActionButton>
    ) : tab === 'radar' ? (
      <ActionButton action={refreshRadarAction} success="Radar atualizado">
        <Radar className="h-4 w-4" /> Atualizar radar
      </ActionButton>
    ) : null;

  return (
    <div>
      <PageHeader
        kicker="Operação"
        title="Pesquisa"
        subtitle="Concorrentes, público, tendências e prospecção. Cada leitura parte de dado cadastrado, não de palpite."
        actions={headerAction}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <PillTabs tabs={TABS.map((t) => ({ href: `/pesquisa?t=${t.key}`, label: t.label }))} current={`/pesquisa?t=${tab}`} />
        {tab !== 'prospeccao' && !aiReady && (
          <span className="text-xs text-ink3">
            Sem chave da Anthropic. A IA devolve um exemplo marcado como tal.
            {canConfigure && (
              <>
                {' '}
                <Link href="/settings?t=integracoes" className="text-ink2 underline-offset-2 hover:text-ink hover:underline">
                  Configurar
                </Link>
              </>
            )}
          </span>
        )}
      </div>

      {tab === 'concorrentes' && (
        <Concorrentes active={active ? { id: active.client.id, name: clientName, color: active.client.brand_color || '#FF5B1F' } : null} competitors={competitors} report={conReports[0]} />
      )}
      {tab === 'publico' && (
        <Publico
          active={active ? { id: active.client.id, name: clientName, color: active.client.brand_color || '#FF5B1F' } : null}
          reports={pubReports}
          hasContext={Boolean(active?.context)}
          contextVersion={active?.context?.version}
          hasDiagnosis={Boolean(active?.diagnosis)}
        />
      )}
      {tab === 'radar' && <RadarView report={radar} others={radarReports.filter((r) => r.id !== radar?.id)} />}
      {tab === 'prospeccao' && <Prospeccao prospects={prospects} />}
    </div>
  );
}

/* ================================================================== */
/* CONCORRENTES                                                        */
/* ================================================================== */

type ActiveChip = { id: string; name: string; color: string };

function Concorrentes({ active, competitors, report }: { active: ActiveChip | null; competitors: Competitor[]; report?: ResearchReport }) {
  if (!active) {
    return <EmptyState icon={<Users className="h-5 w-5" />} title="Nenhum cliente ativo" text="Escolha um cliente no seletor do topo para cadastrar concorrentes e ler o posicionamento deles." />;
  }
  const isExample = report?.findings?.is_example === true;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-8 lg:col-span-2">
        <Section title="Concorrentes cadastrados" kicker={active.name}>
          {competitors.length === 0 ? (
            <EmptyState icon={<Users className="h-5 w-5" />} title="Nenhum concorrente ainda" text={`Cadastre ao lado quem disputa a atenção do mesmo público de ${active.name}. A análise só parte do que estiver aqui.`} />
          ) : (
            <Card className="divide-y divide-white/[0.05] p-2">
              {competitors.map((c) => {
                const ig = instaHref(c.instagram);
                const site = siteHref(c.website);
                return (
                  <div key={c.id} className="flex items-start gap-3 px-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink">{c.name}</div>
                      {(c.instagram || c.website) && (
                        <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink2">
                          {c.instagram &&
                            (ig ? (
                              <a href={ig} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
                                {c.instagram} <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span>{c.instagram}</span>
                            ))}
                          {c.website &&
                            (site ? (
                              <a href={site} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
                                {c.website} <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span>{c.website}</span>
                            ))}
                        </div>
                      )}
                      {c.notes && <p className="mt-1.5 text-xs text-ink2">{c.notes}</p>}
                    </div>
                    <ActionButton variant="ghost" size="icon" aria-label={`Remover ${c.name}`} action={deleteCompetitorAction.bind(null, c.id)} confirm={`Remover ${c.name} da lista?`} success="Concorrente removido">
                      <Trash2 className="h-4 w-4" />
                    </ActionButton>
                  </div>
                );
              })}
            </Card>
          )}
        </Section>

        <Section
          title={
            <>
              Leitura da IA
              <Example show={isExample} />
            </>
          }
          kicker="Posicionamento"
          action={report ? <span className="text-xs text-ink3">gerada {relTime(report.created_at)}</span> : undefined}
        >
          {report ? (
            <CompetitorReport report={report} />
          ) : (
            <EmptyState
              icon={<Sparkles className="h-5 w-5" />}
              title="Nenhuma análise ainda"
              text={competitors.length === 0 ? 'Cadastre ao menos um concorrente e rode a análise.' : 'Use o botão no topo da página. A leitura aponta a linguagem que todos repetem e o território livre.'}
            />
          )}
        </Section>
      </div>

      <div className="space-y-6">
        <Section title="Novo concorrente" kicker="Cadastro">
          <Card className="p-5">
            <ActionForm action={createCompetitorAction} success="Concorrente cadastrado" resetOnSuccess className="space-y-3">
              <input type="hidden" name="client_id" value={active.id} />
              <Field label="Nome" required>
                <Input name="name" required />
              </Field>
              <Field label="Instagram" hint="Ex.: @nomedaconta">
                <Input name="instagram" autoCapitalize="none" spellCheck={false} />
              </Field>
              <Field label="Site">
                <Input name="website" placeholder="nomedoconcorrente.com.br" autoCapitalize="none" spellCheck={false} inputMode="url" />
              </Field>
              <Field label="Observações" hint="O que ele promete, para quem, com que linguagem.">
                <Textarea name="notes" className="min-h-[84px]" />
              </Field>
              <SubmitButton variant="subtle" className="w-full">
                Cadastrar concorrente
              </SubmitButton>
            </ActionForm>
          </Card>
        </Section>

        <Card className="p-5">
          <div className="text-sm font-medium text-ink">O que a IA lê</div>
          <p className="mt-2 text-xs text-ink2">Só nome, Instagram, site e observações. Ela não consulta a web nem inventa número. Onde faltar dado, escreve [N].</p>
        </Card>
      </div>
    </div>
  );
}

function CompetitorReport({ report }: { report: ResearchReport }) {
  const f = report.findings;
  const resumo = str(f.resumo);
  const posicionamento = list(f.posicionamento)
    .map(obj)
    .map((p) => ({ nome: str(p.concorrente), leitura: str(p.leitura) }))
    .filter((p) => p.nome || p.leitura);
  const saturada = strings(f.linguagem_saturada);
  const oportunidades = list(f.oportunidades)
    .map(obj)
    .map((o) => ({ titulo: str(o.titulo), acao: str(o.acao) }))
    .filter((o) => o.titulo || o.acao);

  return (
    <div className="space-y-4">
      {resumo && (
        <Card className="p-5">
          <div className="label mb-2">Resumo</div>
          <p className="text-sm leading-relaxed text-ink">{resumo}</p>
        </Card>
      )}

      {posicionamento.length > 0 && (
        <Table>
          <thead>
            <tr>
              <TH>Concorrente</TH>
              <TH>O que promete e para quem</TH>
            </tr>
          </thead>
          <tbody>
            {posicionamento.map((p, i) => (
              <tr key={`${p.nome}-${i}`}>
                <TD className="whitespace-nowrap font-medium">{p.nome}</TD>
                <TD className="text-ink2">{p.leitura}</TD>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {saturada.length > 0 && (
        <Card className="p-5">
          <div className="label mb-3">Linguagem saturada</div>
          <div className="flex flex-wrap gap-2">
            {saturada.map((s, i) => (
              <Badge key={`${s}-${i}`}>{s}</Badge>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink3">Frases que todos repetem. O Studio evita.</p>
        </Card>
      )}

      {oportunidades.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {oportunidades.map((o, i) => (
            <Card key={`${o.titulo}-${i}`} className="p-5">
              <div className="num text-xs text-ink3">{String(i + 1).padStart(2, '0')}</div>
              <div className="mt-1 text-sm font-medium text-ink">{o.titulo}</div>
              {o.acao && <p className="mt-1.5 text-sm text-ink2">{o.acao}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* PÚBLICO                                                             */
/* ================================================================== */

function Publico({ active, reports, hasContext, contextVersion, hasDiagnosis }: { active: ActiveChip | null; reports: ResearchReport[]; hasContext: boolean; contextVersion?: number; hasDiagnosis: boolean }) {
  if (!active) {
    return <EmptyState icon={<Users className="h-5 w-5" />} title="Nenhum cliente ativo" text="Escolha um cliente no seletor do topo para ler o público dele." />;
  }
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {reports.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title="Nenhuma leitura de público" text="Use o botão no topo. A leitura parte do contexto e do diagnóstico do cliente e devolve personas, canais e regras de linguagem." />
        ) : (
          reports.map((r, i) => <AudienceReport key={r.id} report={r} defaultOpen={i === 0} />)
        )}
      </div>

      <div className="space-y-6">
        <Card className="p-5">
          <div className="label mb-3">Base da leitura</div>
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
            <span className="dot" style={{ background: active.color }} />
            {active.name}
          </div>
          <ul className="space-y-2 text-sm text-ink2">
            <li className="flex items-center gap-2">
              <Dot state={hasContext ? 'done' : 'off'} />
              {hasContext ? `Contexto do cliente, versão ${contextVersion ?? 1}` : 'Contexto do cliente não preenchido'}
            </li>
            <li className="flex items-center gap-2">
              <Dot state={hasDiagnosis ? 'done' : 'off'} />
              {hasDiagnosis ? 'Diagnóstico gerado' : 'Diagnóstico ainda não gerado'}
            </li>
          </ul>
          <p className="mt-3 text-xs text-ink3">Quanto mais completo o contexto, menos [N] na leitura.</p>
        </Card>
        <Card className="p-5">
          <div className="text-sm font-medium text-ink">Sem pesquisa inventada</div>
          <p className="mt-2 text-xs text-ink2">A IA não cita estatística nem depoimento que você não cadastrou. Dado que falta aparece como [N].</p>
        </Card>
      </div>
    </div>
  );
}

function AudienceReport({ report, defaultOpen }: { report: ResearchReport; defaultOpen: boolean }) {
  const f = report.findings;
  const resumo = str(f.resumo);
  const personas = list(f.personas)
    .map(obj)
    .map((p) => ({ nome: str(p.nome), dor: str(p.dor), desejo: str(p.desejo), objecao: str(p.objecao) }))
    .filter((p) => p.nome || p.dor || p.desejo || p.objecao);
  const ondeEstao = strings(f.onde_estao);
  const comoFalar = strings(f.como_falar);
  const isExample = f.is_example === true;

  return (
    <details open={defaultOpen} className="card group p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 text-sm font-medium text-ink">
          {report.title}
          <Example show={isExample} />
        </span>
        <span className="shrink-0 text-xs text-ink3">{relTime(report.created_at)}</span>
      </summary>

      <div className="mt-5 space-y-5">
        {resumo && <p className="text-sm leading-relaxed text-ink">{resumo}</p>}

        {personas.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {personas.map((p, i) => (
              <div key={`${p.nome}-${i}`} className="rounded-2xl bg-white/[0.04] p-4">
                <div className="text-sm font-medium text-ink">{p.nome}</div>
                <dl className="mt-3 space-y-2.5 text-sm">
                  {p.dor && (
                    <div>
                      <dt className="label">Dor</dt>
                      <dd className="mt-0.5 text-ink2">{p.dor}</dd>
                    </div>
                  )}
                  {p.desejo && (
                    <div>
                      <dt className="label">Desejo</dt>
                      <dd className="mt-0.5 text-ink2">{p.desejo}</dd>
                    </div>
                  )}
                  {p.objecao && (
                    <div>
                      <dt className="label">Objeção</dt>
                      <dd className="mt-0.5 text-ink2">{p.objecao}</dd>
                    </div>
                  )}
                </dl>
              </div>
            ))}
          </div>
        )}

        {ondeEstao.length > 0 && (
          <div>
            <div className="label mb-2">Onde estão</div>
            <div className="flex flex-wrap gap-2">
              {ondeEstao.map((s, i) => (
                <Badge key={`${s}-${i}`}>{s}</Badge>
              ))}
            </div>
          </div>
        )}

        {comoFalar.length > 0 && (
          <div>
            <div className="label mb-2">Como falar</div>
            <ul className="space-y-1.5 text-sm text-ink2">
              {comoFalar.map((s, i) => (
                <li key={`${s}-${i}`} className="flex gap-2.5">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

/* ================================================================== */
/* RADAR                                                               */
/* ================================================================== */

function RadarView({ report, others }: { report?: ResearchReport; others: ResearchReport[] }) {
  if (!report) {
    return (
      <EmptyState
        icon={<Radar className="h-5 w-5" />}
        title="Nenhum radar ainda"
        text="Use o botão no topo para gerar a primeira edição. Nesta versão a IA não navega na web: ela lista o que conhece e deixa as fontes vazias quando não tem certeza."
      />
    );
  }
  const f = report.findings;
  const destaques = strings(f.destaques);
  const acoes = strings(f.acoes);
  const fontes = (report.sources || []).filter((s) => s && typeof s.title === 'string');
  const isExample = f.is_example === true;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-8 lg:col-span-2">
        <Section
          title={
            <>
              {report.title}
              <Example show={isExample} />
            </>
          }
          kicker="O que mudou"
          action={<span className="text-xs text-ink3">atualizado {relTime(report.created_at)}</span>}
        >
          {destaques.length === 0 ? (
            <EmptyState title="Sem destaques nesta edição" text="Atualize o radar para gerar uma nova." />
          ) : (
            <Card className="divide-y divide-white/[0.05] p-2">
              {destaques.map((t, i) => (
                <div key={`${t}-${i}`} className="flex gap-4 px-3 py-3.5">
                  <span className="num w-6 shrink-0 text-sm text-ink3">{String(i + 1).padStart(2, '0')}</span>
                  <p className="text-sm leading-relaxed text-ink">{t}</p>
                </div>
              ))}
            </Card>
          )}
        </Section>

        {acoes.length > 0 && (
          <Section title="O que fazer neste mês" kicker="Ações para o Studio">
            <Card className="p-5">
              <ul className="space-y-2.5 text-sm text-ink">
                {acoes.map((t, i) => (
                  <li key={`${t}-${i}`} className="flex gap-3">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        )}
      </div>

      <div className="space-y-6">
        <Section title="Fontes" kicker="Com data">
          {fontes.length === 0 ? (
            <Card className="p-5 text-sm text-ink2">Esta edição não tem fonte com endereço. Não vale citar em peça pública sem conferir.</Card>
          ) : (
            <Card className="divide-y divide-white/[0.05] p-2">
              {fontes.map((s, i) => {
                const href = safeHref(s.url);
                return (
                  <div key={`${s.url}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">{s.title}</div>
                      {s.date && <div className="text-xs text-ink3">{s.date}</div>}
                    </div>
                    {href && (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="focus-ring shrink-0 rounded-full p-2 text-ink2 hover:text-accent" aria-label={`Abrir ${s.title} em nova aba`}>
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                );
              })}
            </Card>
          )}
        </Section>

        {others.length > 0 && (
          <Section title="Edições anteriores" kicker="Histórico">
            <Card className="divide-y divide-white/[0.05] p-2">
              {others.slice(0, 8).map((r) => (
                <Link key={r.id} href={`/pesquisa?t=radar&r=${r.id}`} className="press flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.05]">
                  <span className="min-w-0 truncate text-sm text-ink">{r.title}</span>
                  <span className="shrink-0 text-xs text-ink3">{relTime(r.created_at)}</span>
                </Link>
              ))}
            </Card>
          </Section>
        )}

        <Card className="p-5">
          <div className="text-sm font-medium text-ink">Como o radar funciona aqui</div>
          <p className="mt-2 text-xs text-ink2">Esta tela não navega na web. A atualização com pesquisa e fonte datada roda no agente de marketing, uma vez por mês.</p>
        </Card>
      </div>
    </div>
  );
}

/* ================================================================== */
/* PROSPECÇÃO                                                          */
/* ================================================================== */

function Prospeccao({ prospects }: { prospects: Prospect[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-8 lg:col-span-2">
        <Section title="Lista de prospecção" kicker={`${prospects.length} ${prospects.length === 1 ? 'empresa' : 'empresas'}`}>
          {prospects.length === 0 ? (
            <EmptyState icon={<Users className="h-5 w-5" />} title="Nenhum prospect ainda" text="Adicione a primeira empresa ao lado, marque os sinais que você encontrou e o Índice de Impacto sai na hora." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <TH>Empresa</TH>
                  <TH>Contato</TH>
                  <TH>Sinais</TH>
                  <TH>Índice</TH>
                  <TH>Cadência</TH>
                  <TH className="text-right">Ações</TH>
                </tr>
              </thead>
              <tbody>
                {prospects.map((p) => {
                  const index = impactIndex(p);
                  const next = p.step < CADENCE.length ? CADENCE[p.step] : null;
                  return (
                    <tr key={p.id} className="transition-colors hover:bg-white/[0.03]">
                      <TD>
                        <div className="font-medium text-ink">{p.name}</div>
                        <div className="text-xs text-ink3">{[p.segment, p.city].filter(Boolean).join(' · ') || 'sem segmento'}</div>
                      </TD>
                      <TD className="max-w-[180px] text-ink2">{p.contact ? <span className="line-clamp-2">{p.contact}</span> : <span className="text-ink3">sem contato</span>}</TD>
                      <TD>
                        <div className="flex max-w-[200px] flex-wrap gap-1">
                          {RULES.filter((r) => p.signals[r.key]).map((r) => (
                            <Badge key={r.key} className="px-2 py-0.5">
                              {r.short}
                            </Badge>
                          ))}
                          {RULES.every((r) => !p.signals[r.key]) && <span className="text-xs text-ink3">nenhum</span>}
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={index >= 7 ? 'accent' : index >= 4 ? 'info' : 'neutral'}>
                          <span className="num">{index}</span>/10
                        </Badge>
                      </TD>
                      <TD className="min-w-[170px]">
                        <div className="flex items-center gap-2">
                          <Progress value={(p.step / CADENCE.length) * 100} tone={p.step >= CADENCE.length ? 'ok' : 'accent'} />
                          <span className="num whitespace-nowrap text-xs text-ink2">{p.step}/6</span>
                        </div>
                        <div className="mt-1 text-xs text-ink3">{next ? `Próximo: ${next.day} ${next.label.toLowerCase()}` : 'Cadência encerrada'}</div>
                      </TD>
                      <TD>
                        <div className="flex items-center justify-end gap-1.5">
                          {next && (
                            <ActionButton size="sm" variant="subtle" action={advanceProspectAction.bind(null, p.id)} success={`${next.day} registrado`}>
                              Registrar {next.day}
                            </ActionButton>
                          )}
                          <ActionButton variant="ghost" size="icon" aria-label={`Remover ${p.name}`} action={removeProspectAction.bind(null, p.id)} confirm={`Remover ${p.name} da lista?`} success="Prospect removido">
                            <Trash2 className="h-4 w-4" />
                          </ActionButton>
                        </div>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Section>

        <Section title="Cadência de 6 toques em 21 dias" kicker="Do primeiro comentário ao encerramento">
          <Card className="space-y-5 p-5">
            <Stepper steps={CADENCE.map((c) => `${c.day} · ${c.label}`)} current={0} />
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {CADENCE.map((c) => (
                <div key={c.day} className="flex gap-3">
                  <dt className="num w-9 shrink-0 text-sm text-accent">{c.day}</dt>
                  <dd className="text-sm text-ink2">
                    <span className="text-ink">{c.label}.</span> {c.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </Section>
      </div>

      <div className="space-y-6">
        <Section title="Novo prospect" kicker="Cadastro manual">
          <Card className="p-5">
            <ActionForm action={addProspectAction} success="Prospect adicionado" resetOnSuccess className="space-y-3">
              <Field label="Empresa" required>
                <Input name="name" required />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Segmento">
                  <Input name="segment" />
                </Field>
                <Field label="Cidade">
                  <Input name="city" />
                </Field>
              </div>
              <Field label="Contato" hint="Instagram, telefone ou e-mail">
                <Input name="contact" />
              </Field>
              <fieldset className="space-y-2 pt-1">
                <legend className="mb-1.5 text-[13px] font-medium text-ink">Sinais encontrados</legend>
                {RULES.map((r) => (
                  <label key={r.key} className="flex cursor-pointer items-center justify-between gap-3 text-sm text-ink2">
                    <span className="flex items-center gap-2.5">
                      <input type="checkbox" name={r.key} className="h-4 w-4 accent-accent" />
                      {r.label}
                    </span>
                    <span className="num text-xs text-ink3">+{r.points}</span>
                  </label>
                ))}
              </fieldset>
              <SubmitButton className="w-full">Adicionar prospect</SubmitButton>
            </ActionForm>
          </Card>
        </Section>

        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-ink">Índice de Impacto</div>
            <Badge>0 a 10</Badge>
          </div>
          <p className="mt-2 text-xs text-ink2">Soma dos sinais. Quem pontua mais entra primeiro na cadência.</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {RULES.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3 text-ink2">
                <span>{r.label}</span>
                <span className="num text-ink">+{r.points}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-3 text-xs text-ink3">
            <Badge tone="info">próxima fase</Badge>
            Importar CNPJ da Receita e Google Maps pelo Apify
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-sm font-medium text-ink">LGPD</div>
          <p className="mt-2 text-xs text-ink2">Base legal: legítimo interesse, com teste de balanceamento registrado. Toda mensagem tem opção de sair. WhatsApp só com autorização prévia. Nenhum dado sensível.</p>
        </Card>
      </div>
    </div>
  );
}
