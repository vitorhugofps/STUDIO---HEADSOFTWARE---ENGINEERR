import type { CSSProperties, ReactNode } from 'react';
import { CalendarDays, Check, MessageCircle, Pencil } from 'lucide-react';
import { STUDIO_DEFAULTS, isSupabaseMode, readConfig } from '@/lib/config';
import { localDB } from '@/lib/db/local';
import { supabaseDB, supabaseServer } from '@/lib/db/supabase';
import { ensureSeed } from '@/lib/db/seed';
import { decideItemFormAction } from '@/lib/actions/approvals';
import { cn, fmtDate, waLink } from '@/lib/utils';
import { SlideDeck, BrandFonts, type BrandTokens, type PieceBrand } from '@/app/(app)/marketing/feed/grid';
import type { Approval, ApprovalBatch, Client, ContentItem, DB } from '@/lib/db/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Aprovação de conteúdo · Studio Impacto', robots: { index: false, follow: false } };

/** "2026-10" vira "outubro de 2026" */
const monthLong = (key: string) => {
  const [y, m] = String(key).split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(y, (m || 1) - 1, 1));
};

/** Portal público: fundo claro só nesta rota, sem alterar o tema do app. */
const LIGHT = {
  '--bg': '245 245 243',
  '--s1': '255 255 255',
  '--s2': '236 235 232',
  '--s3': '224 223 219',
  '--line': '0 0 0',
  '--ink': '10 10 10',
  '--ink2': '82 82 80',
  '--ink3': '120 120 118',
  colorScheme: 'light',
  background: 'rgb(245 245 243)',
  color: 'rgb(10 10 10)',
} as CSSProperties;

const FORMAT_LABEL: Record<ContentItem['format'], string> = { post_4x5: 'Post 4:5', carrossel: 'Carrossel', story: 'Story 9:16', capa_reel: 'Capa de Reel' };
const FORMAT_SHORT: Record<ContentItem['format'], string> = { post_4x5: 'P', carrossel: 'C', story: 'S', capa_reel: 'R' };
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type Loaded =
  | { state: 'ok'; batch: ApprovalBatch; client: Client | null; items: ContentItem[]; approvals: Approval[]; tokens: BrandTokens }
  | { state: 'notfound' }
  | { state: 'error' };

async function load(token: string): Promise<Loaded> {
  try {
    let d: DB;
    if (!isSupabaseMode()) {
      try {
        await ensureSeed(localDB);
      } catch {
        /* segue */
      }
      d = localDB;
    } else {
      d = supabaseDB(await supabaseServer());
    }
    const [batch] = await d.list('approval_batches', { where: { public_token: token }, limit: 1 });
    if (!batch) return { state: 'notfound' };
    // Leituras secundárias nunca derrubam o portal.
    const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch {
        return fallback;
      }
    };
    const client = await safe(() => d.get('clients', batch.client_id), null);
    const items = batch.item_ids.length ? await safe(() => d.list('content_items', { where: { id: batch.item_ids }, orderBy: 'scheduled_at' }), [] as ContentItem[]) : [];
    const approvals = await safe(() => d.list('approvals', { where: { batch_id: batch.id }, orderBy: 'created_at', desc: true }), [] as Approval[]);
    const [kit] = await safe(() => d.list('brand_kits', { where: { client_id: batch.client_id }, orderBy: 'version', desc: true, limit: 1 }), []);
    const tokens: Record<string, string> = {};
    for (const [k, v] of Object.entries(kit?.tokens || {})) if (typeof v === 'string') tokens[k] = v;
    return { state: 'ok', batch, client, items, approvals, tokens: tokens as BrandTokens };
  } catch {
    return { state: 'error' };
  }
}

function dayKey(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function Pill({ tone, children }: { tone: 'ok' | 'adjust' | 'wait' | 'info'; children: ReactNode }) {
  const cls = {
    ok: 'bg-emerald-100 text-emerald-800',
    adjust: 'bg-orange-100 text-orange-800',
    wait: 'bg-black/[0.06] text-ink2',
    info: 'bg-sky-100 text-sky-800',
  }[tone];
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold', cls)}>{children}</span>;
}

const statePill = (s: ContentItem['status']) =>
  s === 'aprovado' || s === 'agendado' || s === 'publicado' ? (
    <Pill tone="ok"><Check className="h-3 w-3" /> Aprovada</Pill>
  ) : s === 'ajustar' ? (
    <Pill tone="adjust"><Pencil className="h-3 w-3" /> Ajuste pedido</Pill>
  ) : (
    <Pill tone="wait">Aguardando você</Pill>
  );

function Shell({ children }: { children: ReactNode }) {
  const studio = { ...STUDIO_DEFAULTS, ...(readConfig().studio || {}) };
  return (
    <div className="min-h-screen" style={LIGHT}>
      <header className="sticky top-0 z-20 border-b border-black/[0.08] bg-[rgb(245_245_243/0.9)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="h-7 w-7 rounded-lg" />
            <span className="display whitespace-nowrap text-lg text-ink">{studio.name}</span>
          </div>
          <span className="label hidden sm:inline">Aprovação de conteúdo · Studio Impacto</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-6">{children}</main>
      <footer className="border-t border-black/[0.08] py-8 text-center text-xs text-ink3">
        {studio.name} · {studio.city} · Do ponto ao impacto.
      </footer>
    </div>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <Shell>
      <div className="mx-auto max-w-md rounded-3xl border border-black/10 bg-white p-8 text-center">
        <div className="display text-3xl text-ink">{title}</div>
        <p className="mt-3 text-sm text-ink2">{text}</p>
      </div>
    </Shell>
  );
}

function MonthGrid({ month, items, status }: { month: string; items: ContentItem[]; status: (i: ContentItem) => ContentItem['status'] }) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const n = new Date(y, m, 0).getDate();
  const cells: (number | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const by: Record<number, ContentItem[]> = {};
  for (const it of items) {
    const k = dayKey(it.scheduled_at);
    if (k.startsWith(month)) (by[Number(k.slice(8, 10))] ||= []).push(it);
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
      <div className="flex items-center justify-between border-b border-black/[0.07] px-4 py-3">
        <h3 className="display text-xl text-ink">{monthLong(month)}</h3>
        <span className="text-xs text-ink3">Toque numa peça para ir até ela</span>
      </div>
      <div className="grid grid-cols-7 border-b border-black/[0.07]">
        {WEEKDAYS.map((w) => (
          <div key={w} className="label px-1 py-2 text-center text-[10px]">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => (
          <div key={i} className={cn('min-h-[58px] border-b border-r border-black/[0.05] p-1 md:min-h-[88px] md:p-1.5', !day && 'bg-black/[0.02]', (i + 1) % 7 === 0 && 'border-r-0')}>
            {day && (
              <>
                <div className="num mb-1 text-xs text-ink3">{day}</div>
                <div className="space-y-1">
                  {(by[day] || []).map((it) => {
                    const s = status(it);
                    const tone = s === 'aprovado' ? 'bg-emerald-100 text-emerald-900 border-emerald-500' : s === 'ajustar' ? 'bg-orange-100 text-orange-900 border-orange-500' : 'bg-black/[0.06] text-ink border-black/30';
                    return (
                      <a key={it.id} href={`#peca-${it.id}`} title={it.hook} className={cn('flex items-center gap-1 truncate rounded-md border-l-2 px-1 py-0.5 text-[10px] font-medium leading-tight', tone)}>
                        <span className="num shrink-0">{FORMAT_SHORT[it.format]}</span>
                        <span className="hidden truncate md:inline">{it.hook}</span>
                      </a>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function ApprovalPortal({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ feito?: string; erro?: string; item?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const data = await load(token);
  if (data.state === 'error') return <Notice title="Portal indisponível" text="Não conseguimos abrir este lote agora. Tente de novo em alguns minutos ou fale com o Studio Impacto." />;
  if (data.state === 'notfound') return <Notice title="Link não encontrado" text="Confira se o endereço está completo. Se o problema continuar, peça um novo link ao Studio Impacto." />;

  const { batch, client, items, approvals, tokens } = data;
  const studio = { ...STUDIO_DEFAULTS, ...(readConfig().studio || {}) };
  const name = client ? client.company || client.contact_name : studio.name;
  const color = client?.brand_color || '#FF5B1F';
  const brand: PieceBrand = { name, color, logo: client?.logo_url || null, tokens: { accent: color, ...tokens } };
  const expired = !!batch.expires_at && new Date(batch.expires_at).getTime() < Date.now();
  const closed = batch.status === 'aprovado' || batch.status === 'expirado' || expired;
  const decided = items.filter((i) => i.status === 'aprovado' || i.status === 'ajustar').length;
  const approved = items.filter((i) => i.status === 'aprovado').length;
  const pct = items.length ? Math.round((decided / items.length) * 100) : 0;
  const months = Array.from(new Set(items.map((i) => dayKey(i.scheduled_at).slice(0, 7)).filter(Boolean)));
  const status = (i: ContentItem) => i.status;
  const lastBy = (id: string) => approvals.find((a) => a.item_id === id);
  const wa = studio.whatsapp ? waLink(studio.whatsapp, `Olá! Dúvida sobre o lote "${batch.title}".`) : null;

  return (
    <Shell>
      <BrandFonts tokens={brand.tokens} />

      {/* Cabeçalho do cliente */}
      <section className="rounded-3xl border border-black/10 bg-white p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex min-w-0 flex-1 basis-80 flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
            <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl text-lg font-semibold text-black sm:h-16 sm:w-16 sm:text-xl" style={{ background: color }}>
              {client?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={client.logo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                name.slice(0, 2).toUpperCase()
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="label">Lote para aprovação</div>
              <h1 className="display text-[34px] leading-[0.95] text-ink md:text-[44px]">{batch.title}</h1>
              <p className="mt-2 max-w-2xl text-sm text-ink2">
                {items.length} {items.length === 1 ? 'peça' : 'peças'} de {name}. Veja cada uma como vai aparecer no Instagram, aprove ou peça ajuste com um comentário curto. Você pode mudar de ideia até o link vencer.
              </p>
            </div>
          </div>
          <div className="w-full sm:w-auto sm:min-w-[200px]">
            <div className="flex items-baseline justify-between">
              <span className="num text-4xl text-ink">{decided}<span className="text-xl text-ink3">/{items.length}</span></span>
              <span className="text-xs text-ink2">decididas</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.08]">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 text-xs text-ink3">
              {approved} aprovadas · {decided - approved} com ajuste
              {batch.expires_at ? ` · vale até ${fmtDate(batch.expires_at)}` : ''}
            </div>
          </div>
        </div>
        {closed && (
          <div className="mt-5 rounded-xl bg-black/[0.05] px-4 py-3 text-sm text-ink">
            {batch.status === 'aprovado' ? 'Este lote foi aprovado por inteiro. Obrigado! O time já foi avisado.' : 'Este link venceu. Peça um novo ao Studio Impacto para continuar.'}
          </div>
        )}
        {!closed && items.length > 0 && decided === items.length && (
          <div className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Tudo decidido. O time foi avisado e cuida dos ajustes pedidos.</div>
        )}
      </section>

      {items.length === 0 && (
        <p className="mt-8 rounded-2xl border border-black/10 bg-white p-8 text-center text-sm text-ink2">Este lote ainda não tem peças. Volte quando o Studio Impacto avisar que está pronto.</p>
      )}

      {/* Calendário */}
      {months.length > 0 && (
        <section className="mt-10 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-ink3" />
            <h2 className="display text-2xl text-ink">Calendário de publicação</h2>
          </div>
          {months.map((m) => (
            <MonthGrid key={m} month={m} items={items} status={status} />
          ))}
        </section>
      )}

      {/* Peças */}
      {items.length > 0 && (
        <section className="mt-12 space-y-6">
          <h2 className="display text-2xl text-ink">Peça por peça</h2>
          {items.map((it, idx) => {
            const last = lastBy(it.id);
            const justDone = sp.feito === it.id;
            const err = sp.item === it.id && sp.erro ? sp.erro : null;
            const hasDecision = it.status === 'aprovado' || it.status === 'ajustar';
            const form = (
              <form action={decideItemFormAction} className="space-y-3">
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="item_id" value={it.id} />
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink">Comentário</span>
                  <textarea
                    name="comment"
                    required
                    rows={3}
                    maxLength={1000}
                    placeholder="Se pedir ajuste, conte o que mudar. Se aprovar, o comentário é opcional."
                    className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" name="decision" value="aprovado" formNoValidate className="press inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm font-semibold text-black hover:bg-[#ff6b36]">
                    <Check className="h-4 w-4" /> Aprovar
                  </button>
                  <button type="submit" name="decision" value="ajustar" className="press inline-flex h-11 items-center gap-2 rounded-full border border-black/20 px-6 text-sm font-semibold text-ink hover:bg-black/[0.05]">
                    <Pencil className="h-4 w-4" /> Pedir ajuste
                  </button>
                </div>
              </form>
            );
            return (
              <article key={it.id} id={`peca-${it.id}`} className="scroll-mt-24 rounded-3xl border border-black/10 bg-white p-4 md:p-6">
                <div className="grid gap-6 md:grid-cols-[minmax(0,340px)_1fr]">
                  <div>
                    <SlideDeck item={it} brand={brand} index={idx} />
                  </div>
                  <div className="min-w-0 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-sm text-ink3">{String(idx + 1).padStart(2, '0')}</span>
                      {statePill(it.status)}
                      <Pill tone="info">{FORMAT_LABEL[it.format]}</Pill>
                      {it.series && <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink3">{it.series}</span>}
                    </div>
                    <h3 className="text-lg font-semibold leading-snug text-ink">{it.hook}</h3>
                    {it.scheduled_at && <p className="text-sm text-ink2">Publica em {fmtDate(it.scheduled_at, { weekday: 'long', day: '2-digit', month: 'long' })}</p>}
                    <div>
                      <div className="label mb-1.5">Legenda</div>
                      <p className="whitespace-pre-wrap rounded-xl bg-black/[0.04] p-3.5 text-sm leading-relaxed text-ink">{it.caption || 'Sem legenda.'}</p>
                      {(it.hashtags || []).length > 0 && <p className="mt-2 text-xs text-ink3">{(it.hashtags || []).join(' ')}</p>}
                    </div>

                    {justDone && <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Decisão registrada. Obrigado!</div>}
                    {err && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>}
                    {last?.comment && hasDecision && (
                      <div className="flex gap-2 rounded-xl bg-black/[0.04] px-3.5 py-3 text-sm text-ink2">
                        <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink3" />
                        <span><b className="text-ink">Seu comentário:</b> {last.comment}</span>
                      </div>
                    )}

                    {!closed &&
                      (hasDecision ? (
                        <details className="rounded-xl border border-black/10 px-4 py-3">
                          <summary className="cursor-pointer text-sm font-medium text-ink">Mudar minha decisão</summary>
                          <div className="mt-3">{form}</div>
                        </details>
                      ) : (
                        form
                      ))}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {wa && (
        <p className="mt-12 text-center text-sm text-ink2">
          Ficou com dúvida? <a href={wa} target="_blank" rel="noreferrer" className="font-semibold text-ink underline decoration-accent decoration-2 underline-offset-4">Fale com o time no WhatsApp</a>
        </p>
      )}
    </Shell>
  );
}
