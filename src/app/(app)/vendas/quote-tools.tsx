'use client';

import { useRouter } from 'next/navigation';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { SubmitButton } from '@/components/ui/client';
import { generateQuoteAction } from '@/lib/actions/sales';

/** Abre a caixa de impressão do navegador. A navegação some sozinha (classe no-print), e "Salvar como PDF" gera o arquivo. */
export function PrintButton({ label = 'Imprimir / PDF' }: { label?: string }) {
  return (
    <Button variant="glass" onClick={() => window.print()}>
      <Printer className="h-4 w-4" /> {label}
    </Button>
  );
}

/** Formulário "Nova proposta com IA". Ao terminar, abre a proposta criada. */
export function QuoteGenerator({
  clients,
  defaultClientId,
  aiEnabled,
}: {
  clients: { id: string; name: string }[];
  defaultClientId?: string;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  return (
    <form
      className="space-y-3"
      action={async (fd) => {
        try {
          const r = await generateQuoteAction(fd);
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success(r.isExample ? `Proposta ${r.number} criada com texto de exemplo` : `Proposta ${r.number} criada`);
          router.push(`/vendas?t=propostas&q=${r.id}`);
          router.refresh();
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
    >
      <Field label="Cliente" required>
        <Select name="client_id" defaultValue={defaultClientId || ''} required>
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
      <Field label="Valor-alvo" hint="Opcional. Total do projeto da opção recomendada.">
        <Input name="valor_alvo" inputMode="decimal" placeholder="Ex.: 6.500" />
      </Field>
      <Field label="Observações" hint="Opcional. O que o cliente pediu, prazo, restrições.">
        <Textarea name="observacoes" className="min-h-[84px]" placeholder="Ex.: quer começar em novembro, já tem logo em vetor" />
      </Field>
      <SubmitButton className="w-full" pendingText="Gerando proposta">
        Gerar proposta
      </SubmitButton>
      <p className="text-xs text-ink3">
        {aiEnabled
          ? 'Lê o cliente, o último diagnóstico e o catálogo. Leva alguns segundos.'
          : 'Sem chave da IA configurada: a proposta sai com texto de exemplo, marcado como exemplo.'}
      </p>
    </form>
  );
}
