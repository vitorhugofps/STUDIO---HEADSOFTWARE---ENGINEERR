'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Send, Sparkles, X } from 'lucide-react';
import { Badge, Button, Card, Dot, Example, Field, Input, Select, Table, TD, TH, Textarea } from '@/components/ui/primitives';
import { ActionButton, CopyButton } from '@/components/ui/client';
import { createVideoProjectAction, regenerateScriptAction, sendToYuriAction, setVideoStatusAction } from '@/lib/actions/marketing';
import { updateRowAction } from '@/lib/actions/common';
import { cn } from '@/lib/utils';
import type { Job, VideoProject } from '@/lib/db/types';

/** O `Select` das primitives perde o fundo dos campos ao passar pelo tailwind-merge (bg-[right_12px_center] é lido como cor). Restaura o fundo igual ao de Input. */
const SELECT_BG = '[background-color:rgb(255_255_255/0.04)]';


const VIDEO_STATUS_LABEL: Record<VideoProject['status'], string> = {
  rascunho: 'Rascunho',
  roteiro: 'Roteiro',
  edicao: 'Em edição',
  revisao: 'Revisão',
  aprovado: 'Aprovado',
  entregue: 'Entregue',
};
const VIDEO_STATUS_DOT: Record<VideoProject['status'], 'idle' | 'rec' | 'wave' | 'done'> = { rascunho: 'idle', roteiro: 'idle', edicao: 'rec', revisao: 'wave', aprovado: 'done', entregue: 'done' };

const DIRECTION_LABEL: Record<string, string> = {
  objetivo: 'Objetivo',
  publico: 'Público',
  plataforma: 'Plataforma',
  tom: 'Tom',
  referencias: 'Referências',
  ritmo: 'Ritmo',
  legenda: 'Legenda',
  trilha: 'Trilha',
  sfx: 'SFX',
  vfx: 'VFX',
  cor: 'Cor',
  motion: 'Motion',
};

const o = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const a = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(txt).join(', ') : typeof v === 'object' ? Object.values(v as object).map(txt).join(' · ') : String(v));

/* ------------------------------------------------------------------ */
/* Etiquetas do material bruto                                         */
/* ------------------------------------------------------------------ */

export function TagEditor({ id, tags }: { id: string; tags: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState('');
  function save(next: string[]) {
    start(async () => {
      const r = await updateRowAction('assets', id, { tags: next }, ['/marketing/videos']);
      if (!r.ok) toast.error(r.error);
      else router.refresh();
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] py-0.5 pl-2.5 pr-1.5 text-[11px] text-ink2">
          {t}
          <button type="button" disabled={pending} aria-label={`Remover etiqueta ${t}`} onClick={() => save(tags.filter((x) => x !== t))} className="rounded-full p-0.5 text-ink3 hover:text-ink">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            e.preventDefault();
            const t = draft.trim().slice(0, 24);
            if (!tags.includes(t)) save([...tags, t]);
            setDraft('');
          }
        }}
        placeholder="+ etiqueta"
        aria-label="Nova etiqueta"
        className="focus-ring w-24 rounded-full border border-transparent bg-transparent px-2 py-0.5 text-[11px] text-ink placeholder:text-ink3 hover:border-white/10"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Direção: formulário que cria o vídeo (e o roteiro)                  */
/* ------------------------------------------------------------------ */

export function DirectionForm({ clientId, defaults }: { clientId: string; defaults: { tom?: string; cor?: string; legenda?: string } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [line, setLine] = useState<'reels' | 'horizontal'>('reels');
  const [dur, setDur] = useState(40);
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          try {
            const r = await createVideoProjectAction(fd);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            toast.success(r.isExample === undefined ? 'Vídeo criado' : r.isExample ? 'Vídeo criado com roteiro de exemplo' : 'Vídeo criado com roteiro');
            router.push(`/marketing/videos?v=${r.line}&vp=${r.id}`);
            router.refresh();
          } catch (err) {
            toast.error((err as Error).message);
          }
        });
      }}
    >
      <input type="hidden" name="client_id" value={clientId} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Linha" required>
          <Select
            className={SELECT_BG}
            name="line"
            value={line}
            onChange={(e) => {
              const l = e.target.value as 'reels' | 'horizontal';
              setLine(l);
              setDur(l === 'reels' ? 40 : 180);
            }}
          >
            <option value="reels">Reels 9:16</option>
            <option value="horizontal">Vídeo horizontal 16:9</option>
          </Select>
        </Field>
        <Field label="Título" required>
          <Input name="title" required placeholder="Ex.: Reel 05 · bastidor da diária" />
        </Field>
        <Field label="Objetivo">
          <Input name="objetivo" placeholder="Ex.: prova social e contratação" />
        </Field>
        <Field label="Público">
          <Input name="publico" placeholder="Ex.: produtores de eventos em Uberlândia" />
        </Field>
        <Field label="Plataforma">
          <Select className={SELECT_BG} name="plataforma" defaultValue={line === 'reels' ? 'Instagram Reels' : 'YouTube'} key={line}>
            <option>Instagram Reels</option>
            <option>TikTok</option>
            <option>YouTube Shorts</option>
            <option>YouTube</option>
            <option>Site ou institucional</option>
            <option>Anúncio na Meta</option>
          </Select>
        </Field>
        <Field label="Duração alvo (segundos)" hint={line === 'reels' ? 'Reels: 30 a 45 s' : 'Horizontal: 60 a 1200 s'}>
          <Input type="number" name="duracao" value={dur} min={10} max={1200} onChange={(e) => setDur(Number(e.target.value))} />
        </Field>
        <Field label="Tom">
          <Input name="tom" defaultValue={defaults.tom || ''} placeholder="Ex.: energia de show, direto" />
        </Field>
        <Field label="Ritmo">
          <Select className={SELECT_BG} name="ritmo" defaultValue="Rápido: corte a cada 1 a 2 segundos">
            <option>Rápido: corte a cada 1 a 2 segundos</option>
            <option>Médio: corte a cada 3 a 5 segundos</option>
            <option>Contemplativo: planos longos</option>
          </Select>
        </Field>
        <Field label="Estilo de legenda">
          <Select className={SELECT_BG} name="legenda" defaultValue={defaults.legenda || 'Palavra a palavra'}>
            <option>Palavra a palavra</option>
            <option>Frase inteira</option>
            <option>Sem legenda</option>
          </Select>
        </Field>
        <Field label="Trilha">
          <Input name="trilha" placeholder="Ex.: áudio original, batida seca sem vocal" />
        </Field>
        <Field label="SFX">
          <Input name="sfx" placeholder="Ex.: whoosh nos cortes, clique nos números" />
        </Field>
        <Field label="VFX">
          <Input name="vfx" placeholder="Ex.: zoom suave, sem efeitos de transição" />
        </Field>
        <Field label="Cor">
          <Input name="cor" defaultValue={defaults.cor || ''} placeholder="Ex.: contraste alto, pele natural" />
        </Field>
        <Field label="Motion">
          <Input name="motion" placeholder="Ex.: título em duas batidas, número animado" />
        </Field>
      </div>
      <Field label="Referências" hint="Links, nomes de vídeos ou o que você quer que pareça. Uma por linha.">
        <Textarea name="referencias" className="min-h-[72px]" />
      </Field>
      <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
        <input type="checkbox" name="gerar_roteiro" defaultChecked className="h-4 w-4 accent-[rgb(255,91,31)]" />
        Gerar roteiro com IA ao criar
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {pending ? 'Criando e roteirizando…' : 'Criar vídeo'}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Detalhe do vídeo: roteiro, decupagem, ganchos e envio ao Yuri       */
/* ------------------------------------------------------------------ */

export function VideoDetail({ vp, jobs }: { vp: VideoProject; jobs: Job[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const blocks = vp.script?.blocks || [];
  const shots = vp.shot_list || [];
  const dir = o(vp.direction);
  const hooks = a(dir.hook_variants).map(txt);
  const audio = o(dir.audio);
  const capture = a(dir.captacao).map(txt);
  const inQueue = jobs.find((j) => (j.input as any)?.video_project_id === vp.id && (j.status === 'fila' || j.status === 'rodando'));
  const entries = Object.entries(DIRECTION_LABEL).filter(([k]) => txt(dir[k]));

  return (
    <Card className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="label">
            {vp.line === 'reels' ? 'Reel' : 'Vídeo horizontal'} · {vp.aspect || (vp.line === 'reels' ? '9:16' : '16:9')}
            {vp.target_duration_s ? ` · ${vp.target_duration_s} s` : ''}
            <Example show={!!dir._example} />
          </div>
          <h2 className="display mt-1 text-3xl text-ink">{vp.title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            variant="glass"
            size="sm"
            action={() => regenerateScriptAction(vp.id)}
            confirm={blocks.length ? 'Regerar o roteiro substitui o texto atual. Continuar?' : undefined}
            success="Roteiro gerado"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {blocks.length ? 'Regerar roteiro' : 'Gerar roteiro'}
          </ActionButton>
          {inQueue ? (
            <Button size="sm" disabled>
              <Send className="h-3.5 w-3.5" />
              Na fila do Yuri
            </Button>
          ) : (
            <ActionButton size="sm" action={() => sendToYuriAction(vp.id)} success="Enviado para a fila do Yuri">
              <Send className="h-3.5 w-3.5" />
              Enviar para o Yuri
            </ActionButton>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2 text-sm text-ink2">
          <Dot state={VIDEO_STATUS_DOT[vp.status]} /> Status
        </span>
        <Select
          className={cn(SELECT_BG, '!w-auto min-w-[160px]')}
          value={vp.status}
          disabled={pending}
          onChange={(e) =>
            start(async () => {
              const r = await setVideoStatusAction(vp.id, e.target.value as VideoProject['status']);
              if (!r.ok) toast.error(r.error);
              else {
                toast.success('Status atualizado');
                router.refresh();
              }
            })
          }
          aria-label="Status do vídeo"
        >
          {(Object.keys(VIDEO_STATUS_LABEL) as VideoProject['status'][]).map((s) => (
            <option key={s} value={s}>
              {VIDEO_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>

      {entries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([k, label]) => (
            <Badge key={k} className="max-w-full">
              <span className="text-ink3">{label}</span>
              <span className="truncate text-ink">{txt(dir[k])}</span>
            </Badge>
          ))}
        </div>
      )}

      {blocks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center">
          <div className="display text-xl text-ink">Sem roteiro ainda</div>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink2">Gere o roteiro a partir da direção e do material bruto enviado.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="label">Roteiro</div>
          <Table className="border-0 bg-transparent">
            <thead>
              <tr>
                <TH className="w-28">Tempo</TH>
                <TH>Fala</TH>
                <TH>Texto na tela</TH>
                <TH>Visual</TH>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b, i) => (
                <tr key={i} className="align-top">
                  <TD className="whitespace-nowrap">
                    <div className="num text-base">{b.t}</div>
                    <div className="text-xs text-ink3">{b.label}</div>
                  </TD>
                  <TD className="min-w-[220px] text-ink">{b.speech}</TD>
                  <TD className="min-w-[140px] font-medium uppercase tracking-wide text-accent">{b.screen || '–'}</TD>
                  <TD className="min-w-[200px] text-ink2">{b.visual || '–'}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {shots.length > 0 && (
        <div className="space-y-2">
          <div className="label">Decupagem</div>
          <Table className="border-0 bg-transparent">
            <thead>
              <tr>
                <TH>Bloco</TH>
                <TH>Fonte</TH>
                <TH>Nota</TH>
              </tr>
            </thead>
            <tbody>
              {shots.map((s, i) => (
                <tr key={i} className="align-top">
                  <TD className="whitespace-nowrap font-medium">{s.block}</TD>
                  <TD className="text-ink2">{s.source}</TD>
                  <TD className="text-ink2">{s.note}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {hooks.length > 0 && (
          <div className="space-y-2">
            <div className="label">Variações de gancho</div>
            <ul className="space-y-2">
              {hooks.map((h, i) => (
                <li key={i} className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.08] px-3 py-2.5">
                  <span className="text-sm text-ink">{h}</span>
                  <CopyButton text={h} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="space-y-4">
          {(txt(audio.trilha) || a(audio.sfx).length > 0 || txt(audio.assinatura)) && (
            <div className="space-y-2">
              <div className="label">Áudio</div>
              <dl className="space-y-1.5 text-sm">
                {txt(audio.trilha) && (
                  <div className="flex gap-2"><dt className="w-20 shrink-0 text-ink3">Trilha</dt><dd className="text-ink">{txt(audio.trilha)}</dd></div>
                )}
                {a(audio.sfx).length > 0 && (
                  <div className="flex gap-2"><dt className="w-20 shrink-0 text-ink3">SFX</dt><dd className="text-ink">{a(audio.sfx).map(txt).join(', ')}</dd></div>
                )}
                {txt(audio.assinatura) && (
                  <div className="flex gap-2"><dt className="w-20 shrink-0 text-ink3">Assinatura</dt><dd className="text-ink">{txt(audio.assinatura)}</dd></div>
                )}
              </dl>
            </div>
          )}
          {capture.length > 0 && (
            <div className="space-y-2">
              <div className="label">Captar se faltar material</div>
              <ul className="space-y-1.5">
                {capture.map((c, i) => (
                  <li key={i} className={cn('flex gap-2 text-sm text-ink')}>
                    <Dot state="wave" className="mt-1.5" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
