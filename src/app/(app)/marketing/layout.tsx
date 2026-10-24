import { requireUser } from '@/lib/auth';
import { getActiveClient } from '@/lib/active-client';
import { MarketingTabs } from './tabs';
import { Badge, Button, EmptyState } from '@/components/ui/primitives';
import { Megaphone } from 'lucide-react';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const active = await getActiveClient();
  if (!active) {
    return <EmptyState icon={<Megaphone className="h-5 w-5" />} title="Escolha um cliente" text="Marketing trabalha sempre dentro de um cliente. Cadastre o primeiro ou escolha um no topo." action={<Button href="/clientes/novo">Novo cliente</Button>} />;
  }
  const { client, brandKit, context, diagnosis } = active;
  const ready = [
    { ok: !!brandKit && brandKit.status === 'aprovado', label: 'BrandKit aprovado', href: '/marketing/brand' },
    { ok: !!context, label: 'Contexto escrito', href: `/clientes/${client.id}?tab=contexto` },
    { ok: !!diagnosis, label: 'Diagnóstico', href: `/clientes/${client.id}?tab=diagnostico` },
    { ok: !!client.meta_ad_account_id, label: 'Conta de anúncios', href: '/marketing/trafego' },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl text-xs font-semibold text-black" style={{ background: client.brand_color || '#FF5B1F' }}>
            {(client.company || client.contact_name).slice(0, 2).toUpperCase()}
          </span>
          <div>
            <div className="label">Marketing de</div>
            <div className="display text-2xl text-ink">{client.company || client.contact_name}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ready.map((r) => (
            <a key={r.label} href={r.href}>
              <Badge tone={r.ok ? 'ok' : 'warn'}>
                {r.ok ? '✓' : '✗'} {r.label}
              </Badge>
            </a>
          ))}
        </div>
      </div>
      <MarketingTabs />
      {children}
    </div>
  );
}
