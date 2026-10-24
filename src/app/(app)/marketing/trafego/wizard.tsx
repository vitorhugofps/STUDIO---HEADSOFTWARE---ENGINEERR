'use client';

import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, FileVideo, Heart, Loader2, Lock, MessageCircle, MousePointerClick, PlayCircle, ShoppingBag, UserPlus } from 'lucide-react';
import { Badge, Button, Card, Dot, Example, Field, Input, Select, Stepper, Textarea } from '@/components/ui/primitives';
import { ActionButton, ActionForm, SubmitButton, Toggle } from '@/components/ui/client';
import { createCampaignAction, generateReportAction, saveMetaConnectionAction, saveReportSubscriptionAction, sendReportAction, type CampaignPayload } from '@/lib/actions/marketing';
import { deleteRowAction, updateRowAction } from '@/lib/actions/common';
import { brl, cn, fmtDate, relTime } from '@/lib/utils';

/** O `Select` das primitives perde o fundo dos campos ao passar pelo tailwind-merge (bg-[right_12px_center] é lido como cor). Restaura o fundo igual ao de Input. */
const SELECT_BG = '[background-color:rgb(255_255_255/0.04)]';


/* ------------------------------------------------------------------ */
/* Conexão com a Meta                                                  */
/* ------------------------------------------------------------------ */

export type MetaConfig = {
  business_id?: string;
  page_id?: string;
  instagram_id?: string;
  pixel_id?: string;
  whatsapp?: string;
  checks?: Record<string, boolean>;
};

const CHECKS = [
  { key: 'partner_access', label: 'Acesso de parceiro concedido', hint: 'O cliente adicionou o Business Manager do Studio como parceiro e compartilhou a conta de anúncios.' },
  { key: 'billing_active', label: 'Pagamento ativo na conta de anúncios', hint: 'Forma de pagamento válida, sem bloqueio de cobrança.' },
  { key: 'pixel_ok', label: 'Pixel instalado e disparando', hint: 'Evento de conversão testado no Gerenciador de Eventos.' },
  { key: 'domain_verified', label: 'Domínio verificado', hint: 'Verificação feita no Business Manager do cliente.' },
  { key: 'page_linked', label: 'Página ligada ao Instagram e à conta', hint: 'A página que vai anunciar está vinculada ao Instagram profissional.' },
] as const;

export function MetaConnection({ clientId, adAccountId, config, hasToken }: { clientId: string; adAccountId: string; config: MetaConfig; hasToken: boolean }) {
  const [checks, setChecks] = useState<Record<string, boolean>>(() => Object.fromEntries(CHECKS.map((c) => [c.key, !!config.checks?.[c.key]])));
  const done = CHECKS.filter((c) => checks[c.key]).length;

  return (
    <ActionForm action={(fd) => saveMetaConnectionAction(clientId, fd)} success="Conexão salva" className="space-y-7">
      {CHECKS.map((c) => (
        <input key={c.key} type="hidden" name={`check_${c.key}`} value={checks[c.key] ? '1' : '0'} />
      ))}

      <div>
        <div className="label mb-3">Identificadores</div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Conta de anúncios" hint="Formato act_ seguido de números. Fica no Gerenciador de Anúncios.">
            <Input name="ad_account_id" defaultValue={adAccountId} placeholder="act_1234567890" />
          </Field>
          <Field label="Business ID" hint="ID do Business Manager do cliente.">
            <Input name="business_id" defaultValue={config.business_id || ''} placeholder="1234567890" />
          </Field>
          <Field label="Página">
            <Input name="page_id" defaultValue={config.page_id || ''} placeholder="ID da página do Facebook" />
          </Field>
          <Field label="Instagram">
            <Input name="instagram_id" defaultValue={config.instagram_id || ''} placeholder="ID da conta profissional" />
          </Field>
          <Field label="Pixel">
            <Input name="pixel_id" defaultValue={config.pixel_id || ''} placeholder="ID do pixel" />
          </Field>
          <Field label="WhatsApp do anúncio" hint="Número que recebe as conversas, com DDD.">
            <Input name="whatsapp" defaultValue={config.whatsapp || ''} placeholder="(34) 99999-9999" />
          </Field>
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div className="label">Prontidão para subir</div>
          <span className="text-xs text-ink2">
            <b className="num text-base text-ink">{done}</b> de {CHECKS.length} prontos
          </span>
        </div>
        <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07]">
          {CHECKS.map((c) => (
            <li key={c.key} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{c.label}</div>
                <div className="mt-0.5 text-xs text-ink3">{c.hint}</div>
              </div>
              <Toggle checked={!!checks[c.key]} onChange={(v) => setChecks((prev) => ({ ...prev, [c.key]: v }))} label={c.label} />
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Salvando…">Salvar conexão</SubmitButton>
        <span title="Exige App Review da Meta; use acesso de parceiro" className="inline-flex">
          <Button variant="outline" disabled aria-disabled="true">
            <Lock className="h-4 w-4" /> Conectar com Facebook
          </Button>
        </span>
        <span className="text-xs text-ink3">
          {hasToken ? 'Token da Meta configurado.' : (
            <>
              Sem token da Meta. <Link href="/settings" className="text-accent hover:underline">Abrir Settings</Link>
            </>
          )}
        </span>
      </div>
      <p className="-mt-3 text-xs text-ink3">O login com Facebook exige App Review da Meta. Enquanto isso, use o acesso de parceiro e marque aqui o que já está pronto.</p>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------ */
/* Assistente de campanha (6 passos)                                   */
/* ------------------------------------------------------------------ */

type Objective = CampaignPayload['objective'];

const OBJECTIVES: { id: Objective; label: string; text: string; icon: ReactNode }[] = [
  { id: 'mensagens', label: 'Mensagens no WhatsApp', text: 'Quem clica abre uma conversa com o cliente.', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'leads', label: 'Leads', text: 'Cadastro por formulário ou página de captura.', icon: <UserPlus className="h-5 w-5" /> },
  { id: 'vendas', label: 'Vendas no site', text: 'Compra ou pedido direto, com pixel de conversão.', icon: <ShoppingBag className="h-5 w-5" /> },
  { id: 'trafego_perfil', label: 'Tráfego para o perfil', text: 'Visitas ao Instagram ou ao site da marca.', icon: <MousePointerClick className="h-5 w-5" /> },
  { id: 'visualizacoes', label: 'Visualizações', text: 'Vídeo assistido e alcance a custo baixo.', icon: <PlayCircle className="h-5 w-5" /> },
  { id: 'engajamento', label: 'Engajamento', text: 'Curtidas, comentários e salvamentos.', icon: <Heart className="h-5 w-5" /> },
];
const OBJECTIVE_LABEL: Record<string, string> = Object.fromEntries(OBJECTIVES.map((o) => [o.id, o.label]));

const FUNNELS: { id: CampaignPayload['funnel']; label: string; text: string }[] = [
  { id: 'TOPO', label: 'Topo', text: 'Apresentar a marca a quem ainda não conhece. Gancho forte, promessa leve.' },
  { id: 'FUNDO', label: 'Fundo', text: 'Converter quem já compara ou conhece. Oferta clara, prova e chamada direta.' },
  { id: 'AMBOS', label: 'Os dois', text: 'Kits separados para topo e fundo, intercalados nos conjuntos.' },
];

const SCENARIOS = [
  { value: 1500, label: 'Teste' },
  { value: 3000, label: 'Crescimento' },
  { value: 6000, label: 'Escala' },
];

const STEPS = ['Objetivo', 'Oferta e destino', 'Funil', 'Praça e verba', 'Criativos', 'Revisão'];

export type WizardVideo = { id: string; name: string; size: number; source: string };
export type WizardPiece = { id: string; hook: string; format: string; series: string };

type WizardState = {
  name: string;
  objective: Objective | '';
  texto: string;
  preco: string;
  oferta_real: string;
  destino: 'whatsapp' | 'url';
  url: string;
  whatsapp: string;
  mensagem: string;
  funnel: CampaignPayload['funnel'];
  cidade: string;
  raio_km: string;
  idade_min: string;
  idade_max: string;
  total: string;
  daily: string;
  starts_on: string;
  ends_on: string;
  asset_ids: string[];
  content_ids: string[];
  kits: number;
};

const FORMAT_LABEL: Record<string, string> = { post_4x5: 'Post 4:5', carrossel: 'Carrossel', story: 'Story', capa_reel: 'Capa de Reel' };

// Campos numéricos entregam "1234.5"; texto digitado em pt-BR vem como "1.234,5".
const toNum = (s: string) => {
  const t = String(s).trim();
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const shiftDay = (base: string, n: number) => {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const spanDays = (a: string, b: string) => {
  const x = Date.parse(`${a}T12:00:00Z`);
  const y = Date.parse(`${b}T12:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y) || y < x) return 30;
  return Math.max(1, Math.round((y - x) / 864e5) + 1);
};
const sizeLabel = (n: number) => (!n ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1024 ** 3 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB`);

function validate(step: number, s: WizardState): string {
  if (step === 1 && !s.objective) return 'Escolha o objetivo da campanha.';
  if (step === 2) {
    if (s.texto.trim().length < 4) return 'Descreva o que está sendo anunciado.';
    if (s.destino === 'url' && !/^https?:\/\/\S+\.\S+/.test(s.url.trim())) return 'Informe o endereço completo do destino, começando por https://';
    if (s.destino === 'whatsapp' && s.whatsapp.replace(/\D/g, '').length < 10) return 'Informe o WhatsApp com DDD.';
  }
  if (step === 4) {
    if (!s.cidade.trim()) return 'Informe a cidade da praça.';
    const r = toNum(s.raio_km);
    if (r < 1 || r > 80) return 'O raio precisa ficar entre 1 e 80 km.';
    const a = toNum(s.idade_min);
    const b = toNum(s.idade_max);
    if (a < 18 || b > 65 || a > b) return 'A faixa de idade vai de 18 a 65 anos, com mínimo menor que o máximo.';
    if (toNum(s.total) <= 0) return 'Informe a verba total.';
    if (!s.starts_on || !s.ends_on || s.ends_on < s.starts_on) return 'A data final precisa ser igual ou posterior à inicial.';
  }
  if (step === 5 && (s.kits < 3 || s.kits > 6)) return 'Escolha de 3 a 6 kits.';
  return '';
}

export function CampaignWizard({
  clientId,
  clientName,
  today,
  defaults,
  videos,
  pieces,
}: {
  clientId: string;
  clientName: string;
  today: string;
  defaults: { cidade: string; whatsapp: string; raio: number };
  videos: WizardVideo[];
  pieces: WizardPiece[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [s, setS] = useState<WizardState>(() => {
    const starts = shiftDay(today, 1);
    const ends = shiftDay(today, 30);
    return {
      name: '',
      objective: '',
      texto: '',
      preco: '',
      oferta_real: '',
      destino: 'whatsapp',
      url: '',
      whatsapp: defaults.whatsapp,
      mensagem: 'Olá! Vi o anúncio e quero saber mais.',
      funnel: 'FUNDO',
      cidade: defaults.cidade,
      raio_km: String(defaults.raio || 40),
      idade_min: '25',
      idade_max: '55',
      total: '1500',
      daily: String(round2(1500 / spanDays(starts, ends))),
      starts_on: starts,
      ends_on: ends,
      asset_ids: [],
      content_ids: [],
      kits: 3,
    };
  });
  const patch = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));
  const days = spanDays(s.starts_on, s.ends_on);

  function setTotal(v: string) {
    patch({ total: v, daily: v ? String(round2(toNum(v) / days)) : '' });
  }
  function setDaily(v: string) {
    patch({ daily: v, total: v ? String(Math.round(toNum(v) * days)) : '' });
  }
  function setDates(starts: string, ends: string) {
    const n = spanDays(starts, ends);
    patch({ starts_on: starts, ends_on: ends, daily: s.total ? String(round2(toNum(s.total) / n)) : s.daily });
  }
  function toggle(list: 'asset_ids' | 'content_ids', id: string) {
    setS((prev) => ({ ...prev, [list]: prev[list].includes(id) ? prev[list].filter((x) => x !== id) : [...prev[list], id] }));
  }

  function next() {
    const err = validate(step, s);
    setError(err);
    if (!err) setStep((n) => Math.min(6, n + 1));
  }
  function back() {
    setError('');
    setStep((n) => Math.max(1, n - 1));
  }

  function submit() {
    for (let i = 1; i <= 5; i++) {
      const err = validate(i, s);
      if (err) {
        setStep(i);
        setError(err);
        return;
      }
    }
    const payload: CampaignPayload = {
      client_id: clientId,
      name: s.name.trim(),
      objective: s.objective as Objective,
      oferta: { texto: s.texto.trim(), preco: s.preco.trim(), oferta_real: s.oferta_real.trim(), destino: s.destino, url: s.url.trim(), whatsapp: s.whatsapp.trim(), mensagem: s.mensagem.trim() },
      funnel: s.funnel,
      geo: { cidade: s.cidade.trim(), raio_km: toNum(s.raio_km), idade_min: toNum(s.idade_min), idade_max: toNum(s.idade_max) },
      budget: { total: toNum(s.total), daily: toNum(s.daily) },
      starts_on: s.starts_on,
      ends_on: s.ends_on,
      asset_ids: s.asset_ids,
      content_ids: s.content_ids,
      kits: s.kits,
    };
    start(async () => {
      try {
        const r = await createCampaignAction(payload);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(r.isExample ? 'Kit Zero criado com conteúdo de exemplo' : 'Kit Zero criado');
        router.push(`/marketing/trafego?t=campanhas&c=${r.id}`);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const choice = (active: boolean) =>
    cn(
      'press focus-ring w-full rounded-2xl border p-4 text-left transition-colors',
      active ? 'border-accent bg-accent/[0.07]' : 'border-white/[0.09] hover:border-white/20 hover:bg-white/[0.03]',
    );

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="p-6 lg:col-span-2 md:p-7">
        <Stepper steps={STEPS} current={step} className="mb-7" />

        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="display text-2xl text-ink">Qual é o objetivo?</h2>
              <p className="mt-1 text-sm text-ink2">O objetivo define o evento que a Meta vai otimizar e o tipo de criativo que o Kit Zero propõe.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Objetivo da campanha">
              {OBJECTIVES.map((o) => (
                <button key={o.id} type="button" role="radio" aria-checked={s.objective === o.id} className={choice(s.objective === o.id)} onClick={() => patch({ objective: o.id })}>
                  <span className={cn('mb-3 grid h-9 w-9 place-items-center rounded-full border', s.objective === o.id ? 'border-accent/60 text-accent' : 'border-white/10 text-ink2')}>{o.icon}</span>
                  <span className="block text-sm font-medium text-ink">{o.label}</span>
                  <span className="mt-1 block text-xs text-ink3">{o.text}</span>
                </button>
              ))}
            </div>
            <Field label="Nome da campanha" hint="Opcional. Sem nome, o sistema usa objetivo, cliente e mês.">
              <Input value={s.name} onChange={(e) => patch({ name: e.target.value })} placeholder={`Ex.: Orçamentos de ${clientName}`} />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="display text-2xl text-ink">Oferta e destino</h2>
              <p className="mt-1 text-sm text-ink2">Só entra no anúncio o que é real. Preço e oferta em branco aparecem como pendência no Kit Zero.</p>
            </div>
            <Field label="O que está sendo anunciado" required>
              <Textarea value={s.texto} onChange={(e) => patch({ texto: e.target.value })} className="min-h-[88px]" placeholder="Ex.: cobertura em vídeo de eventos corporativos, com entrega em 7 dias" />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Preço ou faixa" hint="Deixe em branco se não for divulgar.">
                <Input value={s.preco} onChange={(e) => patch({ preco: e.target.value })} placeholder="Ex.: a partir de R$ 1.200" />
              </Field>
              <Field label="Oferta real" hint="Condição com prazo ou vagas verdadeiras.">
                <Input value={s.oferta_real} onChange={(e) => patch({ oferta_real: e.target.value })} placeholder="Ex.: 3 vagas em novembro" />
              </Field>
            </div>
            <div>
              <div className="mb-2 text-[13px] font-medium text-ink">Para onde vai o clique</div>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Destino do anúncio">
                {(
                  [
                    ['whatsapp', 'WhatsApp', 'Abre a conversa com a mensagem pronta.'],
                    ['url', 'Site ou página', 'Leva para um endereço da web.'],
                  ] as const
                ).map(([id, label, text]) => (
                  <button key={id} type="button" role="radio" aria-checked={s.destino === id} className={choice(s.destino === id)} onClick={() => patch({ destino: id })}>
                    <span className="block text-sm font-medium text-ink">{label}</span>
                    <span className="mt-1 block text-xs text-ink3">{text}</span>
                  </button>
                ))}
              </div>
            </div>
            {s.destino === 'whatsapp' ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="WhatsApp" required>
                  <Input value={s.whatsapp} onChange={(e) => patch({ whatsapp: e.target.value })} placeholder="(34) 99999-9999" inputMode="tel" />
                </Field>
                <Field label="Mensagem inicial">
                  <Input value={s.mensagem} onChange={(e) => patch({ mensagem: e.target.value })} />
                </Field>
              </div>
            ) : (
              <Field label="Endereço de destino" required>
                <Input value={s.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://" inputMode="url" />
              </Field>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="display text-2xl text-ink">Em que ponto do funil?</h2>
              <p className="mt-1 text-sm text-ink2">O funil muda o ângulo, o nível de consciência e o tamanho da promessa de cada kit.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Funil">
              {FUNNELS.map((f) => (
                <button key={f.id} type="button" role="radio" aria-checked={s.funnel === f.id} className={choice(s.funnel === f.id)} onClick={() => patch({ funnel: f.id })}>
                  <span className="display block text-xl text-ink">{f.label}</span>
                  <span className="mt-2 block text-xs leading-relaxed text-ink3">{f.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h2 className="display text-2xl text-ink">Praça e verba</h2>
              <p className="mt-1 text-sm text-ink2">Comece pequeno e local. Ampliar o raio só faz sentido depois de uma semana de dado.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Cidade" required className="md:col-span-2">
                <Input value={s.cidade} onChange={(e) => patch({ cidade: e.target.value })} />
              </Field>
              <Field label="Raio (km)">
                <Input type="number" min={1} max={80} value={s.raio_km} onChange={(e) => patch({ raio_km: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Idade de">
                  <Input type="number" min={18} max={65} value={s.idade_min} onChange={(e) => patch({ idade_min: e.target.value })} />
                </Field>
                <Field label="até">
                  <Input type="number" min={18} max={65} value={s.idade_max} onChange={(e) => patch({ idade_max: e.target.value })} />
                </Field>
              </div>
            </div>

            <div>
              <div className="mb-2 text-[13px] font-medium text-ink">Cenário de verba</div>
              <div className="flex flex-wrap gap-2">
                {SCENARIOS.map((c) => {
                  const on = toNum(s.total) === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTotal(String(c.value))}
                      className={cn('press focus-ring rounded-full border px-4 py-2 text-left text-sm transition-colors', on ? 'border-accent bg-accent/[0.08] text-ink' : 'border-white/10 text-ink2 hover:border-white/20 hover:text-ink')}
                    >
                      <span className="num text-base">{brl(c.value)}</span>
                      <span className="ml-2 text-xs text-ink3">{c.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Verba total (R$)" required>
                <Input type="number" min={0} step="50" value={s.total} onChange={(e) => setTotal(e.target.value)} />
              </Field>
              <Field label="Verba por dia (R$)" hint={`Calculada para ${days} ${days === 1 ? 'dia' : 'dias'}. Se mudar aqui, o total acompanha.`}>
                <Input type="number" min={0} step="1" value={s.daily} onChange={(e) => setDaily(e.target.value)} />
              </Field>
              <Field label="Início" required>
                <Input type="date" value={s.starts_on} onChange={(e) => setDates(e.target.value, s.ends_on)} />
              </Field>
              <Field label="Fim" required>
                <Input type="date" min={s.starts_on} value={s.ends_on} onChange={(e) => setDates(s.starts_on, e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-6">
            <div>
              <h2 className="display text-2xl text-ink">Criativos reais</h2>
              <p className="mt-1 text-sm text-ink2">Marque o que existe de verdade. Sem criativo real, o Kit Zero aponta o que precisa ser captado, sem inventar.</p>
            </div>

            <div>
              <div className="label mb-2">Vídeos do cliente</div>
              {videos.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/15 px-4 py-5 text-sm text-ink2">
                  Nenhum vídeo enviado. Suba o material em <Link href="/marketing/videos?v=bruto" className="text-accent hover:underline">Criação de Vídeos</Link>.
                </p>
              ) : (
                <ul className="grid gap-2 md:grid-cols-2">
                  {videos.map((v) => (
                    <li key={v.id}>
                      <CheckRow checked={s.asset_ids.includes(v.id)} onChange={() => toggle('asset_ids', v.id)} icon={<FileVideo className="h-4 w-4" />} title={v.name} meta={[sizeLabel(v.size), v.source === 'google_drive' ? 'Drive' : ''].filter(Boolean).join(' · ')} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="label mb-2">Peças de feed aprovadas</div>
              {pieces.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/15 px-4 py-5 text-sm text-ink2">
                  Nenhuma peça aprovada ainda. Aprove peças em <Link href="/marketing/feed" className="text-accent hover:underline">Criação de Feed</Link> para usá-las aqui.
                </p>
              ) : (
                <ul className="grid gap-2 md:grid-cols-2">
                  {pieces.map((p) => (
                    <li key={p.id}>
                      <CheckRow checked={s.content_ids.includes(p.id)} onChange={() => toggle('content_ids', p.id)} icon={<Check className="h-4 w-4" />} title={p.hook} meta={[FORMAT_LABEL[p.format] || p.format, p.series].filter(Boolean).join(' · ')} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="mb-2 text-[13px] font-medium text-ink">Quantos kits no Kit Zero</div>
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Quantidade de kits">
                {[3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={s.kits === n}
                    onClick={() => patch({ kits: n })}
                    className={cn('press focus-ring num h-11 w-11 rounded-full border text-lg transition-colors', s.kits === n ? 'border-accent bg-accent text-black' : 'border-white/10 text-ink2 hover:border-white/25 hover:text-ink')}
                  >
                    {n}
                  </button>
                ))}
                <span className="ml-1 text-xs text-ink3">Cada kit é um ângulo diferente: persona, gancho e promessa.</span>
              </div>
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-5">
            <div>
              <h2 className="display text-2xl text-ink">Revise o briefing</h2>
              <p className="mt-1 text-sm text-ink2">Ao gerar, o agente monta o Kit Zero. Os kits completos só saem depois da sua aprovação.</p>
            </div>
            <dl className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07] text-sm">
              {(
                [
                  ['Objetivo', OBJECTIVE_LABEL[s.objective] || '–'],
                  ['Oferta', [s.texto.trim(), s.preco.trim(), s.oferta_real.trim()].filter(Boolean).join(' · ') || '–'],
                  ['Destino', s.destino === 'whatsapp' ? `WhatsApp ${s.whatsapp}` : s.url],
                  ['Funil', FUNNELS.find((f) => f.id === s.funnel)?.label || s.funnel],
                  ['Praça', `${s.cidade}, raio de ${s.raio_km} km, ${s.idade_min} a ${s.idade_max} anos`],
                  ['Verba', `${brl(toNum(s.total))} no total, ${brl(toNum(s.daily))} por dia`],
                  ['Período', `${fmtDate(`${s.starts_on}T12:00:00Z`)} a ${fmtDate(`${s.ends_on}T12:00:00Z`)} (${days} ${days === 1 ? 'dia' : 'dias'})`],
                  ['Criativos', `${s.asset_ids.length} ${s.asset_ids.length === 1 ? 'vídeo' : 'vídeos'}, ${s.content_ids.length} ${s.content_ids.length === 1 ? 'peça' : 'peças'}`],
                  ['Kits', String(s.kits)],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[110px_1fr] sm:gap-4">
                  <dt className="label self-center">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-5 text-sm text-err">
            {error}
          </p>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={back} disabled={step === 1 || pending}>
            Voltar
          </Button>
          {step < 6 ? (
            <Button onClick={next}>Continuar</Button>
          ) : (
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending ? 'Montando o Kit Zero…' : 'Gerar Kit Zero'}
            </Button>
          )}
        </div>
      </Card>

      <aside className="space-y-4">
        <Card className="p-5">
          <div className="label mb-3">O que acontece depois</div>
          <ol className="space-y-3 text-sm text-ink2">
            {[
              ['Kit Zero', 'Briefing, o que falta, ângulos e estrutura da campanha.'],
              ['Você aprova', 'Corrija o que estiver fraco antes de gastar com copy.'],
              ['Kits completos', 'Títulos, descrições, parte 1 do criativo e pareamento.'],
              ['Subida', 'Publicar pausada na Meta ou exportar a estrutura em JSON.'],
            ].map(([t, text], i) => (
              <li key={t} className="flex gap-3">
                <span className="num mt-0.5 text-base text-accent">{i + 1}</span>
                <span>
                  <b className="font-medium text-ink">{t}.</b> {text}
                </span>
              </li>
            ))}
          </ol>
        </Card>
        <p className="px-1 text-xs text-ink3">Campanha de {clientName}. O Kit Zero usa o BrandKit, o contexto e o diagnóstico do cliente.</p>
      </aside>
    </div>
  );
}

function CheckRow({ checked, onChange, icon, title, meta }: { checked: boolean; onChange: () => void; icon: ReactNode; title: string; meta?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className={cn('press focus-ring flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors', checked ? 'border-accent bg-accent/[0.07]' : 'border-white/[0.09] hover:border-white/20 hover:bg-white/[0.03]')}
    >
      <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-md border', checked ? 'border-accent bg-accent text-black' : 'border-white/20 text-transparent')}>
        <Check className="h-3.5 w-3.5" />
      </span>
      <span className="text-ink3">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink" title={title}>
          {title}
        </span>
        {meta && <span className="block truncate text-xs text-ink3">{meta}</span>}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Relatórios por e-mail                                               */
/* ------------------------------------------------------------------ */

export type SubItem = {
  id: string;
  campaign_id: string | null;
  audience: 'interno' | 'cliente';
  emails: string[];
  frequency: 'diario' | 'semanal' | 'fim';
  send_hour: number;
  active: boolean;
};
export type ReportItem = {
  id: string;
  subscription_id: string;
  title: string;
  created_at: string;
  html: string;
  is_example: boolean;
  sent_at: string | null;
  sent_to: string[];
};

const FREQ_LABEL: Record<SubItem['frequency'], string> = { diario: 'Diário', semanal: 'Semanal', fim: 'No fim da campanha' };
const REPORT_PATHS = ['/marketing/trafego', '/marketing'];

export function ReportsPanel({
  clientId,
  subs,
  campaigns,
  reports,
  hasResend,
  defaultEmails,
}: {
  clientId: string;
  subs: SubItem[];
  campaigns: { id: string; name: string }[];
  reports: ReportItem[];
  hasResend: boolean;
  defaultEmails: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [opt, setOpt] = useState<Record<string, { value: boolean; from: boolean }>>({});
  const [selected, setSelected] = useState<string | null>(() => (subs.find((x) => reports.some((r) => r.subscription_id === x.id)) || subs[0])?.id || null);
  // Estado mostrado enquanto o servidor confirma; vale só enquanto o dado salvo ainda é o de antes do clique.
  const isActive = (sub: SubItem) => (opt[sub.id] && opt[sub.id].from === sub.active ? opt[sub.id].value : sub.active);

  const editSub = subs.find((x) => x.id === editing) || null;
  const sel = subs.find((x) => x.id === selected) || subs[0] || null;
  const report = sel ? reports.find((r) => r.subscription_id === sel.id) : undefined;
  const campaignName = (id: string | null) => (id ? campaigns.find((c) => c.id === id)?.name || 'Campanha removida' : 'Todas as campanhas');

  function generate(id: string) {
    setBusy(id);
    start(async () => {
      try {
        const r = await generateReportAction(id);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(r.isExample ? 'Prévia gerada com texto de exemplo' : 'Prévia gerada');
        setSelected(id);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(null);
      }
    });
  }

  function setActive(sub: SubItem, active: boolean) {
    setOpt((prev) => ({ ...prev, [sub.id]: { value: active, from: sub.active } }));
    start(async () => {
      const r = await updateRowAction('report_subscriptions', sub.id, { active }, REPORT_PATHS);
      if (!r.ok) {
        setOpt((prev) => {
          const next = { ...prev };
          delete next[sub.id];
          return next;
        });
        toast.error(r.error);
      } else {
        toast.success(active ? 'Envio ativado' : 'Envio pausado');
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {subs.length === 0 ? (
            <div className="grid place-items-center gap-2 rounded-2xl border border-dashed border-white/15 px-6 py-14 text-center">
              <div className="display text-2xl text-ink">Nenhum envio configurado</div>
              <p className="max-w-sm text-sm text-ink2">Crie o primeiro no formulário ao lado. Relatório diário, semanal ou de fim de campanha, para o cliente ou para o time.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {subs.map((sub) => {
                const has = reports.some((r) => r.subscription_id === sub.id);
                const on = isActive(sub);
                return (
                  <li key={sub.id} className={cn('card p-4 transition-colors', sel?.id === sub.id && 'border-white/25')}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Dot state={on ? 'done' : 'off'} />
                          <Badge tone={sub.audience === 'cliente' ? 'accent' : 'neutral'}>{sub.audience === 'cliente' ? 'Cliente' : 'Interno'}</Badge>
                          <span className="text-sm text-ink2">
                            {FREQ_LABEL[sub.frequency]}
                            {sub.frequency !== 'fim' ? ` às ${sub.send_hour}h` : ''}
                          </span>
                          {!on && <Badge>Pausado</Badge>}
                        </div>
                        <div className="mt-2 break-words text-sm text-ink">{sub.emails.join(', ') || 'Sem destinatário'}</div>
                        <div className="mt-0.5 text-xs text-ink3">{campaignName(sub.campaign_id)}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Toggle checked={on} onChange={(v) => setActive(sub, v)} label={on ? 'Pausar envio' : 'Ativar envio'} />
                        <Button variant="glass" size="sm" onClick={() => generate(sub.id)} disabled={pending}>
                          {busy === sub.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Gerar prévia do relatório
                        </Button>
                        {has && sel?.id !== sub.id && (
                          <Button variant="subtle" size="sm" onClick={() => setSelected(sub.id)}>
                            Ver prévia
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setEditing(sub.id)}>
                          Editar
                        </Button>
                        <ActionButton variant="ghost" size="sm" confirm="Excluir este envio? As prévias já geradas continuam guardadas." action={() => deleteRowAction('report_subscriptions', sub.id, REPORT_PATHS)} success="Envio excluído">
                          Excluir
                        </ActionButton>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Card className="h-fit p-5">
          <div className="label mb-3">{editSub ? 'Editar envio' : 'Novo envio'}</div>
          <ActionForm
            key={editing || 'novo'}
            action={async (fd) => {
              const r = await saveReportSubscriptionAction(fd);
              if (r.ok) setEditing(null);
              return r;
            }}
            success="Envio salvo"
            resetOnSuccess
            className="space-y-4"
          >
            {editSub && <input type="hidden" name="id" value={editSub.id} />}
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="active" value={editSub && !editSub.active ? '0' : '1'} />
            <Field label="Para quem">
              <Select className={SELECT_BG} name="audience" defaultValue={editSub?.audience || 'cliente'}>
                <option value="cliente">Cliente: resultado e próximos passos</option>
                <option value="interno">Interno: com alertas e leitura técnica</option>
              </Select>
            </Field>
            <Field label="E-mails" required hint="Separe por vírgula.">
              <Textarea name="emails" required className="min-h-[72px]" defaultValue={(editSub?.emails || defaultEmails).join(', ')} placeholder="nome@empresa.com" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Frequência">
                <Select className={SELECT_BG} name="frequency" defaultValue={editSub?.frequency || 'semanal'}>
                  <option value="diario">Diário</option>
                  <option value="semanal">Semanal</option>
                  <option value="fim">No fim da campanha</option>
                </Select>
              </Field>
              <Field label="Hora do envio">
                <Select className={SELECT_BG} name="send_hour" defaultValue={String(editSub?.send_hour ?? 9)}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {h}h
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Campanha">
              <Select className={SELECT_BG} name="campaign_id" defaultValue={editSub?.campaign_id || ''}>
                <option value="">Todas as campanhas</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-center gap-2">
              <SubmitButton pendingText="Salvando…">{editSub ? 'Salvar alterações' : 'Criar envio'}</SubmitButton>
              {editSub && (
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
              )}
            </div>
          </ActionForm>
        </Card>
      </div>

      {sel && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="label">Prévia do relatório</div>
              <h3 className="display mt-1 truncate text-xl text-ink">
                {report ? report.title : 'Nenhuma prévia gerada'}
                <Example show={!!report?.is_example} />
              </h3>
              <p className="mt-1 text-xs text-ink3">
                {report
                  ? `Gerado ${relTime(report.created_at)}${report.sent_at ? ` · enviado ${relTime(report.sent_at)} para ${report.sent_to.join(', ')}` : ' · ainda não enviado'}`
                  : `Envio ${sel.audience === 'cliente' ? 'para o cliente' : 'interno'} · ${FREQ_LABEL[sel.frequency].toLowerCase()}. Gere a prévia para ver o e-mail.`}
              </p>
            </div>
            {report && (
              <ActionButton
                variant="outline"
                action={() => sendReportAction(report.id)}
                confirm={`Enviar agora para ${sel.emails.join(', ') || 'os destinatários'}?`}
                success="Relatório enviado"
              >
                Enviar agora
              </ActionButton>
            )}
          </div>
          {report ? (
            <>
              <iframe title="Prévia do relatório por e-mail" srcDoc={report.html} sandbox="" className="h-[640px] w-full rounded-2xl border border-white/10 bg-[#f5f5f3]" />
              {!hasResend && <p className="mt-3 text-xs text-ink3">Sem a chave do Resend o envio fica bloqueado, mas a prévia continua disponível. Configure em Settings.</p>}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/15 px-6 py-10 text-center text-sm text-ink2">O relatório usa os últimos 7 dias contra a semana anterior.</div>
          )}
        </Card>
      )}
    </div>
  );
}
