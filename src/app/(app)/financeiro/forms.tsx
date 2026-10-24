'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { createExpenseAction, createInvoiceAction, generateMonthlyInvoicesAction } from '@/lib/actions/finance';

export type ContractOption = { id: string; clientId: string | null; title: string; amount: number };

/* ---------- Nova fatura ---------- */
export function InvoiceForm({ clients, contracts, today }: { clients: { id: string; name: string }[]; contracts: ContractOption[]; today: string }) {
  const router = useRouter();
  const [clientId, setClientId] = useState('');
  const [contractId, setContractId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState(today);
  const [method, setMethod] = useState('pix');
  const [touched, setTouched] = useState({ description: false, amount: false });

  const options = useMemo(() => contracts.filter((c) => c.clientId === clientId), [contracts, clientId]);

  function pickContract(id: string) {
    setContractId(id);
    const c = contracts.find((x) => x.id === id);
    if (!c) return;
    if (!touched.description) setDescription(c.title);
    if (!touched.amount && c.amount > 0) setAmount(String(c.amount));
  }

  function reset() {
    setClientId('');
    setContractId('');
    setDescription('');
    setAmount('');
    setDue(today);
    setMethod('pix');
    setTouched({ description: false, amount: false });
  }

  return (
    <form
      className="space-y-3"
      action={async (fd) => {
        try {
          const r = await createInvoiceAction(fd);
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success('Fatura criada');
          reset();
          router.refresh();
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
    >
      <Field label="Cliente" required>
        <Select
          name="client_id"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setContractId('');
          }}
          required
        >
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
      <Field label="Contrato" hint={clientId && options.length === 0 ? 'Este cliente não tem contrato.' : 'Opcional. Preenche descrição e valor.'}>
        <Select name="contract_id" value={contractId} onChange={(e) => pickContract(e.target.value)} disabled={options.length === 0}>
          <option value="">Sem contrato</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Descrição" required>
        <Input
          name="description"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setTouched((t) => ({ ...t, description: true }));
          }}
          placeholder="Ex.: Presença mensal · novembro"
          required
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)" required>
          <Input
            name="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setTouched((t) => ({ ...t, amount: true }));
            }}
            placeholder="0"
            required
          />
        </Field>
        <Field label="Vencimento" required>
          <Input type="date" name="due_on" value={due} onChange={(e) => setDue(e.target.value)} required />
        </Field>
      </div>
      <Field label="Forma de pagamento">
        <Select name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="pix">Pix</option>
          <option value="boleto">Boleto</option>
          <option value="cartao">Cartão</option>
          <option value="transferencia">Transferência</option>
        </Select>
      </Field>
      <SubmitButton className="w-full" pendingText="Criando">
        Criar fatura
      </SubmitButton>
    </form>
  );
}

/* ---------- Nova despesa ---------- */
export function ExpenseForm({ clients, today }: { clients: { id: string; name: string }[]; today: string }) {
  return (
    <ActionForm action={createExpenseAction} success="Despesa lançada" resetOnSuccess className="space-y-3">
      <Field label="Categoria" required>
        <Input name="category" list="categorias-despesa" placeholder="Ex.: Ferramentas" required />
        <datalist id="categorias-despesa">
          {['Ferramentas', 'Freelancers', 'Equipamento', 'Impostos', 'Marketing', 'Escritório', 'Deslocamento'].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="Fornecedor">
        <Input name="supplier" placeholder="Ex.: Vercel" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)" required>
          <Input name="amount" inputMode="decimal" placeholder="0" required />
        </Field>
        <Field label="Vencimento">
          <Input type="date" name="due_on" defaultValue={today} />
        </Field>
      </div>
      <Field label="Cliente" hint="Opcional. Atribui o custo a um cliente.">
        <Select name="client_id" defaultValue="">
          <option value="">Custo do Studio</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink2">
        <input type="checkbox" name="paid" className="h-4 w-4 accent-[#FF5B1F]" /> Já foi paga
      </label>
      <SubmitButton className="w-full" pendingText="Lançando">
        Lançar despesa
      </SubmitButton>
    </ActionForm>
  );
}

/* ---------- Gerar faturas do mês ---------- */
export function GenerateInvoicesButton({ monthLabel, disabled }: { monthLabel: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="glass"
      className="w-full"
      disabled={pending || disabled}
      title={disabled ? 'Todos os contratos mensais assinados já têm fatura neste mês.' : undefined}
      onClick={() => {
        if (!window.confirm(`Gerar as faturas de ${monthLabel} dos contratos mensais assinados? Quem já tem fatura no mês é pulado.`)) return;
        start(async () => {
          try {
            const r = await generateMonthlyInvoicesAction();
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            if (r.created > 0) {
              toast.success(`${r.created} ${r.created === 1 ? 'fatura criada' : 'faturas criadas'} para ${monthLabel}`);
              router.refresh();
            } else if (r.skipped > 0) {
              toast.info(`Nada a gerar: ${r.skipped} ${r.skipped === 1 ? 'contrato mensal já tem' : 'contratos mensais já têm'} fatura em ${monthLabel}.`);
            } else {
              toast.info('Nenhum contrato mensal assinado para faturar neste mês.');
            }
          } catch (e) {
            toast.error((e as Error).message);
          }
        });
      }}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
      Gerar faturas do mês
    </Button>
  );
}
