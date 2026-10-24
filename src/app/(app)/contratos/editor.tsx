'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Printer, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { SubmitButton } from '@/components/ui/client';
import { createContractAction, updateContractBodyAction } from '@/lib/actions/sales';

type Kind = 'projeto' | 'recorrente' | 'parceria' | 'imagem' | 'case';

const KIND_OPTIONS: { value: Kind; label: string; short: string }[] = [
  { value: 'projeto', label: 'Projeto, pagamento 50/50', short: 'Projeto' },
  { value: 'recorrente', label: 'Plano mensal (recorrente)', short: 'Plano mensal' },
  { value: 'parceria', label: 'Parceria com exclusividade', short: 'Parceria' },
  { value: 'imagem', label: 'Cessão de imagem', short: 'Cessão de imagem' },
  { value: 'case', label: 'Autorização de case', short: 'Autorização de case' },
];

/** Mesma data um ano depois (YYYY-MM-DD), sem depender de fuso. */
function plus12(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${Number(y) + 1}-${m}-${m === '02' && d === '29' ? '28' : d}`;
}

/* ---------- Novo contrato ---------- */
export function NewContractForm({
  clients,
  defaultClientId,
  defaultKind,
  today,
}: {
  clients: { id: string; name: string }[];
  defaultClientId?: string;
  defaultKind?: Kind;
  today: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(defaultKind || 'projeto');
  const [clientId, setClientId] = useState(defaultClientId || '');
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [ends, setEnds] = useState('');
  const [endsTouched, setEndsTouched] = useState(false);

  const hasMonthly = kind === 'recorrente' || kind === 'parceria';
  const hasValue = kind === 'projeto' || kind === 'recorrente';
  const clientName = clients.find((c) => c.id === clientId)?.name || '';

  // Sugere título e data final enquanto a pessoa não mexeu neles.
  useEffect(() => {
    if (!titleTouched) setTitle(clientName ? `${clientName} · ${KIND_OPTIONS.find((k) => k.value === kind)?.short}` : '');
  }, [clientName, kind, titleTouched]);
  useEffect(() => {
    if (!endsTouched) setEnds(kind === 'recorrente' || kind === 'parceria' ? plus12(today) : '');
  }, [kind, endsTouched, today]);

  return (
    <form
      className="space-y-3"
      action={async (fd) => {
        try {
          const r = await createContractAction(fd);
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success('Contrato criado em rascunho');
          router.push(`/contratos?c=${r.id}`);
          router.refresh();
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
    >
      <Field label="Cliente" required>
        <Select name="client_id" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
          <option value="" disabled>
            Escolha o cliente
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Tipo" required>
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {KIND_OPTIONS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Título" required>
        <Input
          name="title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleTouched(true);
          }}
          placeholder="Ex.: Clínica Inti · Temporada"
          required
        />
      </Field>
      {(hasValue || hasMonthly) && (
        <div className="grid grid-cols-2 gap-3">
          {hasValue && (
            <Field label={kind === 'recorrente' ? 'Projeto (R$)' : 'Valor (R$)'} hint={kind === 'recorrente' ? 'Opcional' : undefined}>
              <Input name="value" inputMode="decimal" placeholder="0" />
            </Field>
          )}
          {hasMonthly && (
            <Field label="Mensal (R$)" required>
              <Input name="monthly" inputMode="decimal" placeholder="0" required />
            </Field>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Início" required>
          <Input type="date" name="starts_on" defaultValue={today} required />
        </Field>
        <Field label="Fim">
          <Input
            type="date"
            name="ends_on"
            value={ends}
            onChange={(e) => {
              setEnds(e.target.value);
              setEndsTouched(true);
            }}
          />
        </Field>
      </div>
      <SubmitButton className="w-full" pendingText="Criando">
        Criar contrato
      </SubmitButton>
      <p className="text-xs text-ink3">O texto sai do modelo do Studio com as partes, o prazo e os valores preenchidos. Você edita antes de enviar.</p>
    </form>
  );
}

/* ---------- Texto do contrato ---------- */
export function ContractEditor({ id, title, initial }: { id: string; title: string; initial: string }) {
  const router = useRouter();
  const [body, setBody] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const dirty = body !== saved;

  useEffect(() => {
    setBody(initial);
    setSaved(initial);
  }, [initial, id]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function save() {
    start(async () => {
      try {
        const r = await updateContractBodyAction(id, body);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        setSaved(body);
        toast.success('Texto do contrato salvo');
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <>
      <Card className="no-print p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="label">Texto do contrato</div>
            <div className="mt-1 text-xs text-ink3">{dirty ? 'Alterações não salvas.' : 'Tudo salvo.'} Lacunas entre colchetes e linhas em branco são para preencher.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">Assinatura eletrônica (Clicksign/ZapSign): próxima fase</Badge>
            <Button variant="glass" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Imprimir
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty || pending}>
              <Save className="h-4 w-4" /> {pending ? 'Salvando' : 'Salvar texto'}
            </Button>
          </div>
        </div>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck
          aria-label="Texto do contrato"
          className="min-h-[620px] font-mono text-[13px] leading-relaxed"
        />
      </Card>

      {/* Cópia para impressão: só o texto, em papel branco */}
      <div className="hidden text-black print:block">
        <h1 className="mb-4 text-lg font-bold">{title}</h1>
        <pre className="whitespace-pre-wrap font-sans text-[11pt] leading-relaxed">{body}</pre>
      </div>
    </>
  );
}
