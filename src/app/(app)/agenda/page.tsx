import Link from 'next/link';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { Card, Field, Input, PageHeader, Section, Select } from '@/components/ui/primitives';
import { ActionButton, ActionForm, SubmitButton } from '@/components/ui/client';
import { createEventAction, deleteEventAction } from '@/lib/actions/ops';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Agenda' };

type SP = { m?: string; d?: string };

/* ---------- Datas em Brasília ---------- */

const TZ = 'America/Sao_Paulo';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Dia (AAAA-MM-DD) de um instante, sempre no fuso de Brasília. */
function dayKey(v?: string | null) {
  if (!v) return '';
  if (DATE_ONLY.test(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v) && !/(Z|[+-]\d{2}:?\d{2})$/.test(v)) return v.slice(0, 10);
  const dt = new Date(v);
  return Number.isNaN(dt.getTime()) ? '' : dayFmt.format(dt);
}
const hasTime = (v?: string | null) => Boolean(v && !DATE_ONLY.test(v));
const timeOf = (v: string) => {
  const dt = new Date(v);
  return Number.isNaN(dt.getTime()) ? '' : timeFmt.format(dt);
};
const utcDate = (key: string) => new Date(`${key}T00:00:00Z`);
const shiftDay = (key: string, n: number) => {
  const dt = utcDate(key);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const longDay = (key: string) => new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(utcDate(key));
const shortDay = (key: string) => new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(utcDate(key)).replace(/\./g, '');

/* ---------- Marcadores ---------- */

type MarkerKind = 'reuniao' | 'diaria' | 'entrega' | 'publicacao' | 'outro' | 'tarefa' | 'projeto';

const KIND: Record<MarkerKind, { label: string; bar: string; dot: string }> = {
  reuniao: { label: 'Reunião', bar: 'bg-sky-400/15 text-sky-300', dot: 'bg-sky-300' },
  diaria: { label: 'Diária', bar: 'bg-accent/15 text-accent', dot: 'bg-accent' },
  entrega: { label: 'Entrega', bar: 'bg-ok/15 text-ok', dot: 'bg-ok' },
  publicacao: { label: 'Publicação', bar: 'bg-warn/15 text-warn', dot: 'bg-warn' },
  outro: { label: 'Outro', bar: 'bg-white/[0.07] text-ink2', dot: 'bg-ink3' },
  tarefa: { label: 'Prazo de tarefa', bar: 'border border-white/10 text-ink2', dot: 'bg-white/40' },
  projeto: { label: 'Prazo de projeto', bar: 'border border-accent/30 text-ink2', dot: 'border border-accent bg-transparent' },
};
const KIND_ORDER: MarkerKind[] = ['reuniao', 'diaria', 'entrega', 'publicacao', 'outro', 'tarefa', 'projeto'];
const SORT: Record<MarkerKind, number> = { reuniao: 0, diaria: 0, entrega: 0, publicacao: 0, outro: 0, projeto: 1, tarefa: 2 };

type Marker = { id: string; kind: MarkerKind; title: string; time: string; sub: string; href?: string; eventId?: string };

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default async function AgendaPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const today = dayFmt.format(new Date());

  const mm = /^(\d{4})-(\d{2})$/.exec(sp.m || '');
  const monthStr = mm && Number(mm[2]) >= 1 && Number(mm[2]) <= 12 ? `${mm[1]}-${mm[2]}` : today.slice(0, 7);
  const year = Number(monthStr.slice(0, 4));
  const month = Number(monthStr.slice(5, 7));
  const selected = sp.d && DATE_ONLY.test(sp.d) ? sp.d : '';

  const d = await db();
  const [events, tasks, projects, clients] = await Promise.all([d.list('events'), d.list('tasks'), d.list('projects'), d.list('clients')]);
  const clientName = (id?: string | null) => {
    const c = id ? clients.find((x) => x.id === id) : undefined;
    return c ? c.company || c.contact_name : '';
  };
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // Tudo entra no mesmo mapa por dia. A grade e a lista dos próximos dias leem dele.
  const byDay = new Map<string, Marker[]>();
  const add = (key: string, m: Marker) => {
    if (!key) return;
    const list = byDay.get(key);
    if (list) list.push(m);
    else byDay.set(key, [m]);
  };

  for (const e of events) {
    const kind: MarkerKind = (['reuniao', 'diaria', 'entrega', 'publicacao', 'outro'] as const).includes(e.kind) ? e.kind : 'outro';
    add(dayKey(e.starts_at), {
      id: `e-${e.id}`,
      kind,
      title: e.title,
      time: hasTime(e.starts_at) ? timeOf(e.starts_at) : '',
      sub: [KIND[kind].label, clientName(e.client_id)].filter(Boolean).join(' · '),
      eventId: e.id,
    });
  }
  for (const t of tasks) {
    if (t.status === 'feito' || !t.due_at) continue;
    const proj = t.project_id ? projectById.get(t.project_id) : undefined;
    add(dayKey(t.due_at), {
      id: `t-${t.id}`,
      kind: 'tarefa',
      title: t.title,
      time: '',
      sub: [KIND.tarefa.label, proj?.title || clientName(t.client_id)].filter(Boolean).join(' · '),
      href: '/workflow?who=all',
    });
  }
  for (const p of projects) {
    if (p.status === 'finalizado' || !p.due_on) continue;
    add(dayKey(p.due_on), {
      id: `p-${p.id}`,
      kind: 'projeto',
      title: p.title,
      time: '',
      sub: [KIND.projeto.label, clientName(p.client_id)].filter(Boolean).join(' · '),
      href: `/projects?p=${p.id}`,
    });
  }
  for (const list of byDay.values()) list.sort((a, b) => SORT[a.kind] - SORT[b.kind] || a.time.localeCompare(b.time) || a.title.localeCompare(b.title, 'pt-BR'));

  // Grade: domingo a sábado, com os dias vizinhos esmaecidos.
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: total }, (_, i) => {
    const dt = new Date(Date.UTC(year, month - 1, 1 - lead + i));
    return { key: dt.toISOString().slice(0, 10), day: dt.getUTCDate(), inMonth: dt.getUTCMonth() === month - 1 };
  });
  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const prevMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);

  const inMonth = (key: string) => key.startsWith(monthStr);
  const monthCount = (kinds: MarkerKind[]) => [...byDay.entries()].filter(([k]) => inMonth(k)).reduce((s, [, l]) => s + l.filter((m) => kinds.includes(m.kind)).length, 0);
  const nEvents = monthCount(['reuniao', 'diaria', 'entrega', 'publicacao', 'outro']);
  const nDeadlines = monthCount(['tarefa', 'projeto']);

  const upcoming = Array.from({ length: 14 }, (_, i) => shiftDay(today, i))
    .map((key) => ({ key, items: byDay.get(key) || [] }))
    .filter((x) => x.items.length > 0);
  const upcomingLabel = (key: string) => (key === today ? 'Hoje' : key === shiftDay(today, 1) ? 'Amanhã' : shortDay(key));

  const dayItems = selected ? byDay.get(selected) || [] : [];
  const formDate = selected || today;

  return (
    <div>
      <PageHeader
        kicker="Operação"
        title="Agenda"
        subtitle={`${nEvents} ${nEvents === 1 ? 'evento' : 'eventos'} e ${nDeadlines} ${nDeadlines === 1 ? 'prazo' : 'prazos'} em ${monthLabel}. Prazos de tarefas e de projetos aparecem como marcadores.`}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
              <h2 className="display text-xl text-ink">{monthLabel}</h2>
              <div className="flex items-center gap-1">
                <Link href={`/agenda?m=${prevMonth}`} aria-label="Mês anterior" className="press focus-ring grid h-9 w-9 place-items-center rounded-full text-ink2 hover:bg-white/[0.06] hover:text-ink">
                  <ChevronLeft className="h-4 w-4" />
                </Link>
                <Link href={`/agenda?m=${today.slice(0, 7)}`} className="press focus-ring rounded-full px-3 py-1.5 text-[13px] font-medium text-ink2 hover:bg-white/[0.06] hover:text-ink">
                  Hoje
                </Link>
                <Link href={`/agenda?m=${nextMonth}`} aria-label="Próximo mês" className="press focus-ring grid h-9 w-9 place-items-center rounded-full text-ink2 hover:bg-white/[0.06] hover:text-ink">
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-px bg-white/[0.06]">
              {WEEKDAYS.map((w) => (
                <div key={w} className="label bg-s1 px-2 py-2 text-center">
                  {w}
                </div>
              ))}
              {cells.map((c) => {
                const items = byDay.get(c.key) || [];
                const isToday = c.key === today;
                const isSelected = c.key === selected;
                return (
                  <Link
                    key={c.key}
                    href={`/agenda?m=${monthStr}&d=${c.key}`}
                    scroll={false}
                    aria-label={`${longDay(c.key)}${items.length ? `, ${items.length} ${items.length === 1 ? 'item' : 'itens'}` : ''}`}
                    aria-current={isToday ? 'date' : undefined}
                    className={cn('focus-ring block min-h-[84px] p-1.5 transition-colors hover:bg-white/[0.04] sm:min-h-[112px] sm:p-2', c.inMonth ? 'bg-s1' : 'bg-bg text-ink3', isSelected && 'ring-1 ring-inset ring-accent/70')}
                  >
                    <span className={cn('num inline-grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs', isToday ? 'bg-accent text-black' : c.inMonth ? 'text-ink2' : 'text-ink3')}>{c.day}</span>
                    {items.length > 0 && (
                      <>
                        <ul className="mt-1 hidden space-y-1 sm:block">
                          {items.slice(0, 3).map((m) => (
                            <li key={m.id} className={cn('truncate rounded-md px-1.5 py-0.5 text-[11px] leading-tight', KIND[m.kind].bar)}>
                              {m.time ? `${m.time} ` : ''}
                              {m.title}
                            </li>
                          ))}
                          {items.length > 3 && <li className="px-1.5 text-[11px] text-ink3">+{items.length - 3}</li>}
                        </ul>
                        <div className="mt-1.5 flex flex-wrap gap-1 sm:hidden">
                          {items.slice(0, 4).map((m) => (
                            <span key={m.id} className={cn('h-1.5 w-1.5 rounded-full', KIND[m.kind].dot)} />
                          ))}
                        </div>
                      </>
                    )}
                  </Link>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-white/[0.06] px-4 py-3 text-xs text-ink3">
              {KIND_ORDER.map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', KIND[k].dot)} />
                  {KIND[k].label}
                </span>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {selected && (
            <Section
              title={longDay(selected)}
              kicker="Dia selecionado"
              action={
                <Link href={`/agenda?m=${monthStr}`} scroll={false} className="text-xs text-ink2 hover:text-ink">
                  Fechar
                </Link>
              }
            >
              {dayItems.length === 0 ? (
                <Card className="p-5 text-sm text-ink2">Nada marcado neste dia. Use o formulário abaixo para criar um evento.</Card>
              ) : (
                <Card className="divide-y divide-white/[0.05] p-2">
                  {dayItems.map((m) => (
                    <MarkerRow key={m.id} m={m} />
                  ))}
                </Card>
              )}
            </Section>
          )}

          <Section title="Próximos 14 dias" kicker="Daqui para frente">
            {upcoming.length === 0 ? (
              <Card className="p-5 text-sm text-ink2">Nada marcado nos próximos 14 dias.</Card>
            ) : (
              <Card className="space-y-4 p-3">
                {upcoming.map((g) => (
                  <div key={g.key}>
                    <div className="label px-2 pb-1">{upcomingLabel(g.key)}</div>
                    <div className="divide-y divide-white/[0.05]">
                      {g.items.map((m) => (
                        <MarkerRow key={m.id} m={m} />
                      ))}
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </Section>

          <Section title="Novo evento" kicker="Agendar">
            <Card className="p-5">
              <ActionForm action={createEventAction} success="Evento criado" resetOnSuccess className="space-y-3">
                <Field label="Título" required>
                  <Input name="title" placeholder="Ex.: Diária de captação" required />
                </Field>
                <Field label="Tipo">
                  <Select name="kind" defaultValue="reuniao">
                    {(['reuniao', 'diaria', 'entrega', 'publicacao', 'outro'] as const).map((k) => (
                      <option key={k} value={k}>
                        {KIND[k].label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Data" required>
                    <Input key={formDate} type="date" name="date" defaultValue={formDate} required />
                  </Field>
                  <Field label="Hora">
                    <Input type="time" name="time" defaultValue="09:00" />
                  </Field>
                </div>
                <Field label="Cliente" hint="Opcional">
                  <Select name="client_id" defaultValue="">
                    <option value="">Sem cliente</option>
                    {clients
                      .filter((c) => !['encerrado', 'perdido'].includes(c.status))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.company || c.contact_name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <SubmitButton className="w-full">Criar evento</SubmitButton>
              </ActionForm>
            </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}

function MarkerRow({ m }: { m: Marker }) {
  return (
    <div className="flex items-start gap-3 px-2 py-2.5">
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', KIND[m.kind].dot)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink">
          {m.time && <span className="num mr-2 text-ink2">{m.time}</span>}
          {m.href ? (
            <Link href={m.href} className="hover:text-accent">
              {m.title}
            </Link>
          ) : (
            m.title
          )}
        </div>
        <div className="truncate text-xs text-ink3">{m.sub}</div>
      </div>
      {m.eventId && (
        <ActionButton variant="ghost" size="icon" aria-label={`Remover ${m.title}`} action={deleteEventAction.bind(null, m.eventId)} confirm={`Remover o evento "${m.title}"?`} success="Evento removido">
          <Trash2 className="h-4 w-4" />
        </ActionButton>
      )}
    </div>
  );
}
