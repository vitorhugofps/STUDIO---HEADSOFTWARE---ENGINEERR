import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Film, Plus } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveClient } from '@/lib/active-client';
import type { Asset, Job, VideoProject } from '@/lib/db/types';
import { cn, fmtDate, relTime } from '@/lib/utils';
import { Badge, Button, Card, Dot, EmptyState, ListRow, PageHeader, PillTabs, Progress, Table, TD, TH } from '@/components/ui/primitives';
import { Dropzone, FileKindIcon } from '@/components/ui/dropzone';
import { DirectionForm, TagEditor, VideoDetail } from './panel';

export const metadata = { title: 'Criação de Vídeos' };

const RAW_KINDS = ['video_bruto', 'drive_link', 'referencia'];
const TABS = ['bruto', 'direcao', 'reels', 'horizontal'] as const;
type Tab = (typeof TABS)[number];

const STATUS_LABEL: Record<VideoProject['status'], string> = {
  rascunho: 'Rascunho',
  roteiro: 'Roteiro',
  edicao: 'Em edição',
  revisao: 'Revisão',
  aprovado: 'Aprovado',
  entregue: 'Entregue',
};
const STATUS_DOT: Record<VideoProject['status'], 'idle' | 'rec' | 'wave' | 'done'> = { rascunho: 'idle', roteiro: 'idle', edicao: 'rec', revisao: 'wave', aprovado: 'done', entregue: 'done' };

const JOB_LABEL: Record<Job['status'], string> = { fila: 'Na fila', rodando: 'Rodando', revisao: 'Em revisão', concluido: 'Concluído', erro: 'Erro', cancelado: 'Cancelado' };
const JOB_DOT: Record<Job['status'], 'idle' | 'rec' | 'wave' | 'done' | 'err' | 'off'> = { fila: 'idle', rodando: 'rec', revisao: 'wave', concluido: 'done', erro: 'err', cancelado: 'off' };
const JOB_KIND: Record<string, string> = {
  render_reel: 'Render de Reel',
  edit_horizontal: 'Rough cut horizontal',
  gerar_feed: 'Geração de feed',
  relatorio_diario: 'Relatório diário',
};

const SOURCE_LABEL: Record<string, string> = { upload: 'Upload', google_drive: 'Google Drive', link: 'Link' };

function bytes(n?: number | null) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2).replace('.', ',')} GB`;
}

function duration(s?: number | null) {
  if (!s) return '–';
  if (s < 90) return `${s} s`;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} min`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export default async function VideosPage({ searchParams }: { searchParams: Promise<{ v?: string; vp?: string; tag?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const active = await getActiveClient();
  if (!active) {
    return <EmptyState title="Escolha um cliente" text="Os vídeos são criados dentro de um cliente. Escolha um no topo." action={<Button href="/clientes">Ver clientes</Button>} />;
  }
  const { client, brandKit } = active;
  const name = client.company || client.contact_name;
  const d = await db();

  const [assets, videos, jobs] = await Promise.all([
    d.list('assets', { where: { client_id: client.id }, orderBy: 'created_at', desc: true }),
    d.list('video_projects', { where: { client_id: client.id }, orderBy: 'created_at', desc: true }),
    d.list('jobs', { where: { client_id: client.id }, orderBy: 'created_at', desc: true, limit: 12 }),
  ]);

  const target = sp.vp ? videos.find((v) => v.id === sp.vp) : undefined;
  if (target && (sp.v === 'reels' || sp.v === 'horizontal') && sp.v !== target.line) redirect(`/marketing/videos?v=${target.line}&vp=${target.id}`);
  const tab: Tab = (TABS as readonly string[]).includes(sp.v || '') ? (sp.v as Tab) : target ? target.line : 'bruto';

  const raw = assets.filter((a) => RAW_KINDS.includes(a.kind));
  const reels = videos.filter((v) => v.line === 'reels');
  const horizontal = videos.filter((v) => v.line === 'horizontal');
  const selected = (tab === 'reels' || tab === 'horizontal') && target && target.line === tab ? target : undefined;

  const tabs = [
    { href: '/marketing/videos?v=bruto', label: 'Material bruto', count: raw.length },
    { href: '/marketing/videos?v=direcao', label: 'Direção e roteiro' },
    { href: '/marketing/videos?v=reels', label: 'Reels', count: reels.length },
    { href: '/marketing/videos?v=horizontal', label: 'Horizontal', count: horizontal.length },
  ];

  const verbal = (brandKit?.verbal || {}) as Record<string, unknown>;
  const tom = str(verbal.descricao_tom) || str(verbal.tom);

  return (
    <div className="space-y-2">
      <PageHeader
        kicker={`Criação de vídeos · ${name}`}
        title={
          <>
            Do material bruto <em>ao vídeo pronto</em>
          </>
        }
        subtitle="Envie o material, defina a direção, receba roteiro e decupagem e mande para a edição. O status acompanha cada etapa."
        actions={
          tab !== 'direcao' ? (
            <Button variant="glass" href="/marketing/videos?v=direcao">
              <Plus className="h-4 w-4" /> Novo vídeo
            </Button>
          ) : undefined
        }
      />
      <PillTabs tabs={tabs} current={`/marketing/videos?v=${tab}`} className="mb-4" />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {tab === 'bruto' && <RawTab clientId={client.id} raw={raw} tag={sp.tag} />}

          {tab === 'direcao' && (
            <Card className="p-6">
              <div className="mb-5">
                <div className="label">Direção do vídeo</div>
                <h2 className="display mt-1 text-2xl text-ink">Briefing e roteiro</h2>
                <p className="mt-1 text-sm text-ink2">
                  {raw.length > 0
                    ? `${raw.length} ${raw.length === 1 ? 'item de material bruto entra' : 'itens de material bruto entram'} na decupagem.`
                    : 'Ainda não há material bruto. O roteiro indica o que captar.'}{' '}
                  {brandKit?.status === 'aprovado' ? 'Tom e proibidos vêm do BrandKit aprovado.' : 'Sem BrandKit aprovado, o roteiro usa o cadastro e o contexto do cliente.'}
                </p>
              </div>
              <DirectionForm clientId={client.id} defaults={{ tom }} />
            </Card>
          )}

          {(tab === 'reels' || tab === 'horizontal') &&
            (selected ? (
              <>
                <div>
                  <Button variant="ghost" size="sm" href={`/marketing/videos?v=${tab}`}>
                    {tab === 'reels' ? 'Todos os Reels' : 'Todos os vídeos horizontais'}
                  </Button>
                </div>
                <VideoDetail vp={selected} jobs={jobs} />
              </>
            ) : (
              <>
                {sp.vp && !target && <p className="text-sm text-warn">Vídeo não encontrado neste cliente.</p>}
                <VideoList line={tab} list={tab === 'reels' ? reels : horizontal} />
              </>
            ))}
        </div>

        <aside className="space-y-4">
          {(tab === 'reels' || tab === 'horizontal') && selected && (
            <Card className="p-3">
              <div className="label px-3 pb-2 pt-2">{tab === 'reels' ? 'Reels do cliente' : 'Vídeos horizontais do cliente'}</div>
              <div>
                {(tab === 'reels' ? reels : horizontal).map((v) => (
                  <ListRow
                    key={v.id}
                    href={`/marketing/videos?v=${tab}&vp=${v.id}`}
                    left={<Dot state={STATUS_DOT[v.status]} />}
                    title={v.title}
                    meta={`${STATUS_LABEL[v.status]} · ${duration(v.target_duration_s)}`}
                    className={cn(v.id === selected.id && 'bg-white/[0.06]')}
                  />
                ))}
              </div>
            </Card>
          )}
          <Queue jobs={jobs} />
          <Engine />
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RawTab({ clientId, raw, tag }: { clientId: string; raw: Asset[]; tag?: string }) {
  const tagCount = new Map<string, number>();
  for (const a of raw) for (const t of a.tags || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const tags = [...tagCount.entries()].sort((x, y) => y[1] - x[1]);
  const shown = tag ? raw.filter((a) => (a.tags || []).includes(tag)) : raw;

  return (
    <>
      <Card className="p-5">
        <div className="label mb-3">Enviar material bruto</div>
        <Dropzone clientId={clientId} kind="video_bruto" />
      </Card>

      {raw.length === 0 ? (
        <EmptyState
          icon={<Film className="h-5 w-5" />}
          title="Nenhum material bruto ainda"
          text="Envie os arquivos da gravação ou cole o link da pasta do Drive. O roteiro usa esses nomes para montar a decupagem."
        />
      ) : (
        <div className="space-y-3">
          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtrar por etiqueta">
              <Chip href="/marketing/videos?v=bruto" active={!tag}>
                Todas · {raw.length}
              </Chip>
              {tags.map(([t, n]) => (
                <Chip key={t} href={`/marketing/videos?v=bruto&tag=${encodeURIComponent(t)}`} active={tag === t}>
                  {t} · {n}
                </Chip>
              ))}
            </div>
          )}
          <Table>
            <thead>
              <tr>
                <TH>Arquivo</TH>
                <TH>Origem</TH>
                <TH className="text-right">Tamanho</TH>
                <TH>Enviado</TH>
                <TH>Etiquetas</TH>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <TD colSpan={5} className="py-8 text-center text-ink2">
                    Nenhum arquivo com a etiqueta “{tag}”.
                  </TD>
                </tr>
              )}
              {shown.map((a) => (
                <tr key={a.id} className="hover:bg-white/[0.02]">
                  <TD className="max-w-[280px]">
                    <div className="flex items-center gap-2.5">
                      <FileKindIcon mime={a.mime} className="shrink-0 text-ink3" />
                      {a.url ? (
                        <a href={a.url} target="_blank" rel="noreferrer" className="truncate font-medium text-ink hover:text-accent" title={a.name}>
                          {a.name}
                        </a>
                      ) : (
                        <span className="truncate font-medium" title={a.name}>
                          {a.name}
                        </span>
                      )}
                    </div>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={a.source === 'google_drive' ? 'info' : 'neutral'}>{SOURCE_LABEL[a.source || ''] || 'Upload'}</Badge>
                      {a.kind === 'referencia' && <Badge tone="accent">Referência</Badge>}
                    </div>
                  </TD>
                  <TD className="num whitespace-nowrap text-right text-base text-ink2">{bytes(a.size_bytes) || '–'}</TD>
                  <TD className="whitespace-nowrap text-ink2">{fmtDate(a.created_at)}</TD>
                  <TD className="min-w-[180px]">
                    <TagEditor id={a.id} tags={a.tags || []} />
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}

function Chip({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'press rounded-full border px-3 py-1 text-xs transition-colors',
        active ? 'border-ink bg-ink text-bg' : 'border-white/10 text-ink2 hover:border-white/20 hover:text-ink',
      )}
    >
      {children}
    </Link>
  );
}

function VideoList({ line, list }: { line: 'reels' | 'horizontal'; list: VideoProject[] }) {
  if (list.length === 0) {
    return (
      <EmptyState
        icon={<Film className="h-5 w-5" />}
        title={line === 'reels' ? 'Nenhum Reel ainda' : 'Nenhum vídeo horizontal ainda'}
        text="Abra um vídeo na aba de direção. Com o material bruto enviado, o roteiro e a decupagem saem prontos para revisar."
        action={
          <Button href="/marketing/videos?v=direcao">
            <Plus className="h-4 w-4" /> Novo vídeo
          </Button>
        }
      />
    );
  }
  return (
    <Table>
      <thead>
        <tr>
          <TH>Título</TH>
          <TH>Status</TH>
          <TH className="text-right">Duração</TH>
          <TH>Roteiro</TH>
          <TH>Atualizado</TH>
          <TH />
        </tr>
      </thead>
      <tbody>
        {list.map((v) => {
          const blocks = v.script?.blocks?.length || 0;
          return (
            <tr key={v.id} className="hover:bg-white/[0.02]">
              <TD className="max-w-[260px]">
                <Link href={`/marketing/videos?v=${line}&vp=${v.id}`} className="block truncate font-medium text-ink hover:text-accent">
                  {v.title}
                </Link>
                <div className="text-xs text-ink3">{v.aspect || (line === 'reels' ? '9:16' : '16:9')}</div>
              </TD>
              <TD>
                <span className="inline-flex items-center gap-2 whitespace-nowrap text-ink2">
                  <Dot state={STATUS_DOT[v.status]} /> {STATUS_LABEL[v.status]}
                </span>
              </TD>
              <TD className="num whitespace-nowrap text-right text-base">{duration(v.target_duration_s)}</TD>
              <TD className="whitespace-nowrap text-ink2">{blocks ? `${blocks} blocos` : 'Sem roteiro'}</TD>
              <TD className="whitespace-nowrap text-ink2">{relTime(v.updated_at || v.created_at)}</TD>
              <TD className="text-right">
                <Button variant="subtle" size="sm" href={`/marketing/videos?v=${line}&vp=${v.id}`}>
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

function Queue({ jobs }: { jobs: Job[] }) {
  const list = jobs.filter((j) => j.status !== 'cancelado').slice(0, 8);
  return (
    <Card className="p-5">
      <div className="label mb-3">Fila de edição</div>
      {list.length === 0 ? (
        <p className="text-sm text-ink2">Nada na fila. Quando um vídeo for enviado para o Yuri, ele aparece aqui com o andamento.</p>
      ) : (
        <ul className="space-y-4">
          {list.map((j) => {
            const input = (j.input || {}) as Record<string, unknown>;
            const title = str(input.title) || str(input.video) || JOB_KIND[j.kind] || j.kind;
            return (
              <li key={j.id}>
                <div className="flex items-center gap-2 text-sm">
                  <Dot state={JOB_DOT[j.status]} />
                  <span className="min-w-0 flex-1 truncate text-ink" title={title}>
                    {title}
                  </span>
                  <span className="shrink-0 text-xs text-ink3">{JOB_LABEL[j.status]}</span>
                </div>
                {j.status === 'rodando' && <Progress value={j.progress} className="mt-2" />}
                <div className="mt-1 truncate pl-4 text-xs text-ink3" title={j.log || undefined}>
                  {JOB_KIND[j.kind] || j.kind}
                  {j.status === 'rodando' ? ` · ${Math.round(j.progress)}%` : ''}
                  {j.log ? ` · ${j.log}` : ` · ${relTime(j.created_at)}`}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Engine() {
  return (
    <Card className="p-5">
      <div className="label mb-3">Motor híbrido</div>
      <ul className="space-y-2.5 text-sm text-ink2">
        <li className="flex gap-3">
          <span className="num mt-0.5 text-base text-accent">1</span>
          <span>
            <b className="font-medium text-ink">Reel sai quase pronto.</b> Roteiro, cortes, legenda e trilha montados para revisão.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="num mt-0.5 text-base text-accent">2</span>
          <span>
            <b className="font-medium text-ink">Horizontal longo sai como rough cut.</b> Vem com XML para abrir no Premiere ou no Espectro.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="num mt-0.5 text-base text-accent">3</span>
          <span>
            <b className="font-medium text-ink">A edição fina é do Yuri.</b> O vídeo entra na fila dele e o status volta para cá.
          </span>
        </li>
      </ul>
    </Card>
  );
}
