'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Download, Lock, LockOpen, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Badge, Button, Card, Dot, Example, Field, Input, Table, TD, TH, Textarea } from '@/components/ui/primitives';
import { ActionButton, ActionForm, CopyButton, SubmitButton } from '@/components/ui/client';
import { cn, fmtDate } from '@/lib/utils';
import {
  chooseDirectionAction,
  createBrandKitAction,
  generateBrandStepAction,
  setBrandModeAction,
  setBrandStatusAction,
  toggleLockAction,
  updateBrandFieldAction,
} from '@/lib/actions/marketing';
import { ArtCard, BrandFonts } from '../feed/grid';
import type { BrandKit } from '@/lib/db/types';

/* ------------------------------------------------------------------ */
/* Helpers defensivos: o JSON vindo da IA pode variar de forma         */
/* ------------------------------------------------------------------ */

const o = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const a = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(txt).join(', ');
  if (typeof v === 'object') return Object.values(v as object).map(txt).join(' · ');
  return String(v);
};
const hex = (v: unknown, fb = '#000000') => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : fb);
const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
};

type Mode = BrandKit['mode'];
export const MODES: { id: Mode; label: string; text: string }[] = [
  { id: 'zero', label: 'Do zero', text: 'Marca nova, sem identidade anterior.' },
  { id: 'rebranding', label: 'Rebranding', text: 'Mudança profunda de posicionamento e visual.' },
  { id: 'refresh', label: 'Refresh', text: 'Mantém a essência e atualiza o visual.' },
  { id: 'importado', label: 'Importado', text: 'Já existe manual ou identidade. O sistema organiza e completa.' },
];

const STEPS = [
  { n: 1, label: 'Diagnóstico de marca', short: 'Diagnóstico', hint: 'Como a marca é vista hoje, o que funciona e o que incomoda.' },
  { n: 2, label: 'Estratégia', short: 'Estratégia', hint: 'Propósito, posicionamento, público e assinatura.' },
  { n: 3, label: 'Sistema verbal', short: 'Verbal', hint: 'Tom, vocabulário próprio, proibidos e chamadas.' },
  { n: 4, label: 'Sistema visual', short: 'Visual', hint: 'Três direções de cor, tipografia e grafismo. Escolha uma.' },
  { n: 5, label: 'Aplicações', short: 'Aplicações', hint: 'Como a marca aparece nas peças do dia a dia.' },
  { n: 6, label: 'Manual da marca', short: 'Manual', hint: 'Capítulos, tokens e a skill para os agentes criarem peças.' },
];

const STATUS_TONE = { rascunho: 'neutral', em_aprovacao: 'warn', aprovado: 'ok' } as const;
const STATUS_LABEL = { rascunho: 'Rascunho', em_aprovacao: 'Em aprovação', aprovado: 'Aprovado' } as const;

function stepHasContent(kit: BrandKit, n: number): boolean {
  switch (n) {
    case 1:
      return Object.keys(o(kit.diagnosis)).filter((k) => k !== '_example').length > 0;
    case 2:
      return Object.keys(o(kit.strategy)).filter((k) => k !== '_example').length > 0;
    case 3:
      return Object.keys(o(kit.verbal)).filter((k) => k !== '_example').length > 0;
    case 4:
      return a(o(kit.visual).direcoes).length > 0;
    case 5:
      return a(o(kit.applications).aplicacoes).length > 0;
    default:
      return !!o(kit.applications).manual && Object.keys(o(kit.tokens)).length > 0;
  }
}

function stepIsExample(kit: BrandKit, n: number): boolean {
  switch (n) {
    case 1:
      return !!o(kit.diagnosis)._example;
    case 2:
      return !!o(kit.strategy)._example;
    case 3:
      return !!o(kit.verbal)._example;
    case 4:
      return !!o(kit.visual)._example;
    case 5:
      return !!o(kit.applications)._example;
    default:
      return !!o(o(kit.applications).manual)._example;
  }
}

/* ------------------------------------------------------------------ */
/* Átomos de apresentação                                              */
/* ------------------------------------------------------------------ */

function Block({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

function Chips({ items, tone = 'neutral' }: { items: unknown[]; tone?: 'neutral' | 'accent' | 'err' | 'ok' }) {
  if (!items.length) return <span className="text-sm text-ink3">Nada definido.</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((x, i) => (
        <Badge key={i} tone={tone}>
          {txt(x)}
        </Badge>
      ))}
    </div>
  );
}

function Bullets({ items, state = 'idle' }: { items: unknown[]; state?: 'idle' | 'done' | 'err' | 'wave' }) {
  if (!items.length) return <span className="text-sm text-ink3">Nada definido.</span>;
  return (
    <ul className="space-y-1.5">
      {items.map((x, i) => (
        <li key={i} className="flex gap-2.5 text-sm text-ink">
          <Dot state={state} className="mt-1.5" />
          <span>{txt(x)}</span>
        </li>
      ))}
    </ul>
  );
}

function Para({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-ink">{children || <span className="text-ink3">Nada definido.</span>}</p>;
}

/* ------------------------------------------------------------------ */
/* Etapas                                                              */
/* ------------------------------------------------------------------ */

function StepDiagnostico({ data }: { data: Record<string, any> }) {
  return (
    <div className="space-y-6">
      <Block label="Percepção atual">
        <Para>{txt(data.percepcao_atual)}</Para>
      </Block>
      <div className="grid gap-6 md:grid-cols-2">
        <Block label="Pontos fortes">
          <Bullets items={a(data.pontos_fortes)} state="done" />
        </Block>
        <Block label="Incoerências">
          <Bullets items={a(data.incoerencias)} state="err" />
        </Block>
      </div>
      <Block label="Territórios dos concorrentes">
        <Chips items={a(data.territorios_concorrentes)} />
      </Block>
      <Block label="Oportunidades">
        <Bullets items={a(data.oportunidades)} state="wave" />
      </Block>
    </div>
  );
}

function PickAlt({ kitId, field, options, current }: { kitId: string; field: 'posicionamento' | 'assinatura'; options: unknown[]; current: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!options.length) return null;
  return (
    <div className="space-y-1.5">
      {options.map((opt, i) => {
        const t = txt(opt);
        const on = t === current;
        return (
          <button
            key={i}
            type="button"
            disabled={pending || on}
            onClick={() =>
              start(async () => {
                const fd = new FormData();
                fd.set(field, t);
                const r = await updateBrandFieldAction(kitId, fd);
                if (!r.ok) toast.error(r.error);
                else if (r.skipped.length) toast.error('Este campo está travado. Destrave para trocar.');
                else {
                  toast.success('Alternativa aplicada');
                  router.refresh();
                }
              })
            }
            className={cn('press flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm', on ? 'border-accent/60 bg-accent/10 text-ink' : 'border-white/10 text-ink2 hover:border-white/25 hover:text-ink')}
          >
            {on ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" /> : <span className="h-3.5 w-3.5 shrink-0" />}
            {t}
          </button>
        );
      })}
    </div>
  );
}

function StepEstrategia({ kit, data }: { kit: BrandKit; data: Record<string, any> }) {
  const alt = o(data.alternativas);
  const personas = a(data.personas);
  return (
    <div className="space-y-6">
      <Block label="Posicionamento">
        <div className="display text-3xl leading-[0.98] text-ink">{txt(data.posicionamento) || txt(data.frase_conceito) || '–'}</div>
      </Block>
      <div className="grid gap-6 md:grid-cols-2">
        <Block label="Propósito">
          <Para>{txt(data.proposito)}</Para>
        </Block>
        <Block label="Proposta de valor">
          <Para>{txt(data.proposta_valor)}</Para>
        </Block>
        <Block label="Público">
          <Para>{txt(data.publico)}</Para>
        </Block>
        <Block label="Contraponto">
          <Para>{txt(data.contraponto)}</Para>
        </Block>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        <Block label="Assinatura">
          <div className="display text-2xl text-accent">{txt(data.assinatura) || '–'}</div>
        </Block>
        <Block label="Linha de campanha">
          <Para>{txt(data.linha_campanha)}</Para>
        </Block>
        <Block label="Arquétipo">
          <Para>{txt(data.arquetipo)}</Para>
        </Block>
      </div>
      <Block label="Pilares">
        <Chips items={a(data.pilares)} tone="accent" />
      </Block>
      {personas.length > 0 && (
        <Block label="Personas">
          <Table>
            <thead>
              <tr>
                <TH>Persona</TH>
                <TH>Dor</TH>
                <TH>Desejo</TH>
              </tr>
            </thead>
            <tbody>
              {personas.map((p, i) => (
                <tr key={i}>
                  <TD className="font-medium">{txt(o(p).nome)}</TD>
                  <TD className="text-ink2">{txt(o(p).dor)}</TD>
                  <TD className="text-ink2">{txt(o(p).desejo)}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </Block>
      )}
      {(a(alt.posicionamento).length > 0 || a(alt.assinatura).length > 0) && (
        <div className="grid gap-6 md:grid-cols-2">
          <Block label="Alternativas de posicionamento">
            <PickAlt kitId={kit.id} field="posicionamento" options={a(alt.posicionamento)} current={txt(data.posicionamento)} />
          </Block>
          <Block label="Alternativas de assinatura">
            <PickAlt kitId={kit.id} field="assinatura" options={a(alt.assinatura)} current={txt(data.assinatura)} />
          </Block>
        </div>
      )}
    </div>
  );
}

const TOM_AXES: Record<string, [string, string]> = {
  formal_proximo: ['Formal', 'Próximo'],
  serio_divertido: ['Sério', 'Divertido'],
  tecnico_simples: ['Técnico', 'Simples'],
  contido_ousado: ['Contido', 'Ousado'],
};

function StepVerbal({ data }: { data: Record<string, any> }) {
  const tom = data.tom;
  const ctas = o(data.ctas);
  return (
    <div className="space-y-6">
      <Block label="Tom de voz">
        {tom && typeof tom === 'object' ? (
          <div className="space-y-3">
            {Object.entries(TOM_AXES).map(([k, [l, r]]) => {
              const v = Math.min(100, Math.max(0, Number(o(tom)[k])));
              if (!Number.isFinite(v)) return null;
              return (
                <div key={k} className="grid grid-cols-[84px_1fr_84px] items-center gap-3 text-xs text-ink2">
                  <span>{l}</span>
                  <div className="relative h-1.5 rounded-full bg-white/[0.08]">
                    <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${v}%` }} />
                  </div>
                  <span className="text-right">{r}</span>
                </div>
              );
            })}
          </div>
        ) : null}
        <Para>{txt(data.descricao_tom) || (typeof tom === 'string' ? tom : '')}</Para>
      </Block>
      <div className="grid gap-6 md:grid-cols-2">
        <Block label="Vocabulário próprio">
          <Chips items={a(data.vocabulario_proprio)} tone="accent" />
        </Block>
        <Block label="Proibidos">
          <Chips items={a(data.proibidos)} tone="err" />
        </Block>
      </div>
      <Block label="Bordões">
        <Bullets items={a(data.bordoes)} state="wave" />
      </Block>
      <Block label="Chamadas (CTA)">
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ['venda', 'Venda'],
            ['salvar', 'Salvar'],
            ['envio', 'Enviar'],
            ['palavra_chave', 'Palavra-chave'],
          ].map(([k, l]) => (
            <div key={k} className="rounded-xl border border-white/[0.08] px-3 py-2.5">
              <div className="label mb-1 text-[10px]">{l}</div>
              <div className="text-sm text-ink">{txt(ctas[k]) || '–'}</div>
            </div>
          ))}
        </div>
      </Block>
      <div className="grid gap-6 md:grid-cols-2">
        <Block label="Fala assim">
          <Bullets items={a(data.fala_assim)} state="done" />
        </Block>
        <Block label="Não fala assim">
          <Bullets items={a(data.nao_fala_assim)} state="err" />
        </Block>
      </div>
    </div>
  );
}

const PALETTE_KEYS: [string, string][] = [
  ['primaria', 'Primária'],
  ['secundaria', 'Secundária'],
  ['neutra_escura', 'Escura'],
  ['neutra_clara', 'Clara'],
  ['destaque', 'Destaque'],
];

function StepVisual({ kit, data, clientName, clientColor }: { kit: BrandKit; data: Record<string, any>; clientName: string; clientColor: string }) {
  const dirs = a(data.direcoes);
  const chosen = Number.isInteger(data.escolhida) ? Number(data.escolhida) : -1;
  if (!dirs.length) return <p className="text-sm text-ink3">Gere a etapa para ver as três direções.</p>;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {dirs.map((raw, i) => {
        const d = o(raw);
        const pal = o(d.paleta);
        const tip = o(d.tipografia);
        const post = o(d.exemplo_post);
        const logo = o(d.logo);
        const isChosen = chosen === i;
        return (
          <div key={i} className={cn('flex flex-col gap-4 rounded-2xl border p-4', isChosen ? 'border-accent/70 bg-accent/[0.05]' : 'border-white/[0.09]')}>
            <BrandFonts tokens={{ font_display: txt(tip.display), font_text: txt(tip.texto) }} />
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="label">Direção {i + 1}</div>
                <div className="display text-2xl text-ink">{txt(d.nome) || `Direção ${i + 1}`}</div>
              </div>
              {isChosen && <Badge tone="ok">Escolhida</Badge>}
            </div>
            <p className="text-sm text-ink2">{txt(d.conceito)}</p>

            <div>
              <div className="flex gap-1.5">
                {PALETTE_KEYS.map(([k, l]) => (
                  <div key={k} className="min-w-0 flex-1" title={`${l} ${txt(pal[k])}`}>
                    <span className="block aspect-square w-full rounded-lg border border-white/15" style={{ background: hex(pal[k], '#222222') }} />
                    <span className="mt-1 block truncate text-center font-mono text-[9px] text-ink3">{txt(pal[k])}</span>
                  </div>
                ))}
              </div>
              {pal.proporcao && <div className="mt-2 text-[11px] text-ink3">Proporção {txt(pal.proporcao)}</div>}
            </div>

            <div className="rounded-xl bg-white/[0.04] p-3">
              <div className="text-2xl leading-tight text-ink" style={{ fontFamily: `"${txt(tip.display)}", sans-serif`, fontWeight: 700 }}>
                {txt(tip.display) || 'Fonte de título'}
              </div>
              <div className="mt-1 text-sm text-ink2" style={{ fontFamily: `"${txt(tip.texto)}", sans-serif` }}>
                {txt(tip.texto) || 'Fonte de texto'} · texto corrido de exemplo
              </div>
              {tip.licenca && <div className="mt-1 text-[11px] text-ink3">{txt(tip.licenca)}</div>}
            </div>

            <div className="mx-auto w-full max-w-[210px]">
              <ArtCard
                item={{ format: 'post_4x5', series: txt(d.nome), hook: txt(post.headline), art: { headline: txt(post.headline) || txt(d.nome), support: txt(post.apoio), cta: 'Chame no WhatsApp', palette: 'escuro', tone: 'escuro' } as any }}
                brand={{ name: clientName, color: hex(pal.destaque, clientColor), logo: null, tokens: { bg: hex(pal.neutra_escura, '#0a0a0a'), text: hex(pal.neutra_clara, '#f5f5f3'), accent: hex(pal.destaque, clientColor), font_display: txt(tip.display), font_text: txt(tip.texto) } }}
                className="rounded-xl"
              />
            </div>

            <dl className="space-y-2 text-xs">
              {[
                ['Logo', [txt(logo.tipo), txt(logo.conceito)].filter(Boolean).join(': ')],
                ['Grafismo', txt(d.grafismo)],
                ['Fotografia', txt(d.fotografia)],
                ['Motion', txt(d.motion)],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="label text-[10px]">{k}</dt>
                    <dd className="text-ink2">{v}</dd>
                  </div>
                ))}
            </dl>

            <div className="mt-auto pt-1">
              <ActionButton variant={isChosen ? 'subtle' : 'glass'} className="w-full" disabled={isChosen} action={() => chooseDirectionAction(kit.id, i)} success="Paleta copiada para os tokens">
                {isChosen ? 'Direção em uso' : 'Escolher esta direção'}
              </ActionButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StepAplicacoes({ data }: { data: Record<string, any> }) {
  const apps = a(data.aplicacoes);
  if (!apps.length) return <p className="text-sm text-ink3">Gere a etapa para ver as aplicações.</p>;
  return (
    <div className="space-y-6">
      <Table>
        <thead>
          <tr>
            <TH>Peça</TH>
            <TH>Como aplicar</TH>
            <TH>Texto de exemplo</TH>
          </tr>
        </thead>
        <tbody>
          {apps.map((x, i) => (
            <tr key={i}>
              <TD className="whitespace-nowrap font-medium">{txt(o(x).peca)}</TD>
              <TD className="text-ink2">{txt(o(x).descricao)}</TD>
              <TD className="text-ink2">{txt(o(x).texto_exemplo)}</TD>
            </tr>
          ))}
        </tbody>
      </Table>
      <Block label="Regras de uso">
        <Bullets items={a(data.regras_uso)} state="wave" />
      </Block>
    </div>
  );
}

function StepManual({ kit }: { kit: BrandKit }) {
  const manual = o(o(kit.applications).manual);
  const tokens = o(kit.tokens);
  const chapters = a(manual.capitulos);
  const skill = txt(manual.skill_md);
  if (!chapters.length && !Object.keys(tokens).length) return <p className="text-sm text-ink3">Gere a etapa para montar o manual e os tokens.</p>;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2">
        {chapters.map((c, i) => (
          <div key={i} className="rounded-2xl border border-white/[0.08] p-4">
            <div className="label mb-1">Capítulo {i + 1}</div>
            <div className="display text-xl text-ink">{txt(o(c).titulo)}</div>
            <p className="mt-2 text-sm leading-relaxed text-ink2">{txt(o(c).conteudo)}</p>
          </div>
        ))}
      </div>
      <Block label="Tokens">
        <div className="flex flex-wrap gap-2">
          {['bg', 'surface', 'text', 'text2', 'accent', 'accent2', 'primary'].filter((k) => typeof tokens[k] === 'string').map((k) => (
            <div key={k} className="flex items-center gap-2 rounded-full border border-white/10 py-1 pl-1 pr-3">
              <span className="h-6 w-6 rounded-full border border-white/20" style={{ background: hex(tokens[k], '#222222') }} />
              <span className="text-xs text-ink2">{k}</span>
              <span className="font-mono text-[11px] text-ink3">{txt(tokens[k])}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 text-xs text-ink2">
          Fontes: <b className="text-ink">{txt(tokens.font_display) || '–'}</b> (títulos) e <b className="text-ink">{txt(tokens.font_text) || '–'}</b> (texto)
        </div>
      </Block>
      {skill && (
        <Block label="SKILL.md para os agentes">
          <div className="relative">
            <pre className="max-h-72 overflow-auto rounded-xl bg-white/[0.04] p-4 font-mono text-xs leading-relaxed text-ink2">{skill}</pre>
            <div className="absolute right-2 top-2">
              <CopyButton text={skill} />
            </div>
          </div>
        </Block>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Início: escolher o modo e criar o BrandKit                          */
/* ------------------------------------------------------------------ */

export function StartKit({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('zero');
  const [pending, start] = useTransition();
  return (
    <Card className="space-y-5 p-6">
      <div>
        <div className="label">Modo de trabalho</div>
        <p className="mt-1 text-sm text-ink2">O modo muda o ponto de partida do agente. Dá para trocar depois.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={cn('press rounded-2xl border p-4 text-left transition-colors', mode === m.id ? 'border-accent bg-accent/10' : 'border-white/10 hover:border-white/25')}
            aria-pressed={mode === m.id}
          >
            <div className="display text-xl text-ink">{m.label}</div>
            <div className="mt-1 text-xs text-ink2">{m.text}</div>
          </button>
        ))}
      </div>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const r = await createBrandKitAction(clientId, mode);
              if (!r.ok) toast.error(r.error);
              else {
                toast.success('BrandKit iniciado');
                router.refresh();
              }
            } catch (e) {
              toast.error((e as Error).message);
            }
          })
        }
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Iniciar BrandKit
      </Button>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Campo editável com trava                                            */
/* ------------------------------------------------------------------ */

function LockBtn({ kitId, lockKey, locked }: { kitId: string; lockKey: string; locked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={locked}
      title={locked ? 'Destravar campo' : 'Travar campo: a IA não sobrescreve'}
      onClick={() =>
        start(async () => {
          const r = await toggleLockAction(kitId, lockKey);
          if (!r.ok) toast.error(r.error);
          else {
            toast.success(r.locked ? 'Campo travado' : 'Campo destravado');
            router.refresh();
          }
        })
      }
      className={cn('press inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]', locked ? 'bg-accent/15 text-accent' : 'text-ink3 hover:text-ink')}
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
      {locked ? 'Travado' : 'Travar campo'}
    </button>
  );
}

function LockedField({ kitId, lockKey, locked, label, children }: { kitId: string; lockKey: string; locked: boolean; label: string; children: (disabled: boolean) => ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink">{label}</span>
        <LockBtn kitId={kitId} lockKey={lockKey} locked={locked} />
      </div>
      {children(locked)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stepper principal                                                   */
/* ------------------------------------------------------------------ */

export function BrandStepper({
  kit,
  clientName,
  clientColor,
  versions,
}: {
  kit: BrandKit;
  clientName: string;
  clientColor: string;
  versions: { id: string; version: number; status: BrandKit['status']; mode: Mode; approved_at?: string | null }[];
}) {
  const router = useRouter();
  const [view, setView] = useState<number>(Math.min(6, Math.max(1, kit.step || 1)));
  const [modePending, startMode] = useTransition();
  const locked = ((kit.locked_fields || []) as string[]).filter(Boolean);
  const isLocked = (k: string) => locked.includes(k);
  const strategy = o(kit.strategy);
  const verbal = o(kit.verbal);
  const tokens = o(kit.tokens);
  const has = stepHasContent(kit, view);
  const step = STEPS[view - 1];
  const formKey = useMemo(() => hash(JSON.stringify([strategy.posicionamento, strategy.assinatura, verbal.descricao_tom, verbal.tom, verbal.proibidos, kit.tokens])), [strategy.posicionamento, strategy.assinatura, verbal.descricao_tom, verbal.tom, verbal.proibidos, kit.tokens]);
  const exportHref = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ marca: clientName, versao: kit.version, modo: kit.mode, status: kit.status, tokens }, null, 2))}`;
  const nextToDo = STEPS.find((s) => !stepHasContent(kit, s.n))?.n ?? 6;

  const colors: [string, string, string][] = [
    ['bg', 'Fundo', '#0a0a0a'],
    ['surface', 'Superfície', '#171717'],
    ['text', 'Texto', '#f5f5f3'],
    ['accent', 'Destaque', clientColor],
    ['accent2', 'Destaque 2', '#c2290a'],
  ];

  return (
    <div className="space-y-6">
      <BrandFonts tokens={{ font_display: txt(tokens.font_display), font_text: txt(tokens.font_text) }} />

      {/* Estado do kit + modo */}
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge tone="accent">v{kit.version}</Badge>
          <Badge tone={STATUS_TONE[kit.status]}>{STATUS_LABEL[kit.status]}</Badge>
          <span className="text-xs text-ink3">{kit.approved_at ? `aprovado em ${fmtDate(kit.approved_at)}` : `${STEPS.filter((s) => stepHasContent(kit, s.n)).length} de 6 etapas com conteúdo`}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-full bg-white/[0.04] p-1" role="group" aria-label="Modo do BrandKit">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.text}
              disabled={modePending}
              onClick={() =>
                startMode(async () => {
                  const r = await setBrandModeAction(kit.id, m.id);
                  if (!r.ok) toast.error(r.error);
                  else router.refresh();
                })
              }
              className={cn('press rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors', kit.mode === m.id ? 'bg-ink text-bg' : 'text-ink2 hover:text-ink')}
            >
              {m.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Etapas */}
      <nav className="grid grid-cols-2 gap-2 md:grid-cols-6" aria-label="Etapas do BrandKit">
        {STEPS.map((s) => {
          const done = stepHasContent(kit, s.n);
          const on = view === s.n;
          return (
            <button
              key={s.n}
              type="button"
              onClick={() => setView(s.n)}
              aria-current={on ? 'step' : undefined}
              className={cn('press flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition-colors', on ? 'border-accent/70 bg-accent/10' : 'border-white/[0.08] hover:border-white/20')}
            >
              <span className={cn('num grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px]', done ? 'bg-ok/20 text-ok' : on ? 'bg-accent text-black' : 'border border-white/10 text-ink3')}>{done ? <Check className="h-3.5 w-3.5" /> : s.n}</span>
              <span className={cn('truncate text-[13px]', on ? 'text-ink' : 'text-ink2')}>{s.short}</span>
            </button>
          );
        })}
      </nav>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Conteúdo da etapa */}
        <Card className="space-y-6 p-6 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="label">
                Etapa {view} de 6
                <Example show={stepIsExample(kit, view)} />
              </div>
              <h2 className="display mt-1 text-3xl text-ink">{step.label}</h2>
              <p className="mt-1 max-w-xl text-sm text-ink2">{step.hint}</p>
            </div>
            <ActionButton
              variant={has && view !== nextToDo ? 'glass' : 'primary'}
              action={() => generateBrandStepAction(kit.id, view)}
              confirm={has ? 'Regerar esta etapa substitui o texto atual, exceto os campos travados. Continuar?' : undefined}
              success={`Etapa ${view} gerada`}
            >
              {has ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              {has ? 'Regerar com IA' : 'Gerar com IA'}
            </ActionButton>
          </div>

          <div className="hairline" />

          {!has && view !== 6 && (
            <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center">
              <div className="display text-xl text-ink">Etapa ainda vazia</div>
              <p className="mx-auto mt-1 max-w-sm text-sm text-ink2">O agente usa o contexto do cliente e o que já foi aprovado nas etapas anteriores. Campos travados nunca são sobrescritos.</p>
            </div>
          )}
          {view === 1 && has && <StepDiagnostico data={o(kit.diagnosis)} />}
          {view === 2 && has && <StepEstrategia kit={kit} data={strategy} />}
          {view === 3 && has && <StepVerbal data={verbal} />}
          {view === 4 && <StepVisual kit={kit} data={o(kit.visual)} clientName={clientName} clientColor={clientColor} />}
          {view === 5 && has && <StepAplicacoes data={o(kit.applications)} />}
          {view === 6 && <StepManual kit={kit} />}

          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" disabled={view === 1} onClick={() => setView((v) => Math.max(1, v - 1))}>
              Etapa anterior
            </Button>
            <Button variant="subtle" size="sm" disabled={view === 6} onClick={() => setView((v) => Math.min(6, v + 1))}>
              Próxima etapa
            </Button>
          </div>
        </Card>

        {/* Coluna lateral */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="label mb-1">Campos da marca</div>
            <p className="mb-4 text-xs text-ink3">Edite à mão. Travar um campo impede que a IA o sobrescreva.</p>
            <div key={formKey}>
              <ActionForm action={(fd) => updateBrandFieldAction(kit.id, fd)} success="Campos salvos" className="space-y-4">
                <LockedField kitId={kit.id} lockKey="strategy.posicionamento" locked={isLocked('strategy.posicionamento')} label="Posicionamento">
                  {(dis) => <Input name="posicionamento" defaultValue={txt(strategy.posicionamento)} disabled={dis} />}
                </LockedField>
                <LockedField kitId={kit.id} lockKey="strategy.assinatura" locked={isLocked('strategy.assinatura')} label="Assinatura">
                  {(dis) => <Input name="assinatura" defaultValue={txt(strategy.assinatura)} disabled={dis} />}
                </LockedField>
                <LockedField kitId={kit.id} lockKey="verbal.tom" locked={isLocked('verbal.tom')} label="Tom de voz">
                  {(dis) => <Textarea name="tom" className="min-h-[72px]" defaultValue={txt(verbal.descricao_tom) || (typeof verbal.tom === 'string' ? verbal.tom : '')} disabled={dis} />}
                </LockedField>
                <LockedField kitId={kit.id} lockKey="verbal.proibidos" locked={isLocked('verbal.proibidos')} label="Proibidos (um por linha)">
                  {(dis) => <Textarea name="proibidos" className="min-h-[72px]" defaultValue={a(verbal.proibidos).map(txt).join('\n')} disabled={dis} />}
                </LockedField>

                <div className="hairline" />
                <div className="label">Cores</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {colors.map(([k, label, fb]) => (
                    <LockedField key={k} kitId={kit.id} lockKey={`tokens.${k}`} locked={isLocked(`tokens.${k}`)} label={label}>
                      {(dis) => (
                        <div className="flex items-center gap-2">
                          <input type="color" name={k} defaultValue={hex(tokens[k], hex(fb, '#000000'))} disabled={dis} aria-label={label} className="h-9 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent disabled:cursor-not-allowed disabled:opacity-40" />
                          <span className="font-mono text-[11px] text-ink3">{hex(tokens[k], hex(fb, '#000000'))}</span>
                        </div>
                      )}
                    </LockedField>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <LockedField kitId={kit.id} lockKey="tokens.font_display" locked={isLocked('tokens.font_display')} label="Fonte de título">
                    {(dis) => <Input name="font_display" defaultValue={txt(tokens.font_display)} disabled={dis} placeholder="Barlow Condensed" />}
                  </LockedField>
                  <LockedField kitId={kit.id} lockKey="tokens.font_text" locked={isLocked('tokens.font_text')} label="Fonte de texto">
                    {(dis) => <Input name="font_text" defaultValue={txt(tokens.font_text)} disabled={dis} placeholder="Instrument Sans" />}
                  </LockedField>
                </div>
                <SubmitButton variant="subtle" className="w-full" pendingText="Salvando…">
                  Salvar campos
                </SubmitButton>
              </ActionForm>
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <div className="label">Aprovação</div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink2">
              <Dot state={kit.status === 'aprovado' ? 'done' : kit.status === 'em_aprovacao' ? 'wave' : 'idle'} />
              {kit.status === 'aprovado' ? `Aprovado em ${fmtDate(kit.approved_at)}. Editar abre a v${kit.version + 1}.` : kit.status === 'em_aprovacao' ? 'Aguardando a aprovação do cliente.' : 'Em rascunho. Revise as 6 etapas antes de enviar.'}
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton variant="outline" size="sm" disabled={kit.status !== 'rascunho'} action={() => setBrandStatusAction(kit.id, 'em_aprovacao')} success="Enviado para aprovação">
                Enviar para aprovação
              </ActionButton>
              <ActionButton variant="subtle" size="sm" disabled={kit.status === 'aprovado'} action={() => setBrandStatusAction(kit.id, 'aprovado')} confirm="Aprovar este BrandKit? Os módulos de feed, vídeo e tráfego passam a usar estes tokens." success="BrandKit aprovado">
                Aprovar
              </ActionButton>
              {kit.status !== 'rascunho' && (
                <ActionButton variant="ghost" size="sm" action={() => setBrandStatusAction(kit.id, 'rascunho')} success="Voltou para rascunho">
                  Voltar para rascunho
                </ActionButton>
              )}
            </div>
            <a href={exportHref} download={`tokens-${kit.client_id.slice(0, 8)}-v${kit.version}.json`} className="press focus-ring glass inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full px-3 text-[13px] font-medium text-ink hover:bg-white/[0.08]">
              <Download className="h-3.5 w-3.5" /> Exportar tokens
            </a>
          </Card>

          {versions.length > 1 && (
            <Card className="p-5">
              <div className="label mb-3">Versões</div>
              <ul className="space-y-2">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 text-ink">
                      <span className="num text-base">v{v.version}</span>
                      <span className="text-xs text-ink3">{MODES.find((m) => m.id === v.mode)?.label}</span>
                    </span>
                    <Badge tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
