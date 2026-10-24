'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input, Select } from '@/components/ui/primitives';
import type { Service } from '@/lib/db/types';
import { deleteServiceAction, saveServiceAction } from '@/lib/actions/settings';

const priceText = (n: number) => String(n).replace('.', ',');

/**
 * Linha editável do catálogo. Os campos são controlados; o botão Salvar só aparece quando algo mudou.
 * A página usa uma chave com todos os campos, então a linha recomeça do zero quando o servidor devolve dados novos.
 */
export function ServiceRow({ service }: { service: Service }) {
  const router = useRouter();
  const initial = {
    name: service.name,
    front: service.front,
    kind: service.kind as string,
    price: priceText(service.base_price),
    recurring: service.recurring,
    description: service.description || '',
  };
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = <K extends keyof typeof initial>(k: K, val: (typeof initial)[K]) => setV((x) => ({ ...x, [k]: val }));

  function save() {
    const fd = new FormData();
    fd.set('id', service.id);
    fd.set('name', v.name);
    fd.set('front', v.front);
    fd.set('kind', v.kind);
    fd.set('base_price', v.price);
    if (v.recurring) fd.set('recurring', 'on');
    fd.set('description', v.description);
    start(async () => {
      try {
        const r = await saveServiceAction(fd);
        if (r.ok === false) toast.error(r.error);
        else {
          toast.success('Serviço salvo');
          router.refresh();
        }
      } catch (e) {
        toast.error((e as Error).message || 'Não foi possível salvar.');
      }
    });
  }

  function remove() {
    if (!window.confirm(`Excluir "${service.name}" do catálogo?`)) return;
    start(async () => {
      try {
        const r = await deleteServiceAction(service.id);
        if (r.ok === false) toast.error(r.error);
        else {
          toast.success('Serviço excluído');
          router.refresh();
        }
      } catch (e) {
        toast.error((e as Error).message || 'Não foi possível excluir.');
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_112px_132px]">
      <Input value={v.name} onChange={(e) => set('name', e.target.value)} aria-label={`Nome do serviço ${service.name}`} />
      <Input value={v.front} onChange={(e) => set('front', e.target.value)} list="catalog-fronts" aria-label="Frente" />
      <Select value={v.kind} onChange={(e) => set('kind', e.target.value)} aria-label="Tipo de cobrança">
        <option value="projeto">Projeto</option>
        <option value="mensal">Mensal</option>
        <option value="avulso">Avulso</option>
      </Select>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink3">R$</span>
        <Input value={v.price} onChange={(e) => set('price', e.target.value)} inputMode="decimal" className="pl-9" aria-label="Preço base em reais" />
      </div>
      <Input value={v.description} onChange={(e) => set('description', e.target.value)} placeholder="Descrição curta" aria-label="Descrição" className="sm:col-span-4" />
      <div className="flex items-center justify-between gap-3 sm:col-span-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink2">
          <input type="checkbox" checked={v.recurring} onChange={(e) => set('recurring', e.target.checked)} className="h-4 w-4 accent-accent" />
          Recorrente
        </label>
        <div className="flex items-center gap-1.5">
          {dirty && (
            <Button size="sm" variant="subtle" onClick={save} disabled={pending}>
              Salvar
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={remove} disabled={pending} aria-label={`Excluir ${service.name}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
