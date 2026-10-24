import Link from 'next/link';
import { BarChart3, Megaphone, Plus, Search } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { getSecret } from '@/lib/config';
import { getActiveClient } from '@/lib/active-client';
import type { Campaign, CampaignMetric } from '@/lib/db/types';
import { brl, brlCents, cn, fmtDate, num, pct, relTime, slugify, sum, todayISO } from '@/lib/utils';
import { Badge, Button, Card, Dot, EmptyState, Example, PageHeader, PillTabs, Table, TD, TH } from '@/components/ui/primitives';
import { ActionButton, CopyButton } from '@/components/ui/client';
import { AreaTrend, Bars } from '@/components/ui/charts';
import { generateKitsAction, publishCampaignAction, researchAudienceAction } from '@/lib/actions/marketing';
import { deleteRowAction } from '@/lib/actions/common';
import { CampaignWizard, MetaConnection, ReportsPanel, type MetaConfig, type ReportItem, type SubItem } from './wizard';

export const metadata = { title: 'Tráfego' };

const TABS = ['campanhas', 'publico', 'conexao', 'relatorios'] as const;
type Tab = (typeof TABS)[number];

const STATUS: Record<Campaign['status'], { label: string; dot: 'idle' | 'rec' | 'wave' | 'done' | 'off' }> = {
  rascunho: { label: 'Rascunho', dot: 'idle' },
  kit_zero: { label: 'Kit Zero', dot: 'wave' },
  pronta: { label: 'Pronta', dot: 'wave' },
  pausada: { label: 'Pausada na Meta', dot: 'off' },
  ativa: { label: 'Ativa', dot: 'rec' },
  encerrada: { label: 'Encerrada', dot: 'done' },
};
const OBJECTIVE_LABEL: Record<string, string> = {
  mensagens: 'Mensagens no WhatsApp',
  leads: 'Leads',
  vendas: 'Vendas no site',
  trafego_perfil: 'Tráfego para o perfil',
  visualizacoes: 'Visualizações',
  engajamento: 'Engajamento',
};
const FUNNEL_LABEL: Record<string, string> = { TOPO: 'Topo', FUNDO: 'Fundo', AMBOS: 'Topo e fundo' };
const PARTE1_LABEL: Record<string, string> = {
  hook_falado: 'Gancho falado',
  texto_na_tela: 'Texto na tela',
  desenvolvimento: 'Desenvolvimento',
  cta_falada: 'Chamada falada',
  ultimo_frame: 'Último quadro',
  cards: 'Cards',
  headline_principal: 'Título da arte',
  complementar: 'Complemento',
  cta_arte: 'Chamada na arte',
};

const o = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const a = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const txt = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(txt).join(', ') : typeof v === 'object' ? Object.values(v as object).map(txt).join(' · ') : String(v));
const human = (k: string) => PARTE1_LABEL[k] || k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const btnLink = 'press focus-ring inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium glass text-ink hover:bg-white/[0.08]';

export default async function TrafegoPage({ searchParams }: { searchParams: Promise<{ t?: string; c?: string; nova?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const active = await getActiveClient();
  if (!active) {
    return <EmptyState icon={<Megaphone className="h-5 w-5" />} title="Escolha um cliente" text="O tráfego é montado dentro de um cliente. Escolha um no topo." action={<Button href="/clientes">Ver clientes</Button>} />;
  }
  const { client, brandKit } = active;
  const name = client.company || client.contact_name;
  const d = await db();

  const [campaigns, assets, items, subs, integrations, audienceRows, reportRows] = await Promise.all([
    d.list('campaigns', { where: { client_id: client.id }, orderBy: 'created_at', desc: true }),
    d.list('assets', { where: { client_id: client.id }, orderBy: 'created_at', desc: true }),
    d.list('content_items', { where: { client_id: client.id } }),
    d.list('report_subscriptions', { where: { client_id: client.id } }),
    d.list('integrations', { where: { client_id: client.id, provider: 'meta' }, limit: 1 }),
    d.list('research_reports', { where: { client_id: client.id, kind: 'publico' }, orderBy: 'created_at', desc: true, limit: 1 }),
    d.list('research_reports', { where: { client_id: client.id, kind: 'relatorio' }, orderBy: 'created_at', desc: true, limit: 20 }),
  ]);

  const camp = sp.c ? campaigns.find((c) => c.id === sp.c) : undefined;
  const wanted = (TABS as readonly string[]).includes(sp.t || '') ? (sp.t as Tab) : null;
  const tab: Tab = wanted || (sp.c || sp.nova ? 'campanhas' : !client.meta_ad_account_id && campaigns.length === 0 ? 'conexao' : 'campanhas');
  const showWizard = sp.nova === '1' || campaigns.length === 0;

  const tabs = [
    { href: '/marketing/trafego?t=campanhas', label: 'Campanhas', count: campaigns.length },
    { href: '/marketing/trafego?t=publico', label: 'Público' },
    { href: '/marketing/trafego?t=conexao', label: 'Conexão Meta' },
    { href: '/marketing/trafego?t=relatorios', label: 'Relatórios', count: subs.length },
  ];

  /* Cabeçalho e ação principal conforme a vista */
  let headerAction: React.ReactNode = null;
  if (tab === 'campanhas') {
    if (camp) {
      headerAction = (
        <Button variant="ghost" href="/marketing/trafego?t=campanhas">
          Todas as campanhas
        </Button>
      );
    } else if (sp.nova === '1' && campaigns.length > 0) {
      headerAction = (
        <Button variant="ghost" href="/marketing/trafego?t=campanhas">
          Cancelar
        </Button>
      );
    } else if (campaigns.length > 0) {
      headerAction = (
        <Button href="/marketing/trafego?t=campanhas&nova=1">
          <Plus className="h-4 w-4" /> Nova campanha
        </Button>
      );
    }
  }

  return (
    <div className="space-y-2">
      <PageHeader
        kicker={`Tráfego · ${name}`}
        title={
          <>
            Do briefing <em>ao anúncio no ar</em>
          </>
        }
        subtitle="Conexão com a Meta, pesquisa de público, Kit Zero, kits completos e relatórios por e-mail."
        actions={headerAction}
      />
      <PillTabs tabs={tabs} current={`/marketing/trafego?t=${tab}`} className="mb-4" />

      {tab === 'campanhas' && (
        <>
          {sp.c && !camp && <p className="mb-4 text-sm text-warn">Campanha não encontrada neste cliente.</p>}
          {camp ? (
            <CampaignDetail camp={camp} metrics={await d.list('campaign_metrics_daily', { where: { campaign_id: camp.id }, orderBy: 'day' })} assetCount={a(camp.creative_ids).length} />
          ) : showWizard ? (
            <>
              {(!brandKit || brandKit.status !== 'aprovado') && (
                <p className="mb-4 text-xs text-ink3">
                  {brandKit ? 'O BrandKit ainda não foi aprovado.' : 'Este cliente ainda não tem BrandKit.'} O Kit Zero usa o cadastro e o contexto disponíveis.{' '}
                  <Link href="/marketing/brand" className="text-accent hover:underline">
                    Abrir Brand
                  </Link>
                </p>
              )}
              <CampaignWizard
                clientId={client.id}
                clientName={name}
                today={todayISO()}
                defaults={{
                  cidade: str(o(o(audienceRows[0]?.findings).praca_sugerida).cidade) || client.city || '',
                  whatsapp: client.whatsapp || '',
                  raio: Number(o(o(audienceRows[0]?.findings).praca_sugerida).raio_km) || 40,
                }}
                videos={assets
                  .filter((x) => x.kind === 'video_bruto' || x.mime?.startsWith('video'))
                  .map((x) => ({ id: x.id, name: x.name, size: x.size_bytes || 0, source: x.source || 'upload' }))}
                pieces={items
                  .filter((i) => ['aprovado', 'agendado', 'publicado'].includes(i.status))
                  .map((i) => ({ id: i.id, hook: i.hook, format: i.format, series: i.series || '' }))}
              />
            </>
          ) : (
            <CampaignList campaigns={campaigns} />
          )}
        </>
      )}

      {tab === 'publico' && <AudienceTab clientId={client.id} report={audienceRows[0]} />}

      {tab === 'conexao' && (
        <ConnectionTab
          clientId={client.id}
          adAccountId={client.meta_ad_account_id || ''}
          integration={integrations[0]}
          hasToken={!!getSecret('metaAccessToken')}
          whatsapp={client.whatsapp || ''}
        />
      )}

      {tab === 'relatorios' && (
        <ReportsPanel
          clientId={client.id}
          subs={subs.map<SubItem>((s) => ({ id: s.id, campaign_id: s.campaign_id || null, audience: s.audience, emails: s.emails || [], frequency: s.frequency, send_hour: s.send_hour, active: s.active }))}
          campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
          reports={latestReports(reportRows)}
          hasResend={!!getSecret('resendApiKey')}
          defaultEmails={client.report_emails?.length ? client.report_emails : client.email ? [client.email] : []}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dados                                                               */
/* ------------------------------------------------------------------ */

/** Uma prévia por assinatura: a mais recente que tenha HTML. */
function latestReports(rows: { id: string; title: string; created_at: string; findings: Record<string, unknown> }[]): ReportItem[] {
  const seen = new Set<string>();
  const out: ReportItem[] = [];
  for (const r of rows) {
    const f = o(r.findings);
    const sid = str(f.subscription_id);
    if (!sid || seen.has(sid) || !str(f.html)) continue;
    seen.add(sid);
    out.push({
      id: r.id,
      subscription_id: sid,
      title: r.title,
      created_at: r.created_at,
      html: str(f.html),
      is_example: !!f.is_example,
      sent_at: str(f.sent_at) || null,
      sent_to: a(f.sent_to).map(String),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lista de campanhas                                                  */
/* ------------------------------------------------------------------ */

function CampaignList({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <TH>Campanha</TH>
          <TH>Status</TH>
          <TH className="text-right">Verba</TH>
          <TH>Período</TH>
          <TH className="text-right">Kits</TH>
          <TH>Atualizada</TH>
          <TH />
        </tr>
      </thead>
      <tbody>
        {campaigns.map((c) => {
          const kz = o(c.kit_zero);
          const kits = a(c.kits).length;
          return (
            <tr key={c.id} className="hover:bg-white/[0.02]">
              <TD className="max-w-[280px]">
                <Link href={`/marketing/trafego?t=campanhas&c=${c.id}`} className="block truncate font-medium text-ink hover:text-accent">
                  {c.name}
                </Link>
                <div className="truncate text-xs text-ink3">
                  {OBJECTIVE_LABEL[c.objective || ''] || c.objective || 'Sem objetivo'}
                  {c.funnel ? ` · ${FUNNEL_LABEL[c.funnel]}` : ''}
                </div>
              </TD>
              <TD>
                <span className="inline-flex items-center gap-2 whitespace-nowrap text-ink2">
                  <Dot state={STATUS[c.status].dot} /> {STATUS[c.status].label}
                  {kz.is_example && <Badge tone="warn">exemplo</Badge>}
                </span>
              </TD>
              <TD className="num whitespace-nowrap text-right text-base">{c.budget?.total ? brl(c.budget.total) : '–'}</TD>
              <TD className="whitespace-nowrap text-ink2">{c.starts_on ? `${fmtDate(`${c.starts_on}T12:00:00Z`)} a ${c.ends_on ? fmtDate(`${c.ends_on}T12:00:00Z`) : '–'}` : '–'}</TD>
              <TD className="num text-right text-base">{kits || '–'}</TD>
              <TD className="whitespace-nowrap text-ink2">{relTime(c.updated_at || c.created_at)}</TD>
              <TD className="text-right">
                <Button variant="subtle" size="sm" href={`/marketing/trafego?t=campanhas&c=${c.id}`}>
                  Abrir
                </Button>
              </TD>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* Público                                                             */
/* ------------------------------------------------------------------ */

function AudienceTab({ clientId, report }: { clientId: string; report?: { created_at: string; findings: Record<string, unknown> } }) {
  const f = o(report?.findings);
  const personas = a(f.personas).map(o);
  const saturated = a(f.angulos_saturados).map(txt);
  const praca = o(f.praca_sugerida);
  const sources = a(f.fontes_a_consultar).map(o);
  const action = (
    <ActionButton action={researchAudienceAction.bind(null, clientId)} success="Pesquisa de público pronta">
      <Search className="h-4 w-4" />
      {report ? 'Atualizar pesquisa' : 'Pesquisar público'}
    </ActionButton>
  );

  if (!report || personas.length === 0) {
    return (
      <EmptyState
        icon={<Search className="h-5 w-5" />}
        title="Nenhuma pesquisa de público ainda"
        text="O agente cruza o segmento, a praça e o diagnóstico do cliente e devolve personas, ângulos saturados e onde validar. Nenhum número é inventado."
        action={action}
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="label">Personas</div>
            <h2 className="display text-xl text-ink">
              {personas.length} perfis para testar
              <Example show={!!f.is_example} />
            </h2>
            <p className="mt-1 text-xs text-ink3">Pesquisa feita {relTime(report.created_at)}.</p>
          </div>
          {action}
        </div>
        {personas.map((p, i) => (
          <Card key={i} className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="display text-xl text-ink">{str(p.nome) || `Persona ${i + 1}`}</h3>
              {str(p.faixa_etaria) && <Badge>{str(p.faixa_etaria)}</Badge>}
            </div>
            <div className="mt-4 grid gap-5 md:grid-cols-3">
              <PersonaList title="Dores" items={a(p.dores).map(txt)} />
              <PersonaList title="Desejos" items={a(p.desejos).map(txt)} />
              <PersonaList title="Objeções" items={a(p.objecoes).map(txt)} />
            </div>
          </Card>
        ))}
      </div>

      <aside className="space-y-4">
        {(str(praca.cidade) || str(praca.justificativa)) && (
          <Card className="p-5">
            <div className="label mb-2">Praça sugerida</div>
            <div className="display text-2xl text-ink">{str(praca.cidade) || 'A definir'}</div>
            {praca.raio_km != null && <div className="num mt-1 text-lg text-accent">{num(Number(praca.raio_km) || 0)} km de raio</div>}
            {str(praca.justificativa) && <p className="mt-3 text-sm leading-relaxed text-ink2">{str(praca.justificativa)}</p>}
            <Button variant="subtle" size="sm" href="/marketing/trafego?t=campanhas&nova=1" className="mt-4">
              Usar na campanha
            </Button>
          </Card>
        )}
        {saturated.length > 0 && (
          <Card className="p-5">
            <div className="label mb-3">Ângulos saturados, evitar</div>
            <ul className="space-y-2">
              {saturated.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-ink2">
                  <Dot state="err" className="mt-1.5" />
                  {s}
                </li>
              ))}
            </ul>
          </Card>
        )}
        {sources.length > 0 && (
          <Card className="p-5">
            <div className="label mb-3">Onde validar</div>
            <ul className="space-y-3">
              {sources.map((s, i) => (
                <li key={i}>
                  <div className="text-sm font-medium text-ink">{str(s.titulo)}</div>
                  {str(s.onde) && <div className="text-xs text-accent">{str(s.onde)}</div>}
                  {str(s.por_que) && <p className="mt-0.5 text-xs leading-relaxed text-ink3">{str(s.por_que)}</p>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </aside>
    </div>
  );
}

function PersonaList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="label mb-2">{title}</div>
      {items.length === 0 ? (
        <p className="text-sm text-ink3">–</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="text-sm leading-relaxed text-ink2">
              {it}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Conexão Meta                                                        */
/* ------------------------------------------------------------------ */

function ConnectionTab({ clientId, adAccountId, integration, hasToken, whatsapp }: { clientId: string; adAccountId: string; integration?: { status: string; config?: Record<string, unknown> | null; connected_at?: string | null }; hasToken: boolean; whatsapp: string }) {
  const cfg = o(integration?.config);
  const config: MetaConfig = {
    business_id: str(cfg.business_id),
    page_id: str(cfg.page_id),
    instagram_id: str(cfg.instagram_id),
    pixel_id: str(cfg.pixel_id),
    whatsapp: str(cfg.whatsapp) || whatsapp,
    checks: o(cfg.checks),
  };
  const status = integration?.status || 'pendente';
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="p-6 lg:col-span-2">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="label">Conexão Meta</div>
            <h2 className="display mt-1 text-2xl text-ink">Conta, página, pixel e prontidão</h2>
          </div>
          <Badge tone={status === 'conectado' ? 'ok' : status === 'erro' ? 'err' : 'warn'}>{status === 'conectado' ? 'Pronta para subir' : status === 'erro' ? 'Com erro' : 'Pendente'}</Badge>
        </div>
        <MetaConnection clientId={clientId} adAccountId={adAccountId} config={config} hasToken={hasToken} />
      </Card>
      <aside className="space-y-4">
        <Card className="p-5">
          <div className="label mb-3">Acesso de parceiro</div>
          <ol className="space-y-3 text-sm text-ink2">
            {[
              'No Business Manager do cliente, abra Usuários e Parceiros e adicione o Business ID do Studio.',
              'Compartilhe a conta de anúncios, a página e o pixel com o parceiro.',
              'Cole os identificadores ao lado e marque o que já está pronto.',
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="num mt-0.5 text-base text-accent">{i + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card className="p-5">
          <div className="label mb-3">Como sobe a campanha</div>
          <p className="text-sm leading-relaxed text-ink2">
            {hasToken
              ? 'Com o token configurado, "Publicar no Meta" cria a campanha pausada na conta do cliente. Conjuntos e anúncios sobem a partir da estrutura exportada.'
              : 'Sem o token da Meta, exporte a estrutura em JSON na campanha e suba manualmente no Gerenciador de Anúncios.'}
          </p>
        </Card>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detalhe da campanha                                                 */
/* ------------------------------------------------------------------ */

function CampaignDetail({ camp, metrics, assetCount }: { camp: Campaign; metrics: CampaignMetric[]; assetCount: number }) {
  const kz = o(camp.kit_zero);
  const kits = a(camp.kits).map(o);
  const structure = o(camp.structure);
  const offer = o(camp.offer);
  const geo = o(camp.geo);
  const st = STATUS[camp.status];
  const hasKz = !!camp.kit_zero;
  const published = !!camp.meta_campaign_id;
  const del = deleteRowAction.bind(null, 'campaigns', camp.id, ['/marketing/trafego', '/marketing']);
  const exportHref = `data:application/json;charset=utf-8,${encodeURIComponent(
    JSON.stringify(
      {
        campanha: {
          nome: camp.name,
          objetivo: OBJECTIVE_LABEL[camp.objective || ''] || camp.objective,
          funil: camp.funnel,
          oferta: camp.offer,
          praca: camp.geo,
          verba: camp.budget,
          periodo: { inicio: camp.starts_on, fim: camp.ends_on },
          status: camp.status,
          meta_campaign_id: camp.meta_campaign_id || null,
        },
        kit_zero: camp.kit_zero,
        kits: camp.kits,
        estrutura: camp.structure,
      },
      null,
      2,
    ),
  )}`;
  const destino = offer.destino === 'url' ? str(offer.url) || 'Site a definir' : `WhatsApp ${str(offer.whatsapp) || 'a definir'}`;
  const summary: [string, string][] = [
    ['Objetivo', OBJECTIVE_LABEL[camp.objective || ''] || camp.objective || '–'],
    ['Funil', camp.funnel ? FUNNEL_LABEL[camp.funnel] : '–'],
    ['Oferta', [str(offer.texto), str(offer.preco), str(offer.oferta_real)].filter(Boolean).join(' · ') || '–'],
    ['Destino', destino],
    ['Praça', str(geo.cidade) ? `${str(geo.cidade)}, ${num(Number(geo.raio_km) || 0)} km, ${num(Number(geo.idade_min) || 0)} a ${num(Number(geo.idade_max) || 0)} anos` : '–'],
    ['Verba', camp.budget?.total ? `${brl(camp.budget.total)} no total, ${brl(camp.budget.daily || 0)} por dia` : '–'],
    ['Período', camp.starts_on ? `${fmtDate(`${camp.starts_on}T12:00:00Z`)} a ${camp.ends_on ? fmtDate(`${camp.ends_on}T12:00:00Z`) : '–'}` : '–'],
    ['Criativos', `${assetCount} ${assetCount === 1 ? 'selecionado' : 'selecionados'}`],
    ['ID na Meta', camp.meta_campaign_id || 'Ainda não publicada'],
  ];

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <div className="label">
          {OBJECTIVE_LABEL[camp.objective || ''] || camp.objective || 'Campanha'}
          {camp.funnel ? ` · ${FUNNEL_LABEL[camp.funnel]}` : ''}
        </div>
        <h2 className="display mt-1 text-3xl text-ink md:text-4xl">{camp.name}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink2">
          <span className="inline-flex items-center gap-2">
            <Dot state={st.dot} /> {st.label}
          </span>
          {camp.budget?.total ? <span>{brl(camp.budget.total)} no total</span> : null}
          <span>Criada {relTime(camp.created_at)}</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {hasKz ? (
            <KitZeroCard kz={kz} />
          ) : (
            <EmptyState
              title="O Kit Zero não foi gerado"
              text="A criação foi interrompida antes do Kit Zero. Exclua este rascunho e crie a campanha de novo no assistente."
              action={
                <ActionButton variant="glass" action={del} confirm="Excluir este rascunho?" success="Rascunho excluído" afterPath="/marketing/trafego?t=campanhas">
                  Excluir rascunho
                </ActionButton>
              }
            />
          )}

          {kits.length > 0 && (
            <section className="space-y-4" aria-label="Kits completos">
              <div>
                <div className="label">Kits completos</div>
                <h3 className="display text-2xl text-ink">
                  {kits.length} {kits.length === 1 ? 'kit pronto' : 'kits prontos'} para subir
                  <Example show={!!structure.kits_example} />
                </h3>
              </div>
              {kits.map((k, i) => (
                <KitCard key={i} k={k} index={i} />
              ))}
            </section>
          )}

          <MetricsCard metrics={metrics} />
        </div>

        <aside className="space-y-4">
          <Card className="space-y-3 p-5">
            <div className="label">Próximo passo</div>
            {hasKz && kits.length === 0 && (
              <>
                <p className="text-sm text-ink2">Revise o Kit Zero ao lado. Se estiver certo, aprove e o agente escreve os kits completos.</p>
                <ActionButton className="w-full" action={generateKitsAction.bind(null, camp.id)} success="Kits gerados">
                  Aprovar Kit Zero e gerar kits
                </ActionButton>
              </>
            )}
            {hasKz && kits.length > 0 && (
              <ActionButton className="w-full" variant="glass" action={generateKitsAction.bind(null, camp.id)} confirm="Gerar de novo substitui os kits atuais. Continuar?" success="Kits gerados de novo">
                Gerar kits de novo
              </ActionButton>
            )}
            {published ? (
              <Button className="w-full" variant="glass" disabled>
                Publicada pausada na Meta
              </Button>
            ) : (
              <ActionButton
                className="w-full"
                variant={kits.length > 0 ? 'primary' : 'glass'}
                action={publishCampaignAction.bind(null, camp.id)}
                confirm={kits.length > 0 ? 'Criar esta campanha pausada na conta de anúncios Meta?' : 'Os kits completos ainda não foram gerados. Criar a campanha pausada na Meta mesmo assim?'}
                success="Campanha criada pausada na Meta"
              >
                Publicar no Meta (pausada)
              </ActionButton>
            )}
            <a href={exportHref} download={`${slugify(camp.name) || 'campanha'}.json`} className={cn(btnLink, 'w-full')}>
              Exportar estrutura JSON
            </a>
            <ActionButton className="w-full" variant="ghost" size="sm" action={del} confirm="Excluir esta campanha? Kit Zero e kits serão apagados." success="Campanha excluída" afterPath="/marketing/trafego?t=campanhas">
              Excluir campanha
            </ActionButton>
          </Card>

          <Card className="p-5">
            <div className="label mb-3">Resumo</div>
            <dl className="space-y-3 text-sm">
              {summary.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-ink3">{k}</dt>
                  <dd className="mt-0.5 break-words text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {(str(structure.sugestao_subida) || str(structure.formato)) && (
            <Card className="p-5">
              <div className="label mb-2">Como subir</div>
              {str(structure.sugestao_subida) && <p className="text-sm leading-relaxed text-ink2">{str(structure.sugestao_subida)}</p>}
              {str(structure.formato) && <p className="mt-3 text-xs text-ink3">Formato dos criativos: {str(structure.formato)}</p>}
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function KitZeroCard({ kz }: { kz: Record<string, any> }) {
  const briefing = a(kz.briefing).map(txt);
  const faltando = a(kz.faltando).map(txt);
  const kits = a(kz.kits).map(o);
  return (
    <Card className="space-y-6 p-6">
      <div>
        <div className="label">Kit Zero</div>
        <h3 className="display mt-1 text-2xl text-ink">
          Briefing, lacunas e ângulos
          <Example show={!!kz.is_example} />
        </h3>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <div className="label mb-2">Briefing</div>
          {briefing.length === 0 ? (
            <p className="text-sm text-ink3">Sem briefing registrado.</p>
          ) : (
            <ul className="space-y-1.5">
              {briefing.map((b, i) => (
                <li key={i} className="text-sm leading-relaxed text-ink2">
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="label mb-2">Falta antes de subir</div>
          {faltando.length === 0 ? (
            <p className="text-sm text-ink2">Nada pendente.</p>
          ) : (
            <ul className="space-y-1.5">
              {faltando.map((f, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink">
                  <Dot state="wave" className="mt-1.5" />
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {kits.length > 0 && (
        <div>
          <div className="label mb-2">Ângulos propostos</div>
          <Table className="border-0 bg-transparent">
            <thead>
              <tr>
                <TH className="w-10">Kit</TH>
                <TH>Persona</TH>
                <TH>Ângulo</TH>
                <TH className="text-right">Consciência</TH>
                <TH>Funil</TH>
                <TH>Gancho</TH>
                <TH>Promessa</TH>
              </tr>
            </thead>
            <tbody>
              {kits.map((k, i) => (
                <tr key={i} className="align-top">
                  <TD className="num text-base text-accent">{str(k.n) || i + 1}</TD>
                  <TD className="min-w-[150px] text-ink2">{str(k.persona)}</TD>
                  <TD className="min-w-[120px] font-medium">{str(k.angulo)}</TD>
                  <TD className="num text-right text-base">{str(k.consciencia) || '–'}</TD>
                  <TD>
                    <Badge>{FUNNEL_LABEL[str(k.funil)] || str(k.funil) || '–'}</Badge>
                  </TD>
                  <TD className="min-w-[110px] text-ink2">{str(k.hook_formato)}</TD>
                  <TD className="min-w-[200px] text-ink2">{str(k.promessa)}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-ink3">Consciência vai de 1 (não sabe do problema) a 5 (pronto para comprar).</p>
        </div>
      )}

      {str(kz.estrutura) && (
        <div>
          <div className="label mb-2">Estrutura da campanha</div>
          <p className="text-sm leading-relaxed text-ink2">{str(kz.estrutura)}</p>
        </div>
      )}
    </Card>
  );
}

function KitCard({ k, index }: { k: Record<string, any>; index: number }) {
  const parte1 = Object.entries(o(k.parte1));
  const titulos = a(k.titulos).map(txt);
  const descricoes = a(k.descricoes).map(o);
  const pareamento = a(k.pareamento).map(txt);
  return (
    <Card className="space-y-5 p-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="display text-2xl text-accent">Kit {str(k.n) || index + 1}</span>
          {str(k.angulo) && <Badge>{str(k.angulo)}</Badge>}
          {str(k.funil) && <Badge tone="accent">{FUNNEL_LABEL[str(k.funil)] || str(k.funil)}</Badge>}
          {str(k.consciencia) && <Badge>Consciência {str(k.consciencia)}</Badge>}
        </div>
        {str(k.persona) && <p className="mt-2 text-sm text-ink2">Persona: {str(k.persona)}</p>}
      </div>

      {parte1.length > 0 && (
        <div>
          <div className="label mb-2">Parte 1 do criativo</div>
          <dl className="space-y-2.5 rounded-2xl border border-white/[0.07] p-4">
            {parte1.map(([key, val]) => (
              <div key={key} className="grid gap-1 sm:grid-cols-[150px_1fr] sm:gap-4">
                <dt className="text-xs text-ink3">{human(key)}</dt>
                <dd className="text-sm text-ink">
                  {Array.isArray(val) ? (
                    <ol className="list-decimal space-y-1 pl-4 marker:text-ink3">
                      {val.map((v, i) => (
                        <li key={i}>{txt(v)}</li>
                      ))}
                    </ol>
                  ) : (
                    txt(val)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {titulos.length > 0 && (
        <div>
          <div className="label mb-2">Títulos</div>
          <ul className="space-y-2">
            {titulos.map((t, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] px-3.5 py-2.5">
                <span className="text-sm text-ink">
                  <span className="num mr-2 text-ink3">T{i + 1}</span>
                  {t}
                </span>
                <CopyButton text={t} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {descricoes.length > 0 && (
        <div>
          <div className="label mb-2">Descrições</div>
          <ul className="space-y-2">
            {descricoes.map((dsc, i) => (
              <li key={i} className="rounded-xl border border-white/[0.07] p-3.5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-xs text-ink3">
                    <span className="num text-sm">D{i + 1}</span>
                    {str(dsc.hook) && <Badge>{str(dsc.hook)}</Badge>}
                  </span>
                  <CopyButton text={str(dsc.texto)} />
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{str(dsc.texto)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pareamento.length > 0 && (
        <div>
          <div className="label mb-2">Pareamento</div>
          <ul className="space-y-1.5">
            {pareamento.map((p, i) => (
              <li key={i} className="text-sm text-ink2">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function MetricsCard({ metrics }: { metrics: CampaignMetric[] }) {
  if (metrics.length === 0) {
    return (
      <Card className="p-6">
        <div className="label">Métricas</div>
        <div className="mt-3 grid place-items-center gap-3 rounded-2xl border border-dashed border-white/15 px-6 py-10 text-center">
          <BarChart3 className="h-5 w-5 text-ink3" />
          <p className="max-w-sm text-sm text-ink2">Sem métricas ainda. Elas aparecem aqui assim que a campanha estiver no ar com a conta de anúncios conectada.</p>
        </div>
      </Card>
    );
  }
  const spend = sum(metrics, (m) => m.spend);
  const results = sum(metrics, (m) => m.results);
  const impressions = sum(metrics, (m) => m.impressions);
  const clicks = sum(metrics, (m) => m.clicks);
  const series = metrics.map((m) => ({ dia: fmtDate(`${m.day.slice(0, 10)}T12:00:00Z`), investimento: Number(m.spend) || 0, resultados: Number(m.results) || 0 }));
  const recent = [...metrics].reverse().slice(0, 14);
  return (
    <Card className="space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Métricas</div>
          <h3 className="display text-2xl text-ink">Dia a dia da campanha</h3>
        </div>
        <span className="text-xs text-ink3">{metrics.length} {metrics.length === 1 ? 'dia' : 'dias'} medidos</span>
      </div>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {(
          [
            ['Investido', brl(spend)],
            ['Resultados', num(results)],
            ['Custo por resultado', results ? brlCents(spend / results) : '–'],
            ['CTR', impressions ? pct(clicks / impressions) : '–'],
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-ink3">{k}</dt>
            <dd className="num mt-1 text-2xl text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs text-ink2">Investimento por dia (R$)</div>
          <AreaTrend data={series} xKey="dia" yKey="investimento" name="Investimento (R$)" height={190} />
        </div>
        <div>
          <div className="mb-1 text-xs text-ink2">Resultados por dia</div>
          <Bars data={series} xKey="dia" yKey="resultados" name="Resultados" height={190} highlightLast />
        </div>
      </div>
      <Table className="border-0 bg-transparent">
        <thead>
          <tr>
            <TH>Dia</TH>
            <TH className="text-right">Investido</TH>
            <TH className="text-right">Impressões</TH>
            <TH className="text-right">Cliques</TH>
            <TH className="text-right">Resultados</TH>
            <TH className="text-right">Custo por resultado</TH>
          </tr>
        </thead>
        <tbody>
          {recent.map((m) => (
            <tr key={m.id} className="hover:bg-white/[0.02]">
              <TD className="whitespace-nowrap text-ink2">{fmtDate(`${m.day.slice(0, 10)}T12:00:00Z`)}</TD>
              <TD className="num whitespace-nowrap text-right text-base">{brlCents(m.spend)}</TD>
              <TD className="num text-right text-base text-ink2">{num(m.impressions)}</TD>
              <TD className="num text-right text-base text-ink2">{num(m.clicks)}</TD>
              <TD className="num text-right text-base">{num(m.results)}</TD>
              <TD className="num whitespace-nowrap text-right text-base">{m.results ? brlCents(m.spend / m.results) : '–'}</TD>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
