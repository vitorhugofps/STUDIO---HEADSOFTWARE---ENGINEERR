'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Kanban, type KanbanColumn } from '@/components/ui/kanban';
import { Badge, Button, Field, Progress, Textarea } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/client';
import { moveDealAction, setDealLostReasonAction } from '@/lib/actions/sales';

/** Negociação já formatada no servidor (datas e moeda), para o card não depender de fuso nem de relógio. */
export type DealVM = {
  id: string;
  stage: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  clientColor: string | null;
  valueLabel: string;
  probability: number;
  nextLabel: string | null;
  late: boolean;
  ownerName: string | null;
};

export function PipelineBoard({ deals, columns }: { deals: DealVM[]; columns: KanbanColumn[] }) {
  const router = useRouter();
  const [lostId, setLostId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const cards = deals.map((d) => ({ id: d.id, column: d.stage, content: <DealCard deal={d} /> }));
  // O Kanban guarda os cards no próprio estado. A chave muda quando os dados do servidor mudam, e ele recarrega.
  const signature = deals.map((d) => `${d.id}:${d.stage}:${d.valueLabel}:${d.probability}:${d.nextLabel}:${d.late}`).join('|');

  async function onMove(id: string, stage: string) {
    const r = await moveDealAction(id, stage);
    if (r.ok && stage === 'perdido') {
      setReason('');
      setLostId(id);
    }
    return r;
  }

  async function saveReason() {
    if (!lostId) return;
    if (!reason.trim()) {
      setLostId(null);
      return;
    }
    setSaving(true);
    try {
      const r = await setDealLostReasonAction(lostId, reason);
      if (!r.ok) toast.error(r.error);
      else {
        toast.success('Motivo salvo');
        setLostId(null);
        router.refresh();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Kanban key={signature} columns={columns} cards={cards} onMove={onMove} />
      <Modal open={lostId !== null} onClose={() => setLostId(null)} title="Por que perdemos?">
        <div className="space-y-4">
          <p className="text-sm text-ink2">Opcional. Anotar o motivo ajuda a ler o funil depois.</p>
          <Field label="Motivo">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: preço acima do orçamento, escolheu outra agência, adiou para o ano que vem" autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setLostId(null)}>
              Pular
            </Button>
            <Button onClick={saveReason} disabled={saving}>
              Salvar motivo
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function DealCard({ deal }: { deal: DealVM }) {
  return (
    <div className="space-y-2.5">
      <div className="line-clamp-2 text-sm font-medium leading-snug text-ink">{deal.title}</div>
      {deal.clientId && deal.clientName ? (
        <Link href={`/clientes/${deal.clientId}`} className="inline-flex max-w-full items-center gap-1.5 text-xs text-ink2 hover:text-ink">
          <span className="dot" style={{ background: deal.clientColor || '#FF5B1F' }} />
          <span className="truncate">{deal.clientName}</span>
        </Link>
      ) : (
        <span className="block text-xs text-ink3">Sem cliente vinculado</span>
      )}
      <div className="flex items-end justify-between gap-2">
        <span className="num text-xl text-ink">{deal.valueLabel}</span>
        <span className="num text-xs text-ink2">{deal.probability}%</span>
      </div>
      <Progress value={deal.probability} className="h-1" tone={deal.stage === 'perdido' ? 'err' : deal.stage === 'fechado' ? 'ok' : 'accent'} />
      <div className="flex items-center justify-between gap-2 text-[11px] text-ink3">
        <span className="truncate">{deal.nextLabel ? `Próxima ação ${deal.nextLabel}` : 'Sem próxima ação'}</span>
        {deal.late && <Badge tone="err">atrasado</Badge>}
      </div>
      {deal.ownerName && <div className="text-[11px] text-ink3">{deal.ownerName}</div>}
    </div>
  );
}
