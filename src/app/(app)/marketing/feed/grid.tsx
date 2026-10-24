'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarDays, Check, ChevronLeft, ChevronRight, FileText, Film, Images, Loader2, Send, Sparkles, X } from 'lucide-react';
import { Badge, Button, Card, Dot, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { CopyButton, Drawer } from '@/components/ui/client';
import { cn, fmtDate } from '@/lib/utils';
import { createApprovalBatchAction, createContentPlanAction, reviewItemAction, setItemStatusAction } from '@/lib/actions/marketing';
import type { ContentItem, ContentPlan } from '@/lib/db/types';

/** O `Select` das primitives perde o fundo dos campos ao passar pelo tailwind-merge (bg-[right_12px_center] é lido como cor). Restaura o fundo igual ao de Input. */
const SELECT_BG = '[background-color:rgb(255_255_255/0.04)]';


/** "2026-10" vira "outubro de 2026" */
const monthLong = (key: string) => {
  const [y, m] = String(key).split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(y, (m || 1) - 1, 1));
};

/* ------------------------------------------------------------------ */
/* Tipos e helpers de marca                                            */
/* ------------------------------------------------------------------ */

export type BrandTokens = { bg?: string; surface?: string; text?: string; text2?: string; accent?: string; accent2?: string; font_display?: string; font_text?: string };
export type PieceBrand = { name: string; color: string; logo?: string | null; tokens: BrandTokens };
export type BatchInfo = { id: string; title: string; token: string; status: string; expires_at?: string | null; count: number };

const STATUS_LABEL: Record<ContentItem['status'], string> = {
  rascunho: 'Rascunho',
  revisado: 'Revisado',
  em_aprovacao: 'Em aprovação',
  aprovado: 'Aprovado',
  ajustar: 'Ajustar',
  agendado: 'Agendado',
  publicado: 'Publicado',
};
const STATUS_TONE: Record<ContentItem['status'], 'neutral' | 'info' | 'warn' | 'ok' | 'err' | 'accent'> = {
  rascunho: 'neutral',
  revisado: 'info',
  em_aprovacao: 'warn',
  aprovado: 'ok',
  ajustar: 'err',
  agendado: 'accent',
  publicado: 'ok',
};
const STATUS_DOT: Record<ContentItem['status'], 'idle' | 'wave' | 'done' | 'err'> = { rascunho: 'idle', revisado: 'idle', em_aprovacao: 'wave', aprovado: 'done', ajustar: 'err', agendado: 'done', publicado: 'done' };
const FORMAT_LABEL: Record<ContentItem['format'], string> = { post_4x5: 'Post 4:5', carrossel: 'Carrossel', story: 'Story 9:16', capa_reel: 'Capa de Reel' };
const FORMAT_SHORT: Record<ContentItem['format'], string> = { post_4x5: 'P', carrossel: 'C', story: 'S', capa_reel: 'R' };
const SERIES_PALETTE = ['#FF5B1F', '#38BDF8', '#3DDC97', '#A78BFA', '#FBBF24', '#F472B6', '#94A3B8'];

function artOf(item: Pick<ContentItem, 'art'>): Record<string, any> {
  return (item.art || {}) as Record<string, any>;
}

function hexOr(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  return fallback;
}
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}
const onColor = (hex: string) => (lum(hex) > 0.4 ? '#0a0a0a' : '#ffffff');
const safeFont = (n?: string) => (n && /^[A-Za-z0-9 ]{2,40}$/.test(n.trim()) ? n.trim() : '');
const stack = (n: string | undefined, fb: string) => (safeFont(n) ? `"${safeFont(n)}", ${fb}` : fb);
const isCondensed = (n?: string) => /condensed|bebas|anton|oswald|league gothic|big shoulders/i.test(n || '');

/** Peça com 1 slide (post, story, capa) ou capa + cards + chamada (carrossel). */
function slideCount(item: Pick<ContentItem, 'format' | 'art'>): number {
  if (item.format !== 'carrossel') return 1;
  const cards = (artOf(item).cards as string[] | undefined) || [];
  return 1 + cards.length + (artOf(item).cta ? 1 : 0);
}

/** Dia (AAAA-MM-DD) no fuso de São Paulo. */
function dayKey(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Carrega as fontes da marca (Google Fonts) só para a prévia. Sem rede, cai na fonte do sistema. */
export function BrandFonts({ tokens }: { tokens: BrandTokens }) {
  const fams = Array.from(new Set([safeFont(tokens.font_display), safeFont(tokens.font_text)].filter(Boolean)));
  if (!fams.length) return null;
  const href = `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;700`).join('&')}&display=swap`;
  const extra = { precedence: 'brand-fonts' } as Record<string, string>;
  return <link rel="stylesheet" href={href} {...extra} />;
}

/* ------------------------------------------------------------------ */
/* Peça renderizada em HTML (4:5 ou 9:16) com os tokens do BrandKit    */
/* ------------------------------------------------------------------ */

export function ArtCard({
  item,
  brand,
  index = 0,
  slide = 0,
  dots = false,
  className,
}: {
  item: Pick<ContentItem, 'format' | 'series' | 'hook' | 'art'>;
  brand: PieceBrand;
  index?: number;
  slide?: number;
  dots?: boolean;
  className?: string;
}) {
  const a = artOf(item);
  const t = brand.tokens;
  const story = item.format === 'story';
  const tone: 'escuro' | 'claro' = a.tone === 'claro' || a.tone === 'escuro' ? a.tone : index % 2 === 0 ? 'escuro' : 'claro';
  const bgTok = hexOr(t.bg, '#0a0a0a');
  const txTok = hexOr(t.text, '#f5f5f3');
  const darkBase = lum(bgTok) < 0.45 ? bgTok : lum(txTok) < 0.45 ? txTok : '#0a0a0a';
  const lightBase = lum(txTok) >= 0.45 ? txTok : lum(bgTok) >= 0.45 ? bgTok : '#f5f5f3';
  const dark = tone === 'escuro';
  const bg = dark ? darkBase : lightBase;
  const fg = dark ? lightBase : darkBase;
  const sub = mix(fg, bg, 0.42);
  const accent = hexOr(t.accent, hexOr(brand.color, '#ff5b1f'));
  const display = stack(t.font_display, '"Barlow Condensed", ui-sans-serif, system-ui, sans-serif');
  const body = stack(t.font_text, '"Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif');
  const upper = isCondensed(t.font_display) || !t.font_display;
  const cards = (a.cards as string[] | undefined) || [];
  const total = slideCount(item);
  const lastIdx = total - 1;
  const kind: 'cover' | 'card' | 'cta' = item.format === 'carrossel' && slide > 0 ? (slide === lastIdx && a.cta ? 'cta' : 'card') : 'cover';
  const headline: string = String(a.headline || item.hook || '');
  const hSize = headline.length <= 22 ? 14 : headline.length <= 38 ? 11.5 : 9.5;
  const initials = brand.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');

  const mark = brand.logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={brand.logo} alt="" style={{ height: '6.4cqw', width: '6.4cqw', borderRadius: '1.6cqw', objectFit: 'cover' }} />
  ) : (
    <span style={{ display: 'grid', placeItems: 'center', height: '6.4cqw', width: '6.4cqw', borderRadius: '50%', background: accent, color: onColor(accent), fontSize: '2.6cqw', fontWeight: 700, fontFamily: display }}>{initials}</span>
  );

  return (
    <div
      className={cn('relative w-full select-none overflow-hidden', className)}
      style={{ aspectRatio: story ? '9 / 16' : '4 / 5', background: bg, color: fg, containerType: 'inline-size', fontFamily: body }}
      role="img"
      aria-label={`${FORMAT_LABEL[item.format]}: ${headline}`}
    >
      {story && (
        <div style={{ position: 'absolute', top: '3cqw', left: '5cqw', right: '5cqw', display: 'flex', gap: '1.2cqw' }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ height: '0.9cqw', flex: 1, borderRadius: '1cqw', background: i === 0 ? fg : mix(fg, bg, 0.7) }} />
          ))}
        </div>
      )}

      <div style={{ position: 'absolute', top: story ? '8cqw' : '6cqw', left: '6cqw', right: '6cqw', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '2.8cqw', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, color: accent }}>{item.series || brand.name}</span>
        {total > 1 ? <span style={{ fontSize: '2.8cqw', color: sub, fontWeight: 600 }}>{slide + 1}/{total}</span> : mark}
      </div>

      {kind === 'cover' && (
        <>
          <div style={{ position: 'absolute', left: '6cqw', right: '6cqw', bottom: story ? '30cqw' : '22cqw' }}>
            <span style={{ display: 'block', width: '12cqw', height: '1.3cqw', background: accent, marginBottom: '4cqw' }} />
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: `${hSize}cqw`, lineHeight: 0.96, letterSpacing: '-0.01em', textTransform: upper ? 'uppercase' : 'none', textWrap: 'balance' as any }}>{headline}</div>
            {a.support && <div style={{ marginTop: '3.4cqw', fontSize: '4.2cqw', lineHeight: 1.3, color: sub }}>{String(a.support)}</div>}
          </div>
          {a.cta && item.format !== 'carrossel' && (
            <div style={{ position: 'absolute', left: '6cqw', bottom: dots ? '9cqw' : '7cqw', background: accent, color: onColor(accent), padding: '2cqw 4.4cqw', borderRadius: '99cqw', fontSize: '3.4cqw', fontWeight: 700 }}>{String(a.cta)}</div>
          )}
          {item.format === 'carrossel' && (
            <div style={{ position: 'absolute', left: '6cqw', bottom: dots ? '9cqw' : '7cqw', fontSize: '3.2cqw', color: sub, fontWeight: 600 }}>Arraste para o lado</div>
          )}
        </>
      )}

      {kind === 'card' && (
        <div style={{ position: 'absolute', left: '6cqw', right: '6cqw', top: '22cqw', bottom: '14cqw', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '5cqw' }}>
          <span style={{ fontFamily: display, fontWeight: 700, fontSize: '16cqw', lineHeight: 0.9, color: accent }}>{String(slide).padStart(2, '0')}</span>
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: '8.6cqw', lineHeight: 1.02, letterSpacing: '-0.005em', textTransform: upper ? 'uppercase' : 'none', textWrap: 'balance' as any }}>{String(cards[slide - 1] || '')}</div>
        </div>
      )}

      {kind === 'cta' && (
        <div style={{ position: 'absolute', left: '6cqw', right: '6cqw', top: '22cqw', bottom: '14cqw', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', gap: '6cqw' }}>
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: '11cqw', lineHeight: 0.96, textTransform: upper ? 'uppercase' : 'none', textWrap: 'balance' as any }}>{String(a.cta)}</div>
          <span style={{ background: accent, color: onColor(accent), padding: '2.4cqw 5cqw', borderRadius: '99cqw', fontSize: '3.6cqw', fontWeight: 700 }}>Link na bio</span>
        </div>
      )}

      <div style={{ position: 'absolute', left: '6cqw', right: '6cqw', bottom: '2.6cqw', display: 'flex', alignItems: 'center', justifyContent: dots && total > 1 ? 'center' : 'flex-end', gap: '1.2cqw' }}>
        {dots && total > 1
          ? Array.from({ length: total }, (_, i) => <span key={i} style={{ height: '1.5cqw', width: '1.5cqw', borderRadius: '50%', background: i === slide ? accent : mix(fg, bg, 0.65) }} />)
          : kind === 'cover' && <span style={{ fontSize: '2.6cqw', color: sub }}>{brand.name}</span>}
      </div>
    </div>
  );
}

/** Carrossel navegável (usa o ArtCard por slide). */
export function SlideDeck({ item, brand, index = 0, className }: { item: Pick<ContentItem, 'format' | 'series' | 'hook' | 'art'>; brand: PieceBrand; index?: number; className?: string }) {
  const total = slideCount(item);
  const [i, setI] = useState(0);
  return (
    <div className={className}>
      <BrandFonts tokens={brand.tokens} />
      <div className={cn('relative mx-auto w-full', item.format === 'story' ? 'max-w-[220px]' : 'max-w-[320px]')}>
        <ArtCard item={item} brand={brand} index={index} slide={i} dots className="rounded-xl" />
        {total > 1 && (
          <>
            <button type="button" aria-label="Slide anterior" disabled={i === 0} onClick={() => setI((x) => Math.max(0, x - 1))} className="press absolute left-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white disabled:opacity-0">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Próximo slide" disabled={i === total - 1} onClick={() => setI((x) => Math.min(total - 1, x + 1))} className="press absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white disabled:opacity-0">
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formulário "Planejar mês"                                           */
/* ------------------------------------------------------------------ */

export function PlanForm({ clientId, defaultMonth }: { clientId: string; defaultMonth: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mix, setMix] = useState({ prova: 30, educativo: 25, bastidor: 20, opiniao: 15, oferta: 10 });
  const total = Object.values(mix).reduce((a, b) => a + (Number(b) || 0), 0);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          try {
            const r = await createContentPlanAction(fd);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            toast.success(r.isExample ? `Plano criado com ${r.created} peças de exemplo` : `Plano criado com ${r.created} peças`);
            router.push(`/marketing/feed?plan=${r.id}`);
            router.refresh();
          } catch (err) {
            toast.error((err as Error).message);
          }
        });
      }}
    >
      <input type="hidden" name="client_id" value={clientId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mês" required>
          <Input type="month" name="month" defaultValue={defaultMonth} required placeholder="AAAA-MM" pattern="\d{4}-\d{2}" />
        </Field>
        <Field label="Peças no mês">
          <Input type="number" name="quantity" defaultValue={20} min={4} max={40} />
        </Field>
      </div>
      <Field label="Objetivo do mês" hint="Uma frase. Ex.: lotar a agenda de novembro.">
        <Textarea name="goal" className="min-h-[64px]" placeholder="Ex.: encher a agenda de shows de novembro" />
      </Field>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[13px] font-medium text-ink">Mix de conteúdo (%)</span>
          <span className={cn('num text-xs', total === 100 ? 'text-ok' : 'text-warn')}>{total}%</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {(
            [
              ['prova', 'Prova'],
              ['educativo', 'Educ.'],
              ['bastidor', 'Basti.'],
              ['opiniao', 'Opin.'],
              ['oferta', 'Oferta'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="block">
              <span className="label mb-1 block text-[10px]">{label}</span>
              <Input type="number" name={`mix_${k}`} value={mix[k]} min={0} max={100} onChange={(e) => setMix((m) => ({ ...m, [k]: Number(e.target.value) }))} className="px-2 text-center" />
            </label>
          ))}
        </div>
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {pending ? 'Planejando o mês…' : 'Planejar mês'}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Plano: calendário do mês + prévia do perfil + detalhe da peça       */
/* ------------------------------------------------------------------ */

type ReviewResult = { text: string; isExample: boolean; checks: { label: string; ok: boolean; detail: string }[] };
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function PlanBoard({ plan, items, brand, batches, origin }: { plan: ContentPlan; items: ContentItem[]; brand: PieceBrand; batches: BatchInfo[]; origin: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [reviews, setReviews] = useState<Record<string, ReviewResult>>({});
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [override, setOverride] = useState<Record<string, { from: ContentItem['status']; to: ContentItem['status'] }>>({});

  const statusOf = (it: ContentItem) => {
    const o = override[it.id];
    return o && o.from === it.status ? o.to : it.status;
  };
  const sorted = useMemo(() => [...items].sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || '')), [items]);
  const indexById = useMemo(() => Object.fromEntries(sorted.map((it, i) => [it.id, i])) as Record<string, number>, [sorted]);
  const seriesNames = useMemo(() => {
    const names: string[] = [];
    for (const s of plan.series || []) if (!names.includes(s.name)) names.push(s.name);
    for (const it of sorted) if (it.series && !names.includes(it.series)) names.push(it.series);
    return names;
  }, [plan.series, sorted]);
  const colorOf = (s?: string | null) => SERIES_PALETTE[Math.max(0, seriesNames.indexOf(s || '')) % SERIES_PALETTE.length];

  const [y, m] = plan.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const nDays = new Date(y, m, 0).getDate();
  const cells: (number | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: nDays }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const byDay: Record<number, ContentItem[]> = {};
  const outside: ContentItem[] = [];
  for (const it of sorted) {
    const k = dayKey(it.scheduled_at);
    if (k && k.startsWith(plan.month)) (byDay[Number(k.slice(8, 10))] ||= []).push(it);
    else outside.push(it);
  }
  const todayKey = dayKey(new Date().toISOString());

  const stories = sorted.filter((i) => i.format === 'story');
  const posts = sorted.filter((i) => i.format !== 'story').reverse();
  const eligible = items.filter((i) => i.status === 'rascunho' || i.status === 'revisado').length;
  const approved = items.filter((i) => ['aprovado', 'agendado', 'publicado'].includes(i.status)).length;
  const current = items.find((i) => i.id === selected) || null;
  const exportText = sorted
    .map((it) => `${fmtDate(it.scheduled_at, { day: '2-digit', month: '2-digit' })} · ${FORMAT_LABEL[it.format]}${it.series ? ` · ${it.series}` : ''}\n${it.caption || ''}\n${(it.hashtags || []).join(' ')}`.trim())
    .join('\n\n---\n\n');

  function sendBatch() {
    if (!window.confirm(`Enviar ${eligible} peça(s) para aprovação do cliente? O link vale por 7 dias.`)) return;
    start(async () => {
      try {
        const r = await createApprovalBatchAction(plan.id);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        setLink(r.path);
        toast.success(`${r.count} peças enviadas para aprovação`);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function setStatus(it: ContentItem, status: ContentItem['status']) {
    setOverride((o) => ({ ...o, [it.id]: { from: it.status, to: status } }));
    start(async () => {
      try {
        const r = await setItemStatusAction(it.id, status);
        if (!r.ok) {
          toast.error(r.error);
          setOverride((o) => {
            const { [it.id]: _gone, ...rest } = o;
            return rest;
          });
          return;
        }
        toast.success(`Peça marcada como ${STATUS_LABEL[status].toLowerCase()}`);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  async function runReview(id: string) {
    setReviewing(id);
    try {
      const r = await reviewItemAction(id);
      if (!r.ok) toast.error(r.error);
      else setReviews((s) => ({ ...s, [id]: { text: r.text, isExample: r.isExample, checks: r.checks } }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReviewing(null);
    }
  }

  const chip = (it: ContentItem) => {
    const c = colorOf(it.series);
    return (
      <button
        key={it.id}
        type="button"
        onClick={() => setSelected(it.id)}
        title={`${FORMAT_LABEL[it.format]} · ${it.series || 'sem série'} · ${it.hook}`}
        className={cn('press flex w-full items-center gap-1 truncate rounded-md border-l-2 px-1 py-0.5 text-left text-[10px] leading-tight text-ink hover:brightness-125', selected === it.id && 'ring-1 ring-accent')}
        style={{ background: `${c}26`, borderColor: c }}
      >
        <Dot state={STATUS_DOT[statusOf(it)]} className="!h-1.5 !w-1.5" />
        <span className="num hidden shrink-0 text-[10px] md:inline" style={{ color: c }}>{FORMAT_SHORT[it.format]}</span>
        <span className="hidden truncate md:inline">{it.hook}</span>
      </button>
    );
  };

  const pieceBtn = (it: ContentItem, w: string) => (
    <button
      key={it.id}
      type="button"
      onClick={() => setSelected(it.id)}
      aria-label={`Abrir peça: ${it.hook}`}
      className={cn('press group relative block overflow-hidden bg-black text-left', w, selected === it.id && 'ring-2 ring-accent')}
    >
      <ArtCard item={it} brand={brand} index={indexById[it.id] || 0} dots={it.format === 'carrossel'} />
      <span className="absolute right-1 top-1 text-white drop-shadow">{it.format === 'carrossel' ? <Images className="h-3.5 w-3.5" /> : it.format === 'capa_reel' ? <Film className="h-3.5 w-3.5" /> : null}</span>
      <span className="absolute bottom-1 left-1 grid h-4 w-4 place-items-center rounded-full bg-black/60"><Dot state={STATUS_DOT[statusOf(it)]} className="!h-1.5 !w-1.5" /></span>
    </button>
  );

  return (
    <div className="space-y-6">
      <BrandFonts tokens={brand.tokens} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={plan.status === 'aprovado' ? 'ok' : plan.status === 'em_aprovacao' ? 'warn' : 'neutral'}>{plan.status === 'em_aprovacao' ? 'Em aprovação' : plan.status === 'aprovado' ? 'Aprovado' : 'Rascunho'}</Badge>
          <span className="text-sm text-ink2">
            <b className="num text-base text-ink">{approved}</b> de {items.length} aprovadas
          </span>
          {plan.goal && <span className="hidden max-w-md truncate text-xs text-ink3 md:inline">· {plan.goal}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="subtle" size="sm" onClick={() => setShowExport((v) => !v)}>
            <FileText className="h-3.5 w-3.5" /> Exportar legendas
          </Button>
          <Button onClick={sendBatch} disabled={pending || eligible === 0}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar lote para aprovação{eligible ? ` (${eligible})` : ''}
          </Button>
        </div>
      </div>

      {link && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <Check className="h-4 w-4 text-ok" />
          <div className="min-w-0 flex-1">
            <div className="label">Link para o cliente</div>
            <code className="block truncate font-mono text-xs text-ink">{origin + link}</code>
          </div>
          <CopyButton text={origin + link} label="Copiar link" />
          <Button variant="ghost" size="sm" href={link}>Abrir portal</Button>
        </Card>
      )}

      {showExport && (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="label">Legendas do mês · {sorted.length} peças</div>
            <CopyButton text={exportText} label="Copiar tudo" />
          </div>
          <textarea readOnly value={exportText} className="focus-ring h-64 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] p-3 font-mono text-xs leading-relaxed text-ink" />
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Calendário */}
        <section className="space-y-3 lg:col-span-2">
          <div className="flex items-end justify-between">
            <div>
              <div className="label">Calendário</div>
              <h2 className="display text-xl text-ink">{monthLong(plan.month)}</h2>
            </div>
            <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
              {seriesNames.map((s) => (
                <span key={s} className="flex items-center gap-1.5 text-[11px] text-ink2" title={plan.series?.find((x) => x.name === s)?.goal}>
                  <span className="h-2 w-2 rounded-sm" style={{ background: colorOf(s) }} />
                  {s}
                </span>
              ))}
            </div>
          </div>
          <div className="card overflow-hidden">
            <div className="grid grid-cols-7 border-b border-white/[0.07]">
              {WEEKDAYS.map((w) => (
                <div key={w} className="label px-2 py-2 text-center text-[10px]">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((day, i) => {
                const list = day ? byDay[day] || [] : [];
                const key = day ? `${plan.month}-${String(day).padStart(2, '0')}` : '';
                return (
                  <div key={i} className={cn('min-h-[64px] border-b border-r border-white/[0.05] p-1 md:min-h-[96px] md:p-1.5', !day && 'bg-white/[0.015]', (i + 1) % 7 === 0 && 'border-r-0')}>
                    {day && (
                      <>
                        <div className={cn('num mb-1 text-xs', key === todayKey ? 'inline-grid h-5 w-5 place-items-center rounded-full bg-accent text-black' : 'text-ink3')}>{day}</div>
                        <div className="space-y-1">
                          {list.slice(0, 3).map(chip)}
                          {list.length > 3 && <div className="px-1 text-[10px] text-ink3">+{list.length - 3}</div>}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {outside.length > 0 && (
            <div className="rounded-xl border border-white/[0.07] p-3">
              <div className="label mb-2">Sem data neste mês</div>
              <div className="flex flex-wrap gap-2">
                {outside.map((it) => (
                  <button key={it.id} type="button" onClick={() => setSelected(it.id)} className="press rounded-full bg-white/[0.06] px-3 py-1 text-xs text-ink2 hover:text-ink">
                    {it.hook.slice(0, 40)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Prévia do perfil */}
        <aside className="space-y-3">
          <div>
            <div className="label">Prévia do perfil</div>
            <h2 className="display text-xl text-ink">Como o feed vai ficar</h2>
          </div>
          <div className="overflow-hidden rounded-3xl border border-white/[0.09] bg-black">
            <div className="flex items-center gap-3 px-4 pt-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-semibold" style={{ background: brand.color, color: onColor(hexOr(brand.color, '#ff5b1f')) }}>
                {brand.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logo} alt="" className="h-full w-full object-cover" />
                ) : (
                  brand.name.slice(0, 2).toUpperCase()
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{brand.name}</div>
                <div className="mt-1 flex gap-4 text-xs text-white/60">
                  <span><b className="num text-sm text-white">{posts.length}</b> publicações</span>
                  <span><b className="num text-sm text-white">{stories.length}</b> stories</span>
                </div>
              </div>
            </div>
            {stories.length > 0 && (
              <div className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
                {stories.map((it) => (
                  <div key={it.id} className="shrink-0">
                    {pieceBtn(it, 'w-[60px] rounded-lg')}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 border-t border-white/10 pt-px">
              {posts.length === 0 ? (
                <p className="p-6 text-center text-xs text-white/50">Sem publicações neste plano.</p>
              ) : (
                <div className="grid grid-cols-3 gap-[2px]">{posts.map((it) => pieceBtn(it, 'w-full'))}</div>
              )}
            </div>
            <div className="border-t border-white/10 px-4 py-2 text-center text-[10px] text-white/40">Ordem do Instagram: mais recente primeiro</div>
          </div>
        </aside>
      </div>

      {batches.length > 0 && (
        <section className="space-y-3">
          <div className="label">Lotes enviados ao cliente</div>
          <Card className="divide-y divide-white/[0.05] p-2">
            {batches.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <Dot state={b.status === 'aprovado' ? 'done' : b.status === 'ajustes' ? 'err' : b.status === 'expirado' ? 'off' : 'wave'} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{b.title}</div>
                  <div className="text-xs text-ink3">{b.count} peças · {b.status}{b.expires_at ? ` · vale até ${fmtDate(b.expires_at)}` : ''}</div>
                </div>
                <CopyButton text={`${origin}/aprovar/${b.token}`} label="Copiar link" />
                <Button variant="ghost" size="sm" href={`/aprovar/${b.token}`}>Abrir</Button>
              </div>
            ))}
          </Card>
        </section>
      )}

      {/* Detalhe da peça */}
      <Drawer open={!!current} onClose={() => setSelected(null)} title={current ? FORMAT_LABEL[current.format] : ''}>
        {current && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[statusOf(current)]}>{STATUS_LABEL[statusOf(current)]}</Badge>
              {current.series && (
                <span className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-ink2">
                  <span className="h-2 w-2 rounded-sm" style={{ background: colorOf(current.series) }} />
                  {current.series}
                </span>
              )}
              {current.scheduled_at && (
                <span className="flex items-center gap-1 text-xs text-ink3">
                  <CalendarDays className="h-3.5 w-3.5" /> {fmtDate(current.scheduled_at, { weekday: 'short', day: '2-digit', month: 'short' })}
                </span>
              )}
              <span className="text-xs text-ink3">v{current.version}</span>
            </div>
            <p className="text-sm font-medium leading-snug text-ink">{current.hook}</p>

            <SlideDeck key={current.id} item={current} brand={brand} index={indexById[current.id] || 0} />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="label">Legenda</div>
                <CopyButton text={current.caption || ''} />
              </div>
              <p className="whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3 text-sm leading-relaxed text-ink">{current.caption || 'Sem legenda.'}</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="label">Hashtags</div>
                <CopyButton text={(current.hashtags || []).join(' ')} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(current.hashtags || []).length ? (current.hashtags || []).map((h) => <Badge key={h}>{h}</Badge>) : <span className="text-xs text-ink3">Sem hashtags.</span>}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="label">Texto alternativo</div>
                <CopyButton text={current.alt_text || ''} />
              </div>
              <p className="rounded-xl bg-white/[0.04] p-3 text-sm text-ink2">{current.alt_text || 'Sem texto alternativo.'}</p>
            </div>

            <div className="hairline" />

            <Field label="Status da peça">
              <Select className={SELECT_BG} value={statusOf(current)} disabled={pending} onChange={(e) => setStatus(current, e.target.value as ContentItem['status'])}>
                {(Object.keys(STATUS_LABEL) as ContentItem['status'][]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="subtle" disabled={pending} onClick={() => setStatus(current, 'ajustar')}>
                <X className="h-4 w-4" /> Pedir ajuste
              </Button>
              <Button disabled={pending} onClick={() => setStatus(current, 'aprovado')}>
                <Check className="h-4 w-4" /> Aprovar
              </Button>
              <Button variant="glass" disabled={reviewing === current.id} onClick={() => runReview(current.id)}>
                {reviewing === current.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Revisar com IA
              </Button>
            </div>

            {reviews[current.id] && (
              <div className="space-y-3 rounded-2xl border border-white/10 p-4">
                <div className="label">
                  Revisão da marca
                  {reviews[current.id].isExample && <Badge tone="warn" className="ml-2 align-middle">checagem automática · configure a chave da IA</Badge>}
                </div>
                <ul className="space-y-1.5">
                  {reviews[current.id].checks.map((c) => (
                    <li key={c.label} className="flex items-start gap-2 text-xs">
                      <Dot state={c.ok ? 'done' : 'err'} className="mt-1" />
                      <span className="text-ink">{c.label}<span className="text-ink3"> · {c.detail}</span></span>
                    </li>
                  ))}
                </ul>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink2">{reviews[current.id].text}</p>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
