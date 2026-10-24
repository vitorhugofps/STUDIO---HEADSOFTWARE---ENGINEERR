import Link from 'next/link';
import { headers } from 'next/headers';
import { CheckCircle2, ExternalLink } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import type { ApprovalBatch, ContentItem } from '@/lib/db/types';
import { Badge, Card, EmptyState, PageHeader, Section, Stat } from '@/components/ui/primitives';
import { ActionButton, CopyButton } from '@/components/ui/client';
import { setContentStatusAction } from '@/lib/actions/ops';
import { setActiveClientAction } from '@/lib/actions/common';
import { brl, fmtDate, relTime } from '@/lib/utils';

export const metadata = { title: 'Aprovações' };

const BATCH_TYPE: Record<ApprovalBatch['item_type'], string> = {
  content: 'Feed',
  video: 'Vídeo',
  brand: 'Marca',
  quote: 'Proposta',
  campaign: 'Campanha',
  site: 'Site',
};

const FORMAT: Record<ContentItem['format'], string> = {
  post_4x5: 'Post 4:5',
  carrossel: 'Carrossel',
  story: 'Story',
  capa_reel: 'Capa de Reel',
};

/** Endereço absoluto do portal, para colar no WhatsApp. Sem host confiável, cai no caminho relativo. */
async function origin() {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || '';
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return '';
  const proto = h.get('x-forwarded-proto')?.split(',')[0] || (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https');
  return /^https?$/.test(proto) ? `${proto}://${host}` : '';
}

export default async function AprovacoesPage() {
  const user = await requireUser();
  const canQuotes = user.role === 'admin' || user.role === 'comercial';
  const d = await db();
  const base = await origin();

  const [batches, items, videos, kits, quotes, clients] = await Promise.all([
    d.list('approval_batches', { orderBy: 'created_at', desc: true }),
    d.list('content_items', { where: { status: 'em_aprovacao' } }),
    d.list('video_projects', { where: { status: 'revisao' } }),
    d.list('brand_kits', { where: { status: 'em_aprovacao' } }),
    canQuotes ? d.list('quotes', { orderBy: 'created_at', desc: true }) : Promise.resolve([]),
    d.list('clients'),
  ]);

  const now = Date.now();
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const clientName = (id?: string | null) => {
    const c = id ? clientById.get(id) : undefined;
    return c ? c.company || c.contact_name : 'Cliente removido';
  };

  const openBatches = batches.filter((b) => b.status === 'aberto' || b.status === 'ajustes');
  const sentQuotes = quotes.filter((q) => q.status === 'enviada' || q.status === 'vista');

  // Peças agrupadas por cliente, clientes em ordem alfabética.
  const groups = Array.from(
    items.reduce((m, i) => m.set(i.client_id, [...(m.get(i.client_id) || []), i]), new Map<string, ContentItem[]>()),
  )
    .map(([clientId, list]) => ({ clientId, name: clientName(clientId), list: list.sort((a, b) => (a.scheduled_at || a.created_at).localeCompare(b.scheduled_at || b.created_at)) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const waiting = batches.filter((b) => b.status === 'aberto').length;
  const total = openBatches.length + items.length + videos.length + kits.length + sentQuotes.length;

  return (
    <div>
      <PageHeader
        kicker="Início"
        title={
          <>
            Aprovações <em>{total}</em>
          </>
        }
        subtitle="Tudo o que espera uma decisão, numa fila só: lotes no portal do cliente, peças, vídeos, marcas e propostas."
      />

      <div className={canQuotes ? 'mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4' : 'mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3'}>
        <Stat label="Lotes com o cliente" value={waiting} hint={openBatches.length > waiting ? `${openBatches.length - waiting} com ajustes pedidos` : 'No portal de aprovação'} />
        <Stat label="Peças em aprovação" value={items.length} hint={`${groups.length} ${groups.length === 1 ? 'cliente' : 'clientes'}`} />
        <Stat label="Vídeos e marcas" value={videos.length + kits.length} hint={`${videos.length} em revisão · ${kits.length} em aprovação`} />
        {canQuotes && <Stat label="Propostas enviadas" value={sentQuotes.length} hint={sentQuotes.length ? brl(sentQuotes.reduce((s, q) => s + (q.total || 0), 0)) : 'Nenhuma aguardando'} />}
      </div>

      {total === 0 ? (
        <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="Fila limpa" text="Nada espera decisão agora. Quando um lote for enviado ou uma peça entrar em aprovação, ela aparece aqui." />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            <Section title="Lotes no portal do cliente" kicker="Link público">
              {openBatches.length === 0 ? (
                <Card className="p-5 text-sm text-ink2">Nenhum lote aberto. Envie um lote pelo Feed para gerar o link do cliente.</Card>
              ) : (
                <Card className="divide-y divide-white/[0.05] p-2">
                  {openBatches.map((b) => {
                    const c = clientById.get(b.client_id);
                    const expired = Boolean(b.expires_at && new Date(b.expires_at).getTime() < now);
                    const path = `/aprovar/${b.public_token}`;
                    return (
                      <div key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3.5">
                        <div className="min-w-0 flex-1 basis-56">
                          <div className="flex items-center gap-2 text-xs text-ink2">
                            <span className="dot" style={{ background: c?.brand_color || '#FF5B1F' }} />
                            <span className="truncate">{clientName(b.client_id)}</span>
                          </div>
                          <div className="mt-1 truncate text-sm font-medium text-ink">{b.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink3">
                            <Badge>{BATCH_TYPE[b.item_type] || b.item_type}</Badge>
                            <span>
                              <span className="num">{b.item_ids.length}</span> {b.item_ids.length === 1 ? 'item' : 'itens'}
                            </span>
                            <span>criado {relTime(b.created_at)}</span>
                            {b.expires_at && <span>vence {fmtDate(b.expires_at)}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {expired ? <Badge tone="err">expirado</Badge> : b.status === 'ajustes' ? <Badge tone="warn">ajustes pedidos</Badge> : <Badge tone="accent">aguardando cliente</Badge>}
                          <CopyButton text={`${base}${path}`} label="Copiar link" />
                          <a href={path} target="_blank" rel="noopener noreferrer" aria-label={`Abrir o portal de ${b.title} em nova aba`} className="press focus-ring grid h-8 w-8 place-items-center rounded-full text-ink2 hover:bg-white/[0.06] hover:text-ink">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </Card>
              )}
            </Section>

            <Section title="Peças em aprovação" kicker="Decisão interna">
              {groups.length === 0 ? (
                <Card className="p-5 text-sm text-ink2">Nenhuma peça em aprovação. As peças chegam aqui quando entram em aprovação no Feed.</Card>
              ) : (
                <div className="space-y-4">
                  {groups.map((g) => {
                    const c = clientById.get(g.clientId);
                    return (
                      <Card key={g.clientId} className="overflow-hidden p-0">
                        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="dot" style={{ background: c?.brand_color || '#FF5B1F' }} />
                            <span className="truncate text-sm font-medium text-ink">{g.name}</span>
                            <span className="num text-xs text-ink3">{g.list.length}</span>
                          </div>
                          <ActionButton size="sm" variant="ghost" action={setActiveClientAction.bind(null, g.clientId)} afterPath="/marketing/feed">
                            Abrir no Feed
                          </ActionButton>
                        </div>
                        <ul className="divide-y divide-white/[0.05]">
                          {g.list.map((i) => (
                            <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                              <div className="min-w-0 flex-1 basis-56">
                                <div className="line-clamp-2 text-sm text-ink">{i.hook}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink3">
                                  <Badge>{FORMAT[i.format] || i.format}</Badge>
                                  {i.series && <Badge>{i.series}</Badge>}
                                  {i.version > 1 && <span>versão {i.version}</span>}
                                  {i.scheduled_at && <span>publica {fmtDate(i.scheduled_at)}</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <ActionButton size="sm" variant="subtle" action={setContentStatusAction.bind(null, i.id, 'aprovado')} success="Peça aprovada">
                                  Aprovar
                                </ActionButton>
                                <ActionButton size="sm" variant="ghost" action={setContentStatusAction.bind(null, i.id, 'ajustar')} success="Ajuste pedido">
                                  Pedir ajuste
                                </ActionButton>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </Card>
                    );
                  })}
                </div>
              )}
            </Section>
          </div>

          <div className="space-y-8">
            <Section title="Vídeos em revisão" kicker="Marketing">
              {videos.length === 0 ? (
                <Card className="p-5 text-sm text-ink2">Nenhum vídeo em revisão.</Card>
              ) : (
                <Card className="divide-y divide-white/[0.05] p-2">
                  {videos.map((v) => (
                    <div key={v.id} className="flex items-center gap-3 px-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{v.title}</div>
                        <div className="truncate text-xs text-ink3">
                          {clientName(v.client_id)} · {v.line === 'reels' ? 'Reel' : 'Horizontal'}
                        </div>
                      </div>
                      <ActionButton size="sm" variant="subtle" action={setActiveClientAction.bind(null, v.client_id)} afterPath={`/marketing/videos?v=${v.line === 'reels' ? 'reels' : 'horizontal'}&vp=${v.id}`}>
                        Abrir
                      </ActionButton>
                    </div>
                  ))}
                </Card>
              )}
            </Section>

            <Section title="Marcas em aprovação" kicker="Brand">
              {kits.length === 0 ? (
                <Card className="p-5 text-sm text-ink2">Nenhuma marca esperando aprovação.</Card>
              ) : (
                <Card className="divide-y divide-white/[0.05] p-2">
                  {kits.map((k) => (
                    <div key={k.id} className="flex items-center gap-3 px-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{clientName(k.client_id)}</div>
                        <div className="truncate text-xs text-ink3">
                          Manual da marca · versão {k.version} · etapa {k.step} de 6
                        </div>
                      </div>
                      <ActionButton size="sm" variant="subtle" action={setActiveClientAction.bind(null, k.client_id)} afterPath="/marketing/brand">
                        Abrir
                      </ActionButton>
                    </div>
                  ))}
                </Card>
              )}
            </Section>

            {canQuotes && (
              <Section title="Propostas enviadas" kicker="Vendas">
                {sentQuotes.length === 0 ? (
                  <Card className="p-5 text-sm text-ink2">Nenhuma proposta esperando resposta.</Card>
                ) : (
                  <Card className="divide-y divide-white/[0.05] p-2">
                    {sentQuotes.map((q) => (
                      <Link key={q.id} href={`/vendas?t=propostas&q=${q.id}`} className="press flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/[0.05]">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-ink">
                            {q.number} · {clientName(q.client_id)}
                          </div>
                          <div className="truncate text-xs text-ink3">
                            {q.status === 'vista' ? 'Vista pelo cliente' : 'Enviada'}
                            {q.valid_until ? ` · vale até ${fmtDate(q.valid_until)}` : ''}
                          </div>
                        </div>
                        <span className="num shrink-0 text-sm text-ink">{brl(q.total)}</span>
                      </Link>
                    ))}
                  </Card>
                )}
              </Section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
