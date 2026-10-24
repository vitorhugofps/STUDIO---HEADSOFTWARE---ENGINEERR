import Link from 'next/link';
import { Plus, Users } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { CLIENT_STATUS_LABEL, type ClientStatus } from '@/lib/db/types';
import { Badge, Button, Dot, EmptyState, PageHeader, PillTabs, Table, TD, TH } from '@/components/ui/primitives';
import { fmtDate, relTime } from '@/lib/utils';

export const metadata = { title: 'Clientes' };

const FILTERS: { key: string; label: string; statuses?: ClientStatus[] }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'leads', label: 'Leads', statuses: ['lead'] },
  { key: 'diagnostico', label: 'Em diagnóstico', statuses: ['diagnostico', 'proposta'] },
  { key: 'ativos', label: 'Ativos', statuses: ['ativo'] },
  { key: 'pausados', label: 'Pausados', statuses: ['pausado'] },
  { key: 'encerrados', label: 'Encerrados', statuses: ['encerrado', 'perdido'] },
];

export default async function ClientesPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const d = await db();
  const [clients, projects, profiles, activity] = await Promise.all([d.list('clients', { orderBy: 'updated_at', desc: true }), d.list('projects'), d.list('profiles'), d.list('activity_log', { orderBy: 'created_at', desc: true })]);
  const filter = FILTERS.find((f) => f.key === (sp.f || 'todos')) || FILTERS[0];
  const q = (sp.q || '').toLowerCase();
  const rows = clients.filter((c) => (!filter.statuses || filter.statuses.includes(c.status)) && (!q || `${c.company} ${c.contact_name} ${c.segment} ${c.city}`.toLowerCase().includes(q)));
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, clients.filter((c) => !f.statuses || f.statuses.includes(c.status)).length]));

  return (
    <div>
      <PageHeader
        kicker="CRM"
        title={<>Clientes <em>{clients.length}</em></>}
        subtitle="Tudo nasce aqui: contexto, questionário e diagnóstico. Cada cliente tem a própria página com os projetos da agência."
        actions={
          <Button href="/clientes/novo">
            <Plus className="h-4 w-4" /> Novo cliente
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PillTabs tabs={FILTERS.map((f) => ({ href: `/clientes?f=${f.key}`, label: f.label, count: counts[f.key] }))} current={`/clientes?f=${filter.key}`} />
        <form className="flex gap-2">
          <input type="hidden" name="f" value={filter.key} />
          <input name="q" defaultValue={sp.q || ''} placeholder="Buscar por nome, segmento, cidade" className="focus-ring h-9 w-64 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-ink placeholder:text-ink3" />
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" />} title="Nenhum cliente aqui" text="Cadastre o primeiro cliente com contexto e questionário. O diagnóstico sai em menos de 2 minutos." action={<Button href="/clientes/novo">Novo cliente</Button>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <TH>Cliente</TH>
              <TH>Segmento</TH>
              <TH>Status</TH>
              <TH>Projetos</TH>
              <TH>Responsável</TH>
              <TH>Maturidade</TH>
              <TH>Última atividade</TH>
              <TH>Saúde</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const cp = projects.filter((p) => p.client_id === c.id);
              const owner = profiles.find((p) => p.id === c.owner_id);
              const last = activity.find((a) => a.entity_id === c.id || (a.entity === 'clients' && a.entity_id === c.id));
              return (
                <tr key={c.id} className="group transition-colors hover:bg-white/[0.03]">
                  <TD>
                    <Link href={`/clientes/${c.id}`} className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-full text-[11px] font-semibold text-black" style={{ background: c.brand_color || '#FF5B1F' }}>
                        {(c.company || c.contact_name).slice(0, 2).toUpperCase()}
                      </span>
                      <span>
                        <span className="block font-medium text-ink group-hover:text-accent">{c.company || c.contact_name}</span>
                        <span className="block text-xs text-ink3">{c.contact_name} · {c.city}</span>
                      </span>
                    </Link>
                  </TD>
                  <TD className="text-ink2">{c.segment}</TD>
                  <TD>
                    <Badge tone={c.status === 'ativo' ? 'ok' : c.status === 'lead' ? 'neutral' : ['encerrado', 'perdido'].includes(c.status) ? 'err' : 'accent'}>{CLIENT_STATUS_LABEL[c.status]}</Badge>
                  </TD>
                  <TD className="text-ink2">
                    {cp.filter((p) => p.status !== 'finalizado').length} ativos · {cp.filter((p) => p.status === 'finalizado').length} finalizados
                  </TD>
                  <TD className="text-ink2">{owner?.full_name?.split(' ')[0] || ''}</TD>
                  <TD>
                    {c.maturity_index != null ? (
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.07]"><span className="block h-full bg-accent" style={{ width: `${c.maturity_index}%` }} /></span>
                        <span className="num text-xs text-ink2">{c.maturity_index}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-ink3">sem diagnóstico</span>
                    )}
                  </TD>
                  <TD className="text-xs text-ink3">{last ? relTime(last.created_at) : fmtDate(c.created_at)}</TD>
                  <TD>
                    <Dot state={c.health === 'vermelho' ? 'err' : c.health === 'amarelo' ? 'wave' : 'done'} />
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
