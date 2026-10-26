import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveClient } from '@/lib/active-client';
import { Button, EmptyState, PageHeader } from '@/components/ui/primitives';
import { BrandStepper, StartKit } from './stepper';

export const metadata = { title: 'Brand' };
// Ações de IA (Opus/Fable com pensamento estendido) podem levar alguns minutos na Vercel.
export const maxDuration = 300;

export default async function BrandPage() {
  await requireUser();
  const active = await getActiveClient();
  if (!active) return <EmptyState title="Escolha um cliente" text="O BrandKit é feito dentro de um cliente. Escolha um no topo." action={<Button href="/clientes">Ver clientes</Button>} />;
  const { client, context } = active;
  const name = client.company || client.contact_name;
  const d = await db();
  const kits = await d.list('brand_kits', { where: { client_id: client.id }, orderBy: 'version', desc: true });
  const kit = kits[0] || null;
  const [bbAsset] = kit ? await d.list('assets', { where: { client_id: client.id, kind: 'brandbook' }, orderBy: 'created_at', desc: true, limit: 1 }) : [];
  const brandbook = bbAsset
    ? { id: bbAsset.id, url: bbAsset.url || '', name: bbAsset.name, created_at: bbAsset.created_at, example: Boolean((bbAsset.analysis as any)?.example), version: Number((bbAsset.analysis as any)?.version) || undefined }
    : null;

  return (
    <div className="space-y-2">
      <PageHeader
        kicker={`Brand · ${name}`}
        title={
          <>
            BrandKit <em>em 6 etapas</em>
          </>
        }
        subtitle="Diagnóstico, estratégia, verbal, visual, aplicações e manual. O kit aprovado alimenta o feed, os vídeos e o tráfego."
        actions={
          <Button variant="ghost" href={`/clientes/${client.id}?tab=contexto`}>
            Contexto do cliente
          </Button>
        }
      />
      {!context && (
        <p className="mb-4 text-xs text-warn">
          Este cliente ainda não tem contexto escrito. O agente vai trabalhar só com o cadastro. Quanto mais contexto, melhor o resultado.
        </p>
      )}
      {!kit ? (
        <StartKit clientId={client.id} />
      ) : (
        <BrandStepper
          kit={kit}
          clientName={name}
          clientColor={client.brand_color || '#FF5B1F'}
          versions={kits.map((k) => ({ id: k.id, version: k.version, status: k.status, mode: k.mode, approved_at: k.approved_at }))}
          brandbook={brandbook}
        />
      )}
    </div>
  );
}
