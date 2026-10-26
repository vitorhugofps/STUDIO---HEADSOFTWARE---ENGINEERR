import Link from 'next/link';
import { FolderOpen } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import type { Asset, Client } from '@/lib/db/types';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, PillTabs, Progress, Section, Select, Table, TD, TH, Textarea } from '@/components/ui/primitives';
import { ActionForm, CopyButton, SubmitButton } from '@/components/ui/client';
import { generateImageFormAction } from '@/lib/actions/integrations';
import { hasOpenAIKey } from '@/lib/ai/openai';
import { Dropzone, FileKindIcon } from '@/components/ui/dropzone';
import { fmtDate, num } from '@/lib/utils';

export const metadata = { title: 'Biblioteca' };

type SP = { t?: string; client?: string; kind?: string };

const TABS = [
  { key: 'assets', label: 'Assets' },
  { key: 'templates', label: 'Templates' },
  { key: 'skills', label: 'Skills' },
  { key: 'prompts', label: 'Prompts' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/* ================================================================== */
/* ASSETS                                                              */
/* ================================================================== */

const ASSET_KIND: Record<string, string> = {
  logo: 'Logo',
  foto: 'Foto',
  video_bruto: 'Vídeo bruto',
  audio: 'Áudio',
  manual: 'Manual',
  brandbook: 'Brandbook',
  imagem_ia: 'Imagem (IA)',
  documento: 'Documento',
  drive_link: 'Link do Drive',
  referencia: 'Referência',
  link: 'Link',
  arquivo: 'Arquivo',
};
const kindLabel = (k: string) => ASSET_KIND[k] || k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Arquivo do próprio servidor ou endereço http(s). O resto não vira link. */
function assetHref(url?: string | null) {
  if (!url) return null;
  if (url.startsWith('/api/files/')) return url;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function sizeLabel(bytes?: number | null) {
  if (!bytes) return null;
  return bytes >= 1024 * 1024 ? `${num(bytes / (1024 * 1024), 1)} MB` : `${num(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

const PAGE_SIZE = 60;

/* ================================================================== */
/* TEMPLATES (séries do feed, conforme o plano de marketing)           */
/* ================================================================== */

const SERIES = [
  { name: 'DECUPAGEM', why: 'Case com número', format: 'Carrossel de 8 a 10 cards e Reel de 60 a 90 s', template: 'Fundo névoa, número do case gigante em Foun preta, vidro só numa faixa lateral com o ponto.', bg: '#DAD6D1', fg: '#0A0A0A' },
  { name: 'BASTIDOR', why: 'Confiança e alcance', format: 'Reel cru de 15 a 30 s', template: 'Frame real da diária, cantoneiras e selo REC com timecode, título em Foun na base.', bg: '#141414', fg: '#F5F5F3' },
  { name: 'PLANO', why: 'Opinião e autoridade', format: 'Reel falado ou frame de cinema', template: 'Preto, vidro com o ponto no topo, uma frase em Foun na base.', bg: '#0A0A0A', fg: '#F5F5F3' },
  { name: 'DIAGNÓSTICO', why: 'Educação que vende', format: 'Carrossel de perguntas ou checklist', template: 'Capa preta com número em Foun laranja e vidro à direita. Cards internos em grafite, numeração de 01 a 05.', bg: '#0A0A0A', fg: '#FF5B1F' },
  { name: 'PALCO', why: 'Show business', format: 'Reel de show e carrossel do kit', template: 'Luz de palco, vidro na base com o ponto nascendo, título no topo. Kit em fundo branco com checklist.', bg: '#0A0A0A', fg: '#F5F5F3' },
  { name: 'NÚMERO NA MESA', why: 'Tráfego e resultado', format: 'Carrossel de dados', template: 'Grafite, um número gigante em laranja por card, barra do dado e fonte no rodapé.', bg: '#1C1C1C', fg: '#FF5B1F' },
  { name: 'LAB', why: 'Autoral de motion', format: 'Reel de 10 a 15 s', template: 'Preto, faixa de vidro que multiplica o ponto, frase curta centralizada.', bg: '#0A0A0A', fg: '#F5F5F3' },
] as const;

const WEEK = [
  { day: 'Segunda', what: 'Reel BASTIDOR', at: '12h' },
  { day: 'Terça', what: 'Carrossel NÚMERO NA MESA ou DIAGNÓSTICO', at: '18h' },
  { day: 'Quarta', what: 'Reel PLANO', at: '12h' },
  { day: 'Quinta', what: 'Carrossel DECUPAGEM ou PALCO', at: '18h' },
  { day: 'Sexta', what: 'Reel PALCO ou case', at: '18h' },
] as const;

const MIX = [
  { label: 'Prova e case', pct: 30 },
  { label: 'Educativo', pct: 25 },
  { label: 'Bastidor de set e palco', pct: 20 },
  { label: 'Opinião', pct: 15 },
  { label: 'Oferta', pct: 10 },
] as const;

/* ================================================================== */
/* SKILLS                                                              */
/* ================================================================== */

const SKILLS = [
  { name: 'marketing-studio-impacto', does: 'Pauta, posts, carrosséis, Reels, stories, anúncios, cases, prospecção, propostas e radar, na voz do Studio.', module: 'Marketing, Pesquisa' },
  { name: 'anuncios-meta-andromeda', does: 'Kits de anúncios para Meta Ads pensados para o motor Andrômeda, com diversidade criativa real.', module: 'Marketing · Tráfego' },
  { name: 'orcamento-studio-impacto', does: 'Orçamento em PDF para cliente novo: escopo, preços e linguagem da marca.', module: 'Vendas' },
  { name: 'revisao-design-anti-ia', does: 'Revisão de tela e site antes da entrega, para tirar qualquer sinal de visual genérico.', module: 'Sites' },
  { name: 'hyperframes-economico', does: 'Vídeo em HTML renderizado em MP4, com motion graphics, de roteiro a render com poucos tokens.', module: 'Marketing · Vídeos' },
  { name: 'impeccable', does: 'Padrão de design para sites, telas e peças em HTML: tipografia, cor, layout, motion e polimento.', module: 'Sites' },
  { name: 'emil-design-eng', does: 'Engenharia de design: detalhes invisíveis, polimento de interface e decisões de animação.', module: 'Sites' },
  { name: 'animate', does: 'Método para construir uma animação do zero: propósito, propriedades, curva, duração e saída.', module: 'Sites, Marketing · Vídeos' },
  { name: 'apple-design', does: 'Design de interface e movimento fluido da Apple para a web: molas, gestos, materiais e reduced motion.', module: 'Sites' },
] as const;

/* ================================================================== */
/* PROMPTS: Método Impacto, 13 camadas                                 */
/* ================================================================== */

const LAYERS = [
  { name: 'Papel', what: 'Quem a IA é neste trabalho.', model: 'PAPEL: você é [direção de arte | redator | roteirista | desenvolvedor de sites] do Studio Impacto. Entrega no padrão de uma agência grande, na voz da marca.' },
  { name: 'Contexto do cliente', what: 'Quem é o cliente e em que momento ele está.', model: 'CONTEXTO: [cliente], [segmento], [cidade]. Momento: [o que trava hoje]. Fonte: a ficha do cliente no sistema.' },
  { name: 'Objetivo e público', what: 'O que a peça faz e para quem.', model: 'OBJETIVO: [uma ação só]. PÚBLICO: [quem decide], [onde está], [o que já sabe].' },
  { name: 'Referências', what: 'O que já existe e serve de régua.', model: 'REFERÊNCIAS: [3 peças ou sites]. Para cada uma: o que aproveitar e o que evitar.' },
  { name: 'Assets', what: 'O material real disponível.', model: 'ASSETS: [logo em vetor, fotos e vídeos reais, números]. Use só o que está listado. Onde faltar, escreva [N] e peça.' },
  { name: 'Especificação', what: 'Formato, medida e limite técnico.', model: 'ESPECIFICAÇÃO: [formato e proporção], [resolução], [limite de palavras], [prazo].' },
  { name: 'Obrigatório e proibido', what: 'O que entra sempre e o que nunca entra.', model: 'OBRIGATÓRIO: [itens]. PROIBIDO: vocabulário proibido da marca, travessão, número inventado, modelo de câmera, depoimento sem autorização.' },
  { name: 'Direção estética', what: 'O olhar da peça, em decisões e não em adjetivos.', model: 'DIREÇÃO ESTÉTICA: [luz], [paleta com proporção], [tipografia], [movimento]. Descreva decisões, não adjetivos.' },
  { name: 'Regras de marca', what: 'O que a marca do cliente já decidiu.', model: 'REGRAS DE MARCA: [tom de voz], [cores e tipografia], [assinatura]. Siga o manual aprovado e respeite os campos travados.' },
  { name: 'Entregáveis', what: 'O que sai pronto.', model: 'ENTREGÁVEIS: [lista numerada]. Cada item com nome de arquivo e formato.' },
  { name: 'Processo com checkpoint', what: 'Etapas com parada para aprovação.', model: 'PROCESSO: 1) Leia o briefing e devolva o que entendeu em 5 linhas. Pare e espere o OK. 2) Entregue a primeira versão. 3) Pare e espere o retorno.' },
  { name: 'Revisão independente', what: 'Uma segunda leitura, sem o viés de quem criou.', model: 'REVISÃO: antes de entregar, revise como outra pessoa. Confira objetivo, proibidos, números com fonte, contraste e texto sobre fundo sólido. Liste o que corrigiu.' },
  { name: 'Protocolo de iteração', what: 'Como pedir ajuste sem perder o que está bom.', model: 'ITERAÇÃO: nas rodadas de ajuste, responda a MANTER, ALTERAR, CORRIGIR e ENTREGA. Não mude o que não foi pedido.' },
] as const;

const ROUND = [
  { key: 'MANTER', what: 'O que está aprovado e não pode mudar.' },
  { key: 'ALTERAR', what: 'O que mudar, uma instrução por linha.' },
  { key: 'CORRIGIR', what: 'Erros objetivos: texto, número, alinhamento, contraste.' },
  { key: 'ENTREGA', what: 'Formato, nome do arquivo e a lista do que mudou.' },
] as const;

const ROUND_TEMPLATE = `MANTER: [o que está aprovado e não pode mudar]
ALTERAR: [o que mudar, uma instrução por linha]
CORRIGIR: [erros objetivos: texto, número, alinhamento, contraste]
ENTREGA: [formato, nome do arquivo e lista do que mudou]`;

const FULL_PROMPT = LAYERS.map((l, i) => `${i + 1}. ${l.model}`).join('\n\n');

/* ================================================================== */
/* PÁGINA                                                              */
/* ================================================================== */

export default async function BibliotecaPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.t) ? (sp.t as TabKey) : 'assets';
  const d = await db();
  const [assets, clients] = await Promise.all([d.list('assets', { orderBy: 'created_at', desc: true }), d.list('clients', { orderBy: 'company' })]);

  return (
    <div>
      <PageHeader kicker="Operação" title="Biblioteca" subtitle="Arquivos, templates das séries, skills e prompts do Studio. O que a equipe reaproveita fica aqui." />

      <div className="mb-5">
        <PillTabs
          tabs={TABS.map((t) => ({ href: `/biblioteca?t=${t.key}`, label: t.label, count: t.key === 'assets' ? assets.length : t.key === 'templates' ? SERIES.length : t.key === 'skills' ? SKILLS.length : LAYERS.length }))}
          current={`/biblioteca?t=${tab}`}
        />
      </div>

      {tab === 'assets' && <AssetsTab assets={assets} clients={clients} client={sp.client || ''} kind={sp.kind || ''} />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'skills' && <SkillsTab />}
      {tab === 'prompts' && <PromptsTab />}
    </div>
  );
}

/* ---------- Assets ---------- */

function AssetsTab({
  assets,
  clients,
  client,
  kind,
}: {
  assets: Asset[];
  clients: Client[];
  client: string;
  kind: string;
}) {
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const name = (id?: string | null) => {
    if (!id) return 'Studio';
    const c = clientById.get(id);
    return c ? c.company || c.contact_name : 'Cliente removido';
  };

  const kinds = Array.from(new Set(assets.map((a) => a.kind))).sort((a, b) => kindLabel(a).localeCompare(kindLabel(b), 'pt-BR'));
  const filtered = assets.filter((a) => (!client || (client === 'studio' ? !a.client_id : a.client_id === client)) && (!kind || a.kind === kind));
  const shown = filtered.slice(0, PAGE_SIZE);
  const filtering = Boolean(client || kind);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <form method="get" action="/biblioteca" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="t" value="assets" />
          <Select name="client" defaultValue={client} aria-label="Filtrar por cliente" className="h-9 w-auto min-w-[170px] rounded-full py-0 text-[13px]">
            <option value="">Todos os clientes</option>
            <option value="studio">Studio, sem cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company || c.contact_name}
              </option>
            ))}
          </Select>
          <Select name="kind" defaultValue={kind} aria-label="Filtrar por tipo" className="h-9 w-auto min-w-[150px] rounded-full py-0 text-[13px]">
            <option value="">Todos os tipos</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="subtle" size="sm" className="h-9">
            Filtrar
          </Button>
          {filtering && (
            <Link href="/biblioteca?t=assets" className="text-[13px] text-ink2 underline-offset-2 hover:text-ink hover:underline">
              Limpar filtros
            </Link>
          )}
          <span className="ml-auto text-xs text-ink3">
            {filtered.length} {filtered.length === 1 ? 'arquivo' : 'arquivos'}
          </span>
        </form>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="h-5 w-5" />}
            title={filtering ? 'Nada com esses filtros' : 'Biblioteca vazia'}
            text={filtering ? 'Tire um filtro ou envie o arquivo ao lado.' : 'Envie logos, fotos, vídeos, PDFs e áudios ao lado. Vídeo grande entra por link do Google Drive.'}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {shown.map((a) => {
                const href = assetHref(a.url);
                const isImage = Boolean(href && a.mime?.startsWith('image'));
                const c = a.client_id ? clientById.get(a.client_id) : undefined;
                const inner = (
                  <>
                    <div className="relative aspect-[4/3] overflow-hidden bg-white/[0.03]">
                      {isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={href!} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-ink3">
                          <FileKindIcon mime={a.mime} className="h-7 w-7" />
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 p-3">
                      <div className="truncate text-sm font-medium text-ink group-hover:text-accent">{a.name}</div>
                      <div className="flex items-center justify-between gap-2 text-xs text-ink3">
                        <span className="truncate">{[kindLabel(a.kind), sizeLabel(a.size_bytes)].filter(Boolean).join(' · ')}</span>
                        <span className="shrink-0">{fmtDate(a.created_at)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-ink2">
                        <span className="dot" style={{ background: c?.brand_color || '#6E6E6C' }} />
                        <span className="truncate">{name(a.client_id)}</span>
                      </div>
                    </div>
                  </>
                );
                return href ? (
                  <a key={a.id} href={href} target="_blank" rel="noopener noreferrer" className="card press group block overflow-hidden hover:border-white/15">
                    {inner}
                  </a>
                ) : (
                  <div key={a.id} className="card group block overflow-hidden">
                    {inner}
                  </div>
                );
              })}
            </div>
            {filtered.length > shown.length && <p className="text-xs text-ink3">Mostrando {shown.length} de {filtered.length}. Use os filtros para chegar ao resto.</p>}
          </>
        )}
      </div>

      <div className="space-y-6">
        <Section title="Enviar arquivos" kicker="Biblioteca do Studio">
          <Card className="p-5">
            <Dropzone compact />
            <p className="mt-3 text-xs text-ink3">Sem cliente definido, o arquivo fica na biblioteca do Studio. Para anexar a um cliente, envie pela página dele.</p>
          </Card>
        </Section>
        <Section title="Gerar imagem" kicker="ChatGPT · OpenAI">
          <Card className="p-5">
            <ActionForm action={generateImageFormAction} success="Imagem gerada e salva na Biblioteca" resetOnSuccess className="space-y-3">
              <Field label="Descreva a imagem" hint="Moodboard, fundo para post, thumbnail, cena de referência. Sem texto na imagem.">
                <Textarea name="prompt" className="min-h-[88px]" placeholder="Ex.: palco de show sertanejo à noite, luz laranja, público ao fundo, clima de cinema" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cliente">
                  <Select name="client_id" defaultValue="">
                    <option value="">Studio</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.company || c.contact_name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Formato">
                  <Select name="size" defaultValue="1024x1024">
                    <option value="1024x1024">Quadrado 1:1</option>
                    <option value="1024x1536">Vertical 2:3</option>
                    <option value="1536x1024">Horizontal 3:2</option>
                  </Select>
                </Field>
              </div>
              <Field label="Nome do arquivo (opcional)">
                <Input name="name" placeholder="Ex.: fundo-palco-gibson" />
              </Field>
              <SubmitButton className="w-full" disabled={!hasOpenAIKey()} pendingText="Gerando…">
                {hasOpenAIKey() ? 'Gerar com o ChatGPT' : 'Configure a chave da OpenAI em Settings'}
              </SubmitButton>
            </ActionForm>
            <p className="mt-3 text-xs text-ink3">Imagem gerada entra na Biblioteca com a tag IA. Material real do cliente continua tendo prioridade nas peças.</p>
          </Card>
        </Section>
      </div>
    </div>
  );
}

/* ---------- Templates ---------- */

function TemplatesTab() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SERIES.map((s, i) => (
            <Card key={s.name} className="flex gap-4 p-4">
              <div
                className="display grid aspect-[4/5] w-16 shrink-0 place-items-center rounded-lg border border-white/10 text-2xl"
                style={{ background: s.bg, color: s.fg }}
                aria-hidden
              >
                {String(i + 1).padStart(2, '0')}
              </div>
              <div className="min-w-0">
                <div className="display text-lg text-ink">{s.name}</div>
                <dl className="mt-2 space-y-2 text-sm">
                  <div>
                    <dt className="label">Para quê</dt>
                    <dd className="mt-0.5 text-ink2">{s.why}</dd>
                  </div>
                  <div>
                    <dt className="label">Formato</dt>
                    <dd className="mt-0.5 text-ink2">{s.format}</dd>
                  </div>
                  <div>
                    <dt className="label">Composição</dt>
                    <dd className="mt-0.5 text-ink2">{s.template}</dd>
                  </div>
                </dl>
              </div>
            </Card>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink3">Grade em xadrez editorial, escuro e claro alternados. Linha de 3 só em lançamento.</p>
      </div>

      <div className="space-y-6">
        <Section title="Semana padrão" kicker="Cadência do feed">
          <Card className="divide-y divide-white/[0.05] p-2">
            {WEEK.map((w) => (
              <div key={w.day} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm text-ink">{w.what}</div>
                  <div className="text-xs text-ink3">{w.day}</div>
                </div>
                <span className="num shrink-0 text-sm text-ink2">{w.at}</span>
              </div>
            ))}
          </Card>
          <p className="text-xs text-ink3">Stories de 3 a 5 por dia. LinkedIn do Vitor na terça e na quinta.</p>
        </Section>

        <Section title="Mix do mês" kicker="Por tipo de peça">
          <Card className="space-y-3 p-5">
            {MIX.map((m) => (
              <div key={m.label}>
                <div className="mb-1.5 flex items-baseline justify-between text-sm">
                  <span className="text-ink2">{m.label}</span>
                  <span className="num text-ink">{m.pct}%</span>
                </div>
                <Progress value={m.pct} />
              </div>
            ))}
          </Card>
        </Section>
      </div>
    </div>
  );
}

/* ---------- Skills ---------- */

function SkillsTab() {
  return (
    <div className="space-y-3">
      <Table>
        <thead>
          <tr>
            <TH>Skill</TH>
            <TH>O que faz</TH>
            <TH>Módulo</TH>
          </tr>
        </thead>
        <tbody>
          {SKILLS.map((s) => (
            <tr key={s.name} className="transition-colors hover:bg-white/[0.03]">
              <TD className="whitespace-nowrap font-mono text-[13px] text-ink">{s.name}</TD>
              <TD className="text-ink2">{s.does}</TD>
              <TD>
                <Badge>{s.module}</Badge>
              </TD>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="text-xs text-ink3">As skills rodam no Claude, fora deste sistema. Aqui ficam como mapa de qual usar em cada módulo.</p>
    </div>
  );
}

/* ---------- Prompts ---------- */

function PromptsTab() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="label mb-1">Método Impacto</div>
            <h2 className="display text-xl text-ink">13 camadas do prompt</h2>
          </div>
          <CopyButton text={FULL_PROMPT} label="Copiar as 13 camadas" />
        </div>

        <ol className="space-y-3">
          {LAYERS.map((l, i) => (
            <li key={l.name}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <span className="num mt-0.5 w-6 shrink-0 text-sm text-ink3">{String(i + 1).padStart(2, '0')}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">{l.name}</div>
                      <div className="text-xs text-ink2">{l.what}</div>
                    </div>
                  </div>
                  <CopyButton text={l.model} />
                </div>
                <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3 font-mono text-[12px] leading-relaxed text-ink2">{l.model}</pre>
              </Card>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-6">
        <Section title="Rodada de ajuste" kicker="Protocolo">
          <Card className="space-y-4 p-5">
            <p className="text-sm text-ink2">Use na mensagem de ajuste. Quatro blocos, sempre na mesma ordem.</p>
            <dl className="space-y-3">
              {ROUND.map((r) => (
                <div key={r.key} className="flex gap-3">
                  <dt className="num w-20 shrink-0 text-sm text-accent">{r.key}</dt>
                  <dd className="text-sm text-ink2">{r.what}</dd>
                </div>
              ))}
            </dl>
            <pre className="whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3 font-mono text-[12px] leading-relaxed text-ink2">{ROUND_TEMPLATE}</pre>
            <CopyButton text={ROUND_TEMPLATE} label="Copiar protocolo" />
          </Card>
        </Section>

        <Card className="p-5">
          <div className="text-sm font-medium text-ink">Como usar</div>
          <p className="mt-2 text-xs text-ink2">Troque o que está entre colchetes. Onde não houver dado, deixe [N]. O sistema usa o mesmo método nos prompts de diagnóstico, feed, roteiro e anúncios.</p>
        </Card>
      </div>
    </div>
  );
}
