import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink, Globe, Instagram, MessageCircle, Megaphone, Plus, Sparkles, FileText, RefreshCw } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { CLIENT_STATUS_LABEL, KIND_LABEL, STAGE_LABEL } from '@/lib/db/types';
import { PAIN_LABEL } from '@/lib/questionnaire';
import { brl, fmtDate, relTime, waLink, sum } from '@/lib/utils';
import { Badge, Button, Card, Dot, Example, Field, Input, ListRow, PillTabs, Progress, Select, Textarea, EmptyState } from '@/components/ui/primitives';
import { ActionButton, ActionForm, SubmitButton } from '@/components/ui/client';
import { PainBars } from '@/components/ui/charts';
import { Dropzone, FileKindIcon } from '@/components/ui/dropzone';
import { createProjectAction, runDiagnosisAction, saveContextAction, updateClientAction } from '@/lib/actions/clients';
import { setActiveClientAction } from '@/lib/actions/common';

export default async function ClientePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { tab = 'visao' } = await searchParams;
  const d = await db();
  const client = await d.get('clients', id);
  if (!client) notFound();

  const [projects, contexts, diagnoses, assets, campaigns, invoices, contracts, activity, profiles, tasks, quotes] = await Promise.all([
    d.list('projects', { where: { client_id: id }, orderBy: 'updated_at', desc: true }),
    d.list('client_contexts', { where: { client_id: id }, orderBy: 'version', desc: true }),
    d.list('diagnoses', { where: { client_id: id }, orderBy: 'created_at', desc: true }),
    d.list('assets', { where: { client_id: id }, orderBy: 'created_at', desc: true }),
    d.list('campaigns', { where: { client_id: id } }),
    d.list('invoices', { where: { client_id: id }, orderBy: 'due_on', desc: true }),
    d.list('contracts', { where: { client_id: id } }),
    d.list('activity_log', { orderBy: 'created_at', desc: true, limit: 200 }),
    d.list('profiles'),
    d.list('tasks', { where: { client_id: id } }),
    d.list('quotes', { where: { client_id: id } }),
  ]);
  const ctx = contexts[0];
  const diag = diagnoses[0];
  const owner = profiles.find((p) => p.id === client.owner_id);
  const history = activity.filter((a) => a.entity_id === id || projects.some((p) => p.id === a.entity_id) || diagnoses.some((x) => x.id === a.entity_id));
  const running = projects.filter((p) => p.status !== 'finalizado');
  const done = projects.filter((p) => p.status === 'finalizado');
  const paid = sum(invoices.filter((i) => i.status === 'paga'), (i) => i.amount);
  const open = sum(invoices.filter((i) => i.status !== 'paga' && i.status !== 'cancelada'), (i) => i.amount);
  const ig = client.socials?.find((s) => s.rede === 'instagram');

  const TABS = [
    { href: `/clientes/${id}?tab=visao`, label: 'Visão geral' },
    { href: `/clientes/${id}?tab=projetos`, label: 'Projetos', count: projects.length },
    { href: `/clientes/${id}?tab=contexto`, label: 'Contexto' },
    { href: `/clientes/${id}?tab=diagnostico`, label: 'Diagnóstico' },
    { href: `/clientes/${id}?tab=arquivos`, label: 'Arquivos', count: assets.length },
    { href: `/clientes/${id}?tab=financeiro`, label: 'Financeiro' },
    { href: `/clientes/${id}?tab=historico`, label: 'Histórico' },
    { href: `/clientes/${id}?tab=editar`, label: 'Editar' },
  ];

  return (
    <div className="space-y-6">
      {/* Cabeçalho "usuário" do cliente */}
      <section className="nevoa card relative overflow-hidden rounded-3xl p-7" style={{ ['--accent' as any]: hexToRgb(client.brand_color) }}>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-5">
            <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-3xl text-2xl font-semibold text-black shadow-pop" style={{ background: client.brand_color || '#FF5B1F' }}>
              {client.logo_url ? <img src={client.logo_url} alt="" className="h-full w-full object-cover" /> : (client.company || client.contact_name).slice(0, 2).toUpperCase()}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={client.status === 'ativo' ? 'ok' : 'accent'}>{CLIENT_STATUS_LABEL[client.status]}</Badge>
                <Badge>{client.segment}</Badge>
                <Dot state={client.health === 'vermelho' ? 'err' : client.health === 'amarelo' ? 'wave' : 'done'} />
              </div>
              <h1 className="display mt-2 text-[40px] leading-[0.92] text-ink md:text-[48px]">{client.company || client.contact_name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink2">
                <span>{client.contact_name}</span>
                <span>{client.city}/{client.state}</span>
                {owner && <span>Responsável: {owner.full_name}</span>}
                {client.maturity_index != null && <span>Maturidade digital <b className="num text-ink">{client.maturity_index}</b>/100</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {client.website && <Quick href={client.website} icon={<Globe className="h-3.5 w-3.5" />} label="Site" />}
                {ig && <Quick href={ig.url} icon={<Instagram className="h-3.5 w-3.5" />} label="Instagram" />}
                {client.whatsapp && <Quick href={waLink(client.whatsapp)} icon={<MessageCircle className="h-3.5 w-3.5" />} label={client.whatsapp} />}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton variant="glass" action={setActiveClientAction.bind(null, id)} success="Cliente ativo definido" afterPath="/marketing">
              <Megaphone className="h-4 w-4" /> Abrir Marketing
            </ActionButton>
            <Button variant="glass" href={`/clientes/${id}?tab=projetos#novo`}>
              <Plus className="h-4 w-4" /> Novo projeto
            </Button>
            <Button href={`/vendas?cliente=${id}`}>
              <FileText className="h-4 w-4" /> Gerar proposta
            </Button>
          </div>
        </div>
      </section>

      {/* Projetos do cliente, logo abaixo do perfil */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="label">Projetos do cliente</div>
            <h2 className="display text-xl text-ink">
              {running.length} em andamento · {done.length} finalizados
            </h2>
          </div>
          <Link href={`/clientes/${id}?tab=projetos`} className="text-xs text-ink2 hover:text-ink">
            Ver todos →
          </Link>
        </div>
        {projects.length === 0 ? (
          <EmptyState title="Nenhum projeto ainda" text="Abra o primeiro projeto deste cliente ou gere uma proposta." action={<Button href={`/clientes/${id}?tab=projetos#novo`}>Novo projeto</Button>} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {projects.slice(0, 8).map((p) => (
              <ProjectCard key={p.id} p={p} owner={profiles.find((x) => x.id === p.owner_id)?.full_name} />
            ))}
          </div>
        )}
      </section>

      <PillTabs tabs={TABS} current={`/clientes/${id}?tab=${tab}`} />

      {tab === 'visao' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <div className="label mb-2">Quem é</div>
            <p className="text-sm leading-relaxed text-ink">{client.who_is || 'Sem descrição ainda.'}</p>
            {diag && (
              <>
                <div className="hairline my-4" />
                <div className="label mb-2">Resumo do diagnóstico <Example show={diag.is_example} /></div>
                <p className="text-sm leading-relaxed text-ink2">{diag.summary}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {diag.recommended_services.map((s) => (
                    <Badge key={s.service} tone="accent">
                      {s.priority}. {s.service}
                    </Badge>
                  ))}
                  {diag.recommended_plan && <Badge tone="ok">Plano {diag.recommended_plan}</Badge>}
                </div>
              </>
            )}
          </Card>
          <div className="space-y-4">
            <Card className="p-5">
              <div className="label mb-3">Conta</div>
              <dl className="space-y-2 text-sm">
                <Row k="Recebido" v={brl(paid)} />
                <Row k="Em aberto" v={brl(open)} />
                <Row k="Contratos" v={String(contracts.filter((c) => c.status === 'assinado').length)} />
                <Row k="Campanhas" v={`${campaigns.filter((c) => c.status === 'ativa').length} ativas`} />
                <Row k="Tarefas abertas" v={String(tasks.filter((t) => t.status !== 'feito').length)} />
                <Row k="Propostas" v={String(quotes.length)} />
              </dl>
            </Card>
            {diag && (
              <Card className="p-5">
                <div className="label mb-3">Mapa de dores</div>
                <PainBars pain={diag.pain_map} labels={PAIN_LABEL} />
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === 'projetos' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            {projects.map((p) => (
              <ProjectCard key={p.id} p={p} owner={profiles.find((x) => x.id === p.owner_id)?.full_name} wide />
            ))}
            {projects.length === 0 && <EmptyState title="Sem projetos" />}
          </div>
          <Card className="p-5" id="novo">
            <div className="label mb-3">Novo projeto</div>
            <ActionForm action={createProjectAction} success="Projeto criado" resetOnSuccess className="space-y-3">
              <input type="hidden" name="client_id" value={id} />
              <Field label="Título" required>
                <Input name="title" placeholder="Ex.: Feed de novembro" required />
              </Field>
              <Field label="Tipo">
                <Select name="kind" defaultValue="feed">
                  {Object.entries(KIND_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Início">
                  <Input type="date" name="starts_on" />
                </Field>
                <Field label="Entrega">
                  <Input type="date" name="due_on" />
                </Field>
              </div>
              <Field label="Responsável">
                <Select name="owner_id" defaultValue={user.id}>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Briefing curto">
                <Textarea name="brief" className="min-h-[72px]" />
              </Field>
              <SubmitButton className="w-full">Criar projeto</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}

      {tab === 'contexto' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div className="label">Contexto · versão {ctx?.version || 0}</div>
              {contexts.length > 1 && <span className="text-xs text-ink3">{contexts.length} versões</span>}
            </div>
            <ActionForm action={saveContextAction.bind(null, id)} success="Contexto salvo como nova versão" className="space-y-4">
              {[
                ['quem_e', 'O que ele é e quem ele é'],
                ['oferece', 'O que oferece'],
                ['id_visual', 'Identidade visual atual'],
                ['linguagem', 'Identidade de linguagem'],
                ['dores', 'Dores percebidas'],
                ['notas', 'Observações'],
              ].map(([k, label]) => (
                <Field key={k} label={label}>
                  <Textarea name={k} defaultValue={ctx?.blocks?.[k] || ''} className="min-h-[72px]" />
                </Field>
              ))}
              <SubmitButton>Salvar nova versão</SubmitButton>
            </ActionForm>
          </Card>
          <Card className="p-5">
            <div className="label mb-2">Anexar ao contexto</div>
            <Dropzone clientId={id} compact />
          </Card>
        </div>
      )}

      {tab === 'diagnostico' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {!diag ? (
              <EmptyState icon={<Sparkles className="h-5 w-5" />} title="Sem diagnóstico" text="Responda o questionário no cadastro ou gere agora a partir do contexto." action={<ActionButton action={runDiagnosisAction.bind(null, id)} success="Diagnóstico gerado">Gerar diagnóstico</ActionButton>} />
            ) : (
              <>
                <Card className="p-5">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="label">Resumo <Example show={diag.is_example} /></div>
                    <ActionButton variant="subtle" size="sm" action={runDiagnosisAction.bind(null, id)} success="Diagnóstico regenerado">
                      <RefreshCw className="h-3.5 w-3.5" /> Regerar
                    </ActionButton>
                  </div>
                  <p className="text-sm leading-relaxed text-ink">{diag.summary}</p>
                </Card>
                <Card className="divide-y divide-white/[0.05] p-2">
                  {diag.findings.map((f, i) => (
                    <div key={i} className="flex gap-3 px-3 py-3">
                      <Dot state={f.severity === 'alta' ? 'err' : f.severity === 'media' ? 'wave' : 'done'} className="mt-1.5" />
                      <div>
                        <div className="text-sm font-medium text-ink">{f.title}</div>
                        <div className="text-sm text-ink2">{f.detail}</div>
                      </div>
                    </div>
                  ))}
                </Card>
                <Card className="p-5">
                  <div className="label mb-3">Serviços recomendados</div>
                  <ol className="space-y-2">
                    {diag.recommended_services.map((s) => (
                      <li key={s.service} className="flex items-start gap-3 text-sm">
                        <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-xs text-black">{s.priority}</span>
                        <span>
                          <span className="font-medium text-ink">{s.service}</span> <span className="text-ink3">· {s.front}</span>
                          <span className="block text-ink2">{s.why}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                  {diag.recommended_plan && <div className="mt-4 text-sm text-ink2">Plano recomendado: <b className="text-ink">{diag.recommended_plan}</b></div>}
                </Card>
              </>
            )}
          </div>
          <div className="space-y-4">
            {diag && (
              <Card className="p-5">
                <div className="label mb-3">Mapa de dores</div>
                <PainBars pain={diag.pain_map} labels={PAIN_LABEL} />
              </Card>
            )}
            {diag && diag.pending_items.length > 0 && (
              <Card className="p-5">
                <div className="label mb-3">Pendências do cliente</div>
                <ul className="space-y-1.5 text-sm text-ink2">
                  {diag.pending_items.map((p) => (
                    <li key={p} className="flex gap-2">
                      <span className="text-accent">•</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === 'arquivos' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {assets.length === 0 ? (
              <EmptyState title="Nenhum arquivo" text="Arraste logos, fotos, vídeos e documentos ao lado." />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {assets.map((a) => (
                  <a key={a.id} href={a.url || '#'} target="_blank" rel="noreferrer" className="card press flex items-center gap-3 p-3 hover:border-white/15">
                    {a.mime?.startsWith('image') && a.url ? <img src={a.url} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <span className="grid h-12 w-12 place-items-center rounded-lg bg-white/[0.05] text-ink2"><FileKindIcon mime={a.mime} /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{a.name}</span>
                      <span className="block text-xs text-ink3">{a.kind} · {a.size_bytes ? `${Math.round(a.size_bytes / 1024)} KB` : a.source} · {fmtDate(a.created_at)}</span>
                    </span>
                    <ExternalLink className="h-4 w-4 text-ink3" />
                  </a>
                ))}
              </div>
            )}
          </div>
          <Card className="p-5">
            <div className="label mb-2">Enviar</div>
            <Dropzone clientId={id} />
          </Card>
        </div>
      )}

      {tab === 'financeiro' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-2 lg:col-span-2">
            {invoices.length === 0 && <p className="px-3 py-6 text-sm text-ink2">Sem faturas.</p>}
            {invoices.map((i) => (
              <ListRow key={i.id} left={<Dot state={i.status === 'paga' ? 'done' : i.status === 'atrasada' ? 'err' : 'wave'} />} title={i.description} meta={`Vence ${fmtDate(i.due_on)} · ${i.method || ''}`} right={<span className="num text-sm text-ink">{brl(i.amount)}</span>} />
            ))}
          </Card>
          <Card className="p-5">
            <div className="label mb-3">Contratos</div>
            {contracts.map((c) => (
              <div key={c.id} className="mb-3 text-sm">
                <div className="text-ink">{c.title}</div>
                <div className="text-xs text-ink3">
                  {c.status} · {c.monthly ? `${brl(c.monthly)}/mês` : brl(c.value)} · até {fmtDate(c.ends_on)}
                </div>
              </div>
            ))}
            <Button href="/contratos" variant="subtle" size="sm">
              Ver contratos
            </Button>
          </Card>
        </div>
      )}

      {tab === 'historico' && (
        <Card className="p-2">
          {history.length === 0 && <p className="px-3 py-6 text-sm text-ink2">Sem histórico.</p>}
          {history.map((a) => (
            <ListRow key={a.id} left={<Dot state="idle" />} title={<span><span className="text-ink2">{a.actor_name}</span> {a.action}</span>} meta={relTime(a.created_at)} />
          ))}
        </Card>
      )}

      {tab === 'editar' && (
        <Card className="p-5">
          <ActionForm action={updateClientAction.bind(null, id)} success="Cliente atualizado" className="grid gap-4 md:grid-cols-2">
            <Field label="Nome do contato"><Input name="contact_name" defaultValue={client.contact_name} /></Field>
            <Field label="Empresa / marca"><Input name="company" defaultValue={client.company || ''} /></Field>
            <Field label="Segmento"><Input name="segment" defaultValue={client.segment || ''} /></Field>
            <Field label="Status">
              <Select name="status" defaultValue={client.status}>
                {Object.entries(CLIENT_STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field label="Saúde da conta">
              <Select name="health" defaultValue={client.health || 'verde'}>
                <option value="verde">Verde</option>
                <option value="amarelo">Amarelo</option>
                <option value="vermelho">Vermelho</option>
              </Select>
            </Field>
            <Field label="Cor da marca"><Input name="brand_color" defaultValue={client.brand_color || '#FF5B1F'} className="font-mono" /></Field>
            <Field label="Site"><Input name="website" defaultValue={client.website || ''} /></Field>
            <Field label="Instagram"><Input name="instagram" defaultValue={ig?.url || ''} /></Field>
            <Field label="WhatsApp"><Input name="whatsapp" defaultValue={client.whatsapp || ''} /></Field>
            <Field label="E-mail"><Input name="email" defaultValue={client.email || ''} /></Field>
            <Field label="E-mails de relatório"><Input name="report_emails" defaultValue={(client.report_emails || []).join(', ')} /></Field>
            <Field label="Conta de anúncios Meta"><Input name="meta_ad_account_id" defaultValue={client.meta_ad_account_id || ''} /></Field>
            <Field label="Quem é" className="md:col-span-2"><Textarea name="who_is" defaultValue={client.who_is || ''} /></Field>
            <div className="md:col-span-2"><SubmitButton>Salvar</SubmitButton></div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

function hexToRgb(hex?: string | null) {
  const h = (hex || '#FF5B1F').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  if (Number.isNaN(n)) return '255 91 31';
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function Quick({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="press inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-ink2 hover:text-ink">
      {icon}
      {label}
    </a>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink2">{k}</dt>
      <dd className="num text-base text-ink">{v}</dd>
    </div>
  );
}

function ProjectCard({ p, owner, wide }: { p: any; owner?: string; wide?: boolean }) {
  const late = p.due_on && p.status !== 'finalizado' && p.due_on < new Date().toISOString().slice(0, 10);
  return (
    <Link href={`/projects?p=${p.id}`} className={`card press p-4 hover:border-white/15 ${wide ? 'flex items-center gap-5' : ''}`}>
      <div className={wide ? 'flex-1' : ''}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <Badge>{KIND_LABEL[p.kind as keyof typeof KIND_LABEL]}</Badge>
          <span className="flex items-center gap-2">
            {late && <Badge tone="err">atrasado</Badge>}
            <span className="label">{STAGE_LABEL[p.method_stage as keyof typeof STAGE_LABEL]}</span>
          </span>
        </div>
        <div className="line-clamp-2 text-sm font-medium text-ink">{p.title}</div>
        <div className="mt-1 text-xs text-ink3">
          {owner ? `${owner.split(' ')[0]} · ` : ''}
          {p.due_on ? `entrega ${fmtDate(p.due_on)}` : 'sem prazo'} · {p.status.replace('_', ' ')}
        </div>
      </div>
      <div className={`mt-3 flex items-center gap-3 ${wide ? 'w-40' : ''}`}>
        <Progress value={p.progress} tone={p.status === 'finalizado' ? 'ok' : late ? 'err' : 'accent'} />
        <span className="num text-xs text-ink2">{p.progress}%</span>
      </div>
    </Link>
  );
}
