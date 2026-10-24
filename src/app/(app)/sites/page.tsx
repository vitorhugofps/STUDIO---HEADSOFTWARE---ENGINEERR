import Link from 'next/link';
import { ExternalLink, Globe } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import type { Site } from '@/lib/db/types';
import { Badge, Card, Dot, EmptyState, Field, Input, PageHeader, Section, Select, Stepper, Table, TD, TH } from '@/components/ui/primitives';
import { ActionButton, ActionForm, SubmitButton } from '@/components/ui/client';
import { advanceSiteAction, createSiteAction, updateSiteAction } from '@/lib/actions/ops';
import { QaChecklist, SiteDrawer, type QaItem } from './drawer';

export const metadata = { title: 'Sites' };

type SP = { s?: string };

const PHASES: { key: Site['status']; label: string; dot: 'idle' | 'wave' | 'rec' | 'done' }[] = [
  { key: 'briefing', label: 'Briefing', dot: 'idle' },
  { key: 'design', label: 'Design', dot: 'wave' },
  { key: 'desenvolvimento', label: 'Desenvolvimento', dot: 'rec' },
  { key: 'qa', label: 'QA', dot: 'wave' },
  { key: 'publicado', label: 'Publicado', dot: 'done' },
  { key: 'manutencao', label: 'Manutenção', dot: 'done' },
];

const TEMPLATES: { key: string; label: string }[] = [
  { key: 'artista-landing', label: 'Landing de artista' },
  { key: 'artista-v3', label: 'Site de artista v3' },
  { key: 'links-mobile', label: 'Links para celular' },
  { key: 'institucional', label: 'Institucional' },
  { key: 'landing-servico', label: 'Landing de serviço' },
  { key: 'loja', label: 'Loja' },
];
// Templates antigos do seed continuam legíveis na tabela.
const TEMPLATE_EXTRA: Record<string, string> = { 'artista-escritorio': 'Escritório de artistas' };
const templateLabel = (k?: string | null) => (k ? TEMPLATES.find((t) => t.key === k)?.label || TEMPLATE_EXTRA[k] || k : 'Sem template');

/** Itens do QA. A chave vira o nome do campo em research_reports (kind 'qa_site'). */
const QA_ITEMS: QaItem[] = [
  { key: 'playwright_1440', label: 'Playwright em 1440 px', hint: 'Desktop padrão, sem quebra de layout' },
  { key: 'playwright_1920', label: 'Playwright em 1920 px', hint: 'Tela larga, conteúdo contido' },
  { key: 'playwright_390', label: 'Playwright em 390 px', hint: 'Celular, toque com alvo mínimo de 44 px' },
  { key: 'reduced_motion', label: 'Reduced motion respeitado', hint: 'Animação desligada quando o sistema pede' },
  { key: 'console_limpo', label: 'Console limpo', hint: 'Sem erro nem aviso no carregamento' },
  { key: 'contraste', label: 'Contraste mínimo de 4,5:1', hint: 'Texto sobre fundo, nos dois temas' },
  { key: 'sem_scroll_horizontal', label: 'Sem scroll horizontal', hint: 'Em qualquer largura' },
  { key: 'whatsapp', label: 'Link do WhatsApp codificado', hint: 'Texto da mensagem com encodeURIComponent' },
];

/** Só endereços http e https viram link. Qualquer outra coisa vira texto. */
function safeHref(v?: string | null) {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export default async function SitesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const d = await db();
  const [sites, clients, qaReports] = await Promise.all([d.list('sites'), d.list('clients'), d.list('research_reports', { where: { kind: 'qa_site' } })]);

  const clientById = new Map(clients.map((c) => [c.id, c]));
  const clientName = (id: string) => {
    const c = clientById.get(id);
    return c ? c.company || c.contact_name : 'Cliente removido';
  };
  const phaseIndex = (s: Site['status']) => PHASES.findIndex((p) => p.key === s);

  // Em produção primeiro: quem está no início do pipeline aparece no topo.
  const rows = [...sites].sort((a, b) => phaseIndex(a.status) - phaseIndex(b.status) || a.name.localeCompare(b.name, 'pt-BR'));
  const count = Object.fromEntries(PHASES.map((p) => [p.key, sites.filter((s) => s.status === p.key).length])) as Record<Site['status'], number>;
  const inProduction = sites.filter((s) => phaseIndex(s.status) < phaseIndex('publicado')).length;

  const open = sp.s ? sites.find((s) => s.id === sp.s) : undefined;
  const openChecks: Record<string, boolean> = (() => {
    if (!open) return {};
    const rep = qaReports.find((r) => r.findings?.site_id === open.id);
    const raw = rep?.findings?.checks;
    return raw && typeof raw === 'object' ? (raw as Record<string, boolean>) : {};
  })();
  const qaOpen = QA_ITEMS.filter((i) => !openChecks[i.key]).length;
  const openIndex = open ? phaseIndex(open.status) : -1;
  const nextPhase = open ? PHASES[openIndex + 1] : undefined;
  const openClient = open ? clientById.get(open.client_id) : undefined;
  const openUrl = open ? safeHref(open.url) : null;

  return (
    <div>
      <PageHeader
        kicker="Operação"
        title={
          <>
            Sites <em>{sites.length}</em>
          </>
        }
        subtitle={`Do briefing ao ar, com QA antes de publicar. ${inProduction} ${inProduction === 1 ? 'site' : 'sites'} em produção agora.`}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {PHASES.map((p) => (
              <div key={p.key} className="rounded-xl bg-white/[0.03] px-3.5 py-3">
                <div className="label flex items-center gap-2">
                  <Dot state={p.dot} />
                  {p.label}
                </div>
                <div className="num mt-1.5 text-2xl text-ink">{count[p.key]}</div>
              </div>
            ))}
          </div>

          {rows.length === 0 ? (
            <EmptyState icon={<Globe className="h-5 w-5" />} title="Nenhum site ainda" text="Abra o primeiro ao lado: cliente, template e domínio. Ele nasce em Briefing." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <TH>Cliente</TH>
                  <TH>Site</TH>
                  <TH>Template</TH>
                  <TH>Domínio</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Endereço</TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const client = clientById.get(s.client_id);
                  const phase = PHASES[phaseIndex(s.status)];
                  const href = safeHref(s.url);
                  return (
                    <tr key={s.id} className="group transition-colors hover:bg-white/[0.03]">
                      <TD>
                        <span className="flex items-center gap-2 whitespace-nowrap text-ink2">
                          <span className="dot" style={{ background: client?.brand_color || '#FF5B1F' }} />
                          {clientName(s.client_id)}
                        </span>
                      </TD>
                      <TD>
                        <Link href={`/sites?s=${s.id}`} scroll={false} className="font-medium text-ink group-hover:text-accent">
                          {s.name}
                        </Link>
                      </TD>
                      <TD className="text-ink2">{templateLabel(s.template)}</TD>
                      <TD className="text-ink2">{s.domain || <span className="text-ink3">sem domínio</span>}</TD>
                      <TD>
                        <span className="flex items-center gap-2 whitespace-nowrap text-ink2">
                          <Dot state={phase?.dot || 'idle'} />
                          {phase?.label || s.status}
                        </span>
                      </TD>
                      <TD className="text-right">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-ink2 hover:text-accent" aria-label={`Abrir ${s.name} em nova aba`}>
                            Abrir <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <span className="text-xs text-ink3">fora do ar</span>
                        )}
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>

        <div className="space-y-6">
          <Section title="Novo site" kicker="Briefing">
            <Card className="p-5">
              <ActionForm action={createSiteAction} success="Site criado em Briefing" resetOnSuccess className="space-y-3">
                <Field label="Cliente" required>
                  <Select name="client_id" defaultValue="" required>
                    <option value="" disabled>
                      Escolha o cliente
                    </option>
                    {clients
                      .filter((c) => !['encerrado', 'perdido'].includes(c.status))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.company || c.contact_name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Nome do site" hint="Sem nome, usamos o domínio.">
                  <Input name="name" placeholder="Ex.: Site institucional" />
                </Field>
                <Field label="Template">
                  <Select name="template" defaultValue="institucional">
                    {TEMPLATES.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Domínio" hint="Ex.: nomedocliente.com.br">
                  <Input name="domain" placeholder="nomedocliente.com.br" autoCapitalize="none" spellCheck={false} />
                </Field>
                <SubmitButton className="w-full">Criar site</SubmitButton>
              </ActionForm>
            </Card>
          </Section>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-ink">Deploy pelo sistema</div>
              <Badge tone="info">próxima fase</Badge>
            </div>
            <p className="mt-2 text-xs text-ink2">Criar repositório no GitHub e publicar na Vercel daqui ainda não existe. Hoje o avanço de fase é manual e o endereço é digitado à mão.</p>
          </Card>
        </div>
      </div>

      {open && (
        <SiteDrawer title={open.name}>
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink2">
              <span className="dot" style={{ background: openClient?.brand_color || '#FF5B1F' }} />
              <span>{clientName(open.client_id)}</span>
              <Badge>{templateLabel(open.template)}</Badge>
            </div>

            <Stepper steps={PHASES.map((p) => p.label)} current={openIndex + 1} />

            {nextPhase ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.04] p-4">
                <div>
                  <div className="label">Próxima fase</div>
                  <div className="mt-1 text-sm font-medium text-ink">{nextPhase.label}</div>
                  {open.status === 'qa' && <div className="mt-0.5 text-xs text-ink3">{qaOpen === 0 ? 'QA completo.' : `${qaOpen} ${qaOpen === 1 ? 'item aberto' : 'itens abertos'} no QA.`}</div>}
                </div>
                <ActionButton
                  action={advanceSiteAction.bind(null, open.id)}
                  success={`Site em ${nextPhase.label}`}
                  confirm={open.status === 'qa' && qaOpen > 0 ? `O QA tem ${qaOpen} ${qaOpen === 1 ? 'item aberto' : 'itens abertos'}. Publicar mesmo assim?` : undefined}
                >
                  Avançar para {nextPhase.label}
                </ActionButton>
              </div>
            ) : (
              <div className="rounded-2xl bg-white/[0.04] p-4 text-sm text-ink2">Site em manutenção. Última fase do pipeline.</div>
            )}

            <section>
              <div className="label mb-2">QA antes de publicar</div>
              <QaChecklist key={open.id} siteId={open.id} items={QA_ITEMS} initial={openChecks} />
            </section>

            <section>
              <div className="label mb-2">Dados do site</div>
              <ActionForm action={updateSiteAction.bind(null, open.id)} success="Dados salvos" className="space-y-3">
                <Field label="Repositório" hint="Nome da pasta ou do repositório no GitHub">
                  <Input name="repo" defaultValue={open.repo || ''} autoCapitalize="none" spellCheck={false} />
                </Field>
                <Field label="Domínio">
                  <Input name="domain" defaultValue={open.domain || ''} placeholder="nomedocliente.com.br" autoCapitalize="none" spellCheck={false} />
                </Field>
                <Field label="Endereço no ar" hint="Só http ou https">
                  <Input name="url" defaultValue={open.url || ''} placeholder="https://nomedocliente.com.br" inputMode="url" autoCapitalize="none" spellCheck={false} />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <SubmitButton variant="subtle">Salvar dados</SubmitButton>
                  {openUrl && (
                    <a href={openUrl} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm text-ink2 hover:text-ink">
                      Abrir site <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </ActionForm>
            </section>

            <div className="flex items-center gap-2 text-xs text-ink3">
              <Badge tone="info">próxima fase</Badge>
              <span>Deploy real no GitHub e na Vercel</span>
            </div>
          </div>
        </SiteDrawer>
      )}
    </div>
  );
}
