'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2, Sparkles, Mic } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Field, Input, Select, Textarea, Stepper, Badge } from '@/components/ui/primitives';
import { Dropzone } from '@/components/ui/dropzone';
import { QUESTIONNAIRE, SEGMENTS, blocksFor, isVisible, painMapFromAnswers, maturityIndex, PAIN_LABEL, type Question } from '@/lib/questionnaire';
import { createClientAction, type NewClientPayload } from '@/lib/actions/clients';
import { cn } from '@/lib/utils';

const STEPS = ['Identificação', 'Contexto', 'Questionário', 'Presença e contatos'];

const CONTEXT_BLOCKS: { key: string; label: string; hint: string }[] = [
  { key: 'quem_e', label: 'O que ele é e quem ele é', hint: 'História, momento atual, quem está por trás' },
  { key: 'oferece', label: 'O que oferece', hint: 'Produtos, serviços, ticket médio, carro-chefe' },
  { key: 'id_visual', label: 'Identidade visual atual', hint: 'O que existe, o que funciona, o que incomoda' },
  { key: 'linguagem', label: 'Identidade de linguagem', hint: 'Como fala hoje, palavras que usa, palavras que evita' },
  { key: 'dores', label: 'Dores percebidas', hint: 'O que o time já percebeu antes do questionário' },
  { key: 'notas', label: 'Observações da reunião', hint: 'Tudo que não cabe acima' },
];

export function NewClientWizard({ team, me }: { team: { id: string; full_name: string }[]; me: string }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ contact_name: '', company: '', segment: '', city: 'Uberlândia', state: 'MG', who_is: '', brand_color: '#FF5B1F', owner_id: me, website: '', instagram: '', tiktok: '', youtube: '', whatsapp: '', email: '', report_emails: '', meta_ad_account_id: '' });
  const [context, setContext] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [blockIdx, setBlockIdx] = useState(0);

  const blocks = useMemo(() => blocksFor(form.segment), [form.segment]);
  const pain = useMemo(() => painMapFromAnswers(answers), [answers]);
  const answered = Object.values(answers).filter((v) => (Array.isArray(v) ? v.length : v !== '' && v != null)).length;
  const totalQ = blocks.reduce((n, b) => n + b.questions.length, 0);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function submit() {
    const socials = [
      form.instagram && { rede: 'instagram', url: form.instagram },
      form.tiktok && { rede: 'tiktok', url: form.tiktok },
      form.youtube && { rede: 'youtube', url: form.youtube },
    ].filter(Boolean) as { rede: string; url: string }[];
    const payload: NewClientPayload = {
      ...form,
      socials,
      report_emails: form.report_emails.split(/[,;\s]+/).filter(Boolean),
      context,
      answers,
      asset_ids: assetIds,
    };
    start(async () => {
      const r = await createClientAction(payload);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.diagnosisId ? 'Cliente criado e diagnóstico gerado' : 'Cliente criado');
      router.push(`/clientes/${r.id}`);
    });
  }

  const canNext = step === 1 ? form.contact_name.trim().length > 1 : true;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-6">
        <Stepper steps={STEPS} current={step} />

        {step === 1 && (
          <section className="card space-y-5 p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nome do cliente" required hint="Pessoa de contato ou artista">
                <Input value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} placeholder="Ex.: Marcus Fahd" autoFocus />
              </Field>
              <Field label="Empresa / marca">
                <Input value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="Ex.: Clínica Inti" />
              </Field>
              <Field label="Segmento ou nicho" hint="Ativa perguntas específicas no questionário">
                <Select value={form.segment} onChange={(e) => set('segment', e.target.value)}>
                  <option value="">Escolher…</option>
                  {SEGMENTS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-[1fr_72px] gap-3">
                <Field label="Cidade">
                  <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
                </Field>
                <Field label="UF">
                  <Input value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase().slice(0, 2))} />
                </Field>
              </div>
              <Field label="Responsável interno">
                <Select value={form.owner_id} onChange={(e) => set('owner_id', e.target.value)}>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Cor da marca" hint="Usada no selo e na névoa da página do cliente">
                <div className="flex items-center gap-3">
                  <input type="color" value={form.brand_color} onChange={(e) => set('brand_color', e.target.value)} className="h-10 w-14 cursor-pointer rounded-xl border border-white/10 bg-transparent" />
                  <Input value={form.brand_color} onChange={(e) => set('brand_color', e.target.value)} className="font-mono" />
                </div>
              </Field>
            </div>
            <Field label="Explique quem é seu cliente" hint="Em duas ou três frases: o que ele faz, para quem, há quanto tempo e por que nos procurou.">
              <Textarea value={form.who_is} onChange={(e) => set('who_is', e.target.value.slice(0, 600))} placeholder="Ex.: Dentista com clínica própria há 8 anos, quer marca pessoal e vídeos semanais para o YouTube. Chegou por indicação." />
              <span className="mt-1 block text-right text-[11px] text-ink3">{form.who_is.length}/600</span>
            </Field>
          </section>
        )}

        {step === 2 && (
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="card space-y-4 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="label">Contexto geral</div>
                  <div className="text-xs text-ink3">Escreva livre. Cada bloco pode ficar vazio.</div>
                </div>
                <Button variant="subtle" size="sm" onClick={() => toast.message('Ditado por voz entra na próxima versão. Por enquanto, cole a transcrição em Observações.')}>
                  <Mic className="h-3.5 w-3.5" /> Ditado
                </Button>
              </div>
              {CONTEXT_BLOCKS.map((b) => (
                <Field key={b.key} label={b.label} hint={b.hint}>
                  <Textarea value={context[b.key] || ''} onChange={(e) => setContext((c) => ({ ...c, [b.key]: e.target.value }))} className="min-h-[72px]" />
                </Field>
              ))}
            </div>
            <div className="card space-y-4 p-6">
              <div>
                <div className="label">Anexos</div>
                <div className="text-xs text-ink3">Logos, manual, fotos, vídeos, PDFs, prints de redes, áudios de reunião. Links do Drive também.</div>
              </div>
              <Dropzone kind="arquivo" onUploaded={(files) => setAssetIds((ids) => [...ids, ...files.map((f) => f.id)])} />
              {assetIds.length > 0 && <Badge tone="ok">{assetIds.length} arquivo(s) anexado(s)</Badge>}
              <p className="rounded-xl bg-white/[0.04] p-3 text-xs text-ink2">Os anexos são ligados ao cliente ao concluir. A IA lê PDFs e áudios na página do cliente para propor um resumo do contexto.</p>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="card p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="label">Questionário de diagnóstico</div>
                <div className="text-xs text-ink3">
                  {answered} de {totalQ} respondidas · pode pular qualquer pergunta
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {blocks.map((b, i) => {
                  const done = b.questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== '').length;
                  return (
                    <button key={b.id} onClick={() => setBlockIdx(i)} className={cn('press rounded-full px-2.5 py-1 text-[11px]', i === blockIdx ? 'bg-ink text-bg' : done ? 'bg-ok/15 text-ok' : 'bg-white/[0.06] text-ink2')}>
                      {b.id.replace('N', 'Nicho ')}
                    </button>
                  );
                })}
              </div>
            </div>
            <QuestionBlock block={blocks[blockIdx]} answers={answers} setAnswers={setAnswers} />
            <div className="mt-6 flex items-center justify-between">
              <Button variant="ghost" size="sm" disabled={blockIdx === 0} onClick={() => setBlockIdx((i) => i - 1)}>
                <ArrowLeft className="h-4 w-4" /> Bloco anterior
              </Button>
              <span className="text-xs text-ink3">
                Bloco {blockIdx + 1} de {blocks.length} · {blocks[blockIdx].title}
              </span>
              <Button variant="subtle" size="sm" disabled={blockIdx === blocks.length - 1} onClick={() => setBlockIdx((i) => i + 1)}>
                Próximo bloco <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="card space-y-5 p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Site" hint="O sistema confere se carrega e se é responsivo">
                <Input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" />
              </Field>
              <Field label="WhatsApp oficial" hint="Com DDD">
                <Input value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} placeholder="(34) 9 9999-9999" />
              </Field>
              <Field label="Instagram">
                <Input value={form.instagram} onChange={(e) => set('instagram', e.target.value)} placeholder="https://instagram.com/" />
              </Field>
              <Field label="TikTok">
                <Input value={form.tiktok} onChange={(e) => set('tiktok', e.target.value)} placeholder="https://tiktok.com/@" />
              </Field>
              <Field label="YouTube">
                <Input value={form.youtube} onChange={(e) => set('youtube', e.target.value)} placeholder="https://youtube.com/@" />
              </Field>
              <Field label="E-mail principal">
                <Input value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="contato@" />
              </Field>
              <Field label="E-mails para relatórios" hint="Separe por vírgula">
                <Input value={form.report_emails} onChange={(e) => set('report_emails', e.target.value)} placeholder="cliente@empresa.com, socio@empresa.com" />
              </Field>
              <Field label="Conta de anúncios Meta (ID)" hint="Se já souber. act_…">
                <Input value={form.meta_ad_account_id} onChange={(e) => set('meta_ad_account_id', e.target.value)} placeholder="act_123456789" />
              </Field>
            </div>
          </section>
        )}

        <div className="flex items-center justify-between">
          <Button variant="ghost" disabled={step === 1 || pending} onClick={() => setStep((s) => s - 1)}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          {step < 4 ? (
            <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              Continuar <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={pending || !canNext} size="lg">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {pending ? 'Criando cliente e diagnóstico…' : 'Criar cliente e gerar diagnóstico'}
            </Button>
          )}
        </div>
      </div>

      {/* Resumo lateral */}
      <aside className="space-y-4">
        <div className="glass sticky top-24 rounded-3xl p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full text-sm font-semibold text-black" style={{ background: form.brand_color }}>
              {(form.company || form.contact_name || '?').slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{form.company || form.contact_name || 'Novo cliente'}</div>
              <div className="truncate text-xs text-ink3">{form.segment || 'segmento'} · {form.city}</div>
            </div>
          </div>
          <div className="hairline my-4" />
          <div className="label mb-2">Mapa de dores (prévia)</div>
          <div className="space-y-2">
            {Object.entries(pain).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[100px_1fr_24px] items-center gap-2 text-xs">
                <span className="truncate text-ink2">{PAIN_LABEL[k]}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <span className="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${v * 10}%` }} />
                </span>
                <span className="num text-right text-ink">{v}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-end justify-between">
            <span className="label">Maturidade digital</span>
            <span className="num text-3xl text-ink">{answered ? maturityIndex(pain) : '–'}</span>
          </div>
          <p className="mt-3 text-[11px] text-ink3">Calculado só com as respostas. O agente Comercial refina ao concluir.</p>
        </div>
      </aside>
    </div>
  );
}

function QuestionBlock({ block, answers, setAnswers }: { block: (typeof QUESTIONNAIRE)[number]; answers: Record<string, unknown>; setAnswers: (f: (a: Record<string, unknown>) => Record<string, unknown>) => void }) {
  const set = (id: string, v: unknown) => setAnswers((a) => ({ ...a, [id]: v }));
  return (
    <div>
      <h3 className="display text-2xl text-ink">{block.title}</h3>
      <p className="mb-5 text-sm text-ink2">{block.intro}</p>
      <div className="space-y-5">
        {block.questions.filter((q) => isVisible(q, answers)).map((q) => (
          <QuestionField key={q.id} q={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
        ))}
      </div>
    </div>
  );
}

function QuestionField({ q, value, onChange }: { q: Question; value: unknown; onChange: (v: unknown) => void }) {
  const label = (
    <span className="flex items-baseline gap-2">
      <span className="font-mono text-[10px] text-ink3">{q.id}</span>
      <span>{q.label}</span>
    </span>
  );
  if (q.type === 'single')
    return (
      <Field label={label} hint={q.hint}>
        <div className="flex flex-wrap gap-2">
          {q.options!.map((o) => (
            <button key={o} type="button" onClick={() => onChange(value === o ? '' : o)} className={cn('press rounded-full border px-3 py-1.5 text-[13px]', value === o ? 'border-accent bg-accent text-black' : 'border-white/10 text-ink2 hover:border-white/25 hover:text-ink')}>
              {o}
            </button>
          ))}
        </div>
      </Field>
    );
  if (q.type === 'multi') {
    const arr = (value as string[]) || [];
    return (
      <Field label={label} hint={q.hint}>
        <div className="flex flex-wrap gap-2">
          {q.options!.map((o) => {
            const on = arr.includes(o);
            return (
              <button key={o} type="button" onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])} className={cn('press rounded-full border px-3 py-1.5 text-[13px]', on ? 'border-accent bg-accent text-black' : 'border-white/10 text-ink2 hover:border-white/25 hover:text-ink')}>
                {o}
              </button>
            );
          })}
        </div>
      </Field>
    );
  }
  if (q.type === 'scale')
    return (
      <Field label={label} hint={q.hint}>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => onChange(value === n ? '' : n)} className={cn('num press h-10 w-10 rounded-full border text-sm', value === n ? 'border-accent bg-accent text-black' : 'border-white/10 text-ink2 hover:border-white/25')}>
              {n}
            </button>
          ))}
        </div>
      </Field>
    );
  if (q.type === 'long')
    return (
      <Field label={label} hint={q.hint}>
        <Textarea value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} className="min-h-[72px]" />
      </Field>
    );
  return (
    <Field label={label} hint={q.hint}>
      <Input value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
