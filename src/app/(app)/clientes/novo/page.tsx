import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { PageHeader } from '@/components/ui/primitives';
import { NewClientWizard } from './wizard';

export const metadata = { title: 'Novo cliente' };

export default async function NovoClientePage() {
  const user = await requireUser();
  const d = await db();
  const team = await d.list('profiles', { orderBy: 'full_name' });
  return (
    <div>
      <PageHeader kicker="Clientes" title={<>Novo <em>cliente</em></>} subtitle="Quatro passos. Ao concluir, o agente Comercial entrega diagnóstico, serviços recomendados e um rascunho de proposta." />
      <NewClientWizard team={team.map((t) => ({ id: t.id, full_name: t.full_name }))} me={user.id} />
    </div>
  );
}
