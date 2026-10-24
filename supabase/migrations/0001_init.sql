-- IMPACTO HEADSOFTWARE · esquema inicial (Supabase / Postgres)
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  full_name text not null,
  role text not null default 'comercial',
  title text,
  avatar_url text,
  status text default 'disponivel',
  preferences jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  contact_name text not null,
  company text, segment text, city text, state text, who_is text,
  logo_url text, brand_color text, owner_id uuid,
  status text not null default 'lead', health text default 'amarelo',
  website text, whatsapp text, email text,
  report_emails text[] default '{}', socials jsonb default '[]'::jsonb,
  name_use_authorized boolean default false, case_authorized boolean default false,
  maturity_index int, meta_ad_account_id text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.client_contexts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete cascade,
  version int not null default 1, blocks jsonb default '{}'::jsonb, ai_summary text, created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.questionnaire_responses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete cascade,
  answers jsonb default '{}'::jsonb, answered_by text, public_token text unique, completed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.diagnoses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete cascade,
  summary text, pain_map jsonb default '{}'::jsonb, findings jsonb default '[]'::jsonb,
  recommended_services jsonb default '[]'::jsonb, recommended_plan text, pending_items jsonb default '[]'::jsonb,
  is_example boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete set null, project_id uuid,
  kind text not null default 'arquivo', name text not null, path text, url text, mime text, size_bytes bigint,
  tags text[] default '{}', analysis jsonb, source text, created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.brand_kits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete cascade,
  mode text default 'zero', version int default 1, step int default 1,
  diagnosis jsonb, strategy jsonb, verbal jsonb, visual jsonb, tokens jsonb, applications jsonb,
  locked_fields text[] default '{}', status text default 'rascunho', approved_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete cascade,
  kind text default 'outro', title text not null, method_stage text default 'ponto', status text default 'ativo',
  progress int default 0, starts_on date, due_on date, owner_id uuid, brief jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects on delete cascade, client_id uuid,
  title text not null, description text, assignee_id uuid, status text default 'a_fazer', priority int default 2, due_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.content_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete cascade, project_id uuid,
  month text, goal text, mix jsonb, series jsonb, status text default 'rascunho',
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.content_plans on delete cascade,
  client_id uuid references public.clients on delete cascade,
  format text default 'post_4x5', series text, hook text, art jsonb, caption text, alt_text text, hashtags text[] default '{}',
  scheduled_at timestamptz, status text default 'rascunho', version int default 1,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.video_projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete cascade, project_id uuid,
  line text default 'reels', title text not null, direction jsonb, script jsonb, shot_list jsonb, source_asset_ids text[] default '{}',
  status text default 'rascunho', target_duration_s int, aspect text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete cascade, project_id uuid,
  name text not null, objective text, funnel text, offer jsonb, geo jsonb, budget jsonb, starts_on date, ends_on date,
  kit_zero jsonb, kits jsonb, structure jsonb, creative_ids text[] default '{}', meta_campaign_id text, status text default 'rascunho',
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.campaign_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns on delete cascade,
  day date not null, spend numeric default 0, impressions int default 0, reach int default 0, clicks int default 0,
  results int default 0, cost_per_result numeric, hook_rate numeric,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.report_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete cascade, campaign_id uuid,
  audience text default 'cliente', emails text[] default '{}', frequency text default 'semanal', send_hour int default 9, active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid, campaign_id uuid, subscription_id uuid, period_start date, period_end date, html text, sent_to text[] default '{}', sent_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete set null,
  title text not null, stage text default 'lead', value numeric, probability int, source text, lost_reason text, owner_id uuid, next_action_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  number text unique not null, deal_id uuid, client_id uuid references public.clients on delete set null,
  data jsonb default '{}'::jsonb, total numeric default 0, monthly numeric default 0, valid_until date, status text default 'rascunho',
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete set null, quote_id uuid,
  title text not null, kind text default 'projeto', body text, status text default 'rascunho', signed_at timestamptz,
  starts_on date, ends_on date, value numeric, monthly numeric,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete set null, contract_id uuid,
  description text not null, amount numeric not null, due_on date not null, method text, status text default 'aberta', paid_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null, supplier text, amount numeric not null, due_on date, paid_at timestamptz, client_id uuid, project_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null, runner text default 'cloud', client_id uuid, project_id uuid, input jsonb, output jsonb,
  status text default 'fila', progress int default 0, log text, cost_brl numeric, started_at timestamptz, finished_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid, client_id uuid, agent text not null, model text not null,
  input_tokens int default 0, output_tokens int default 0, cost_usd numeric default 0, status text default 'ok',
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, kind text, title text not null, link text, read_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid, actor_name text, action text not null, entity text, entity_id uuid, meta jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.approval_batches (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete cascade,
  title text not null, item_type text default 'content', item_ids text[] default '{}', public_token text unique not null,
  status text default 'aberto', expires_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.approval_batches on delete cascade,
  item_id uuid, decision text, comment text, decided_by text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  provider text not null, scope text default 'studio', client_id uuid, config jsonb, status text default 'pendente', connected_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete cascade, name text not null, instagram text, website text, notes text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.research_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid, kind text not null, title text not null, findings jsonb default '{}'::jsonb, sources jsonb default '[]'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete cascade, project_id uuid,
  name text not null, template text, repo text, domain text, url text, status text default 'briefing',
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null, kind text default 'outro', starts_at timestamptz not null, ends_at timestamptz, client_id uuid, project_id uuid, notes text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.services_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null, front text, kind text default 'projeto', base_price numeric default 0, recurring boolean default false, description text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  name text not null, trigger text, action text, active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

-- Índices úteis
create index if not exists idx_projects_client on public.projects(client_id);
create index if not exists idx_tasks_assignee on public.tasks(assignee_id);
create index if not exists idx_content_items_client on public.content_items(client_id);
create index if not exists idx_metrics_campaign_day on public.campaign_metrics_daily(campaign_id, day);
create index if not exists idx_invoices_client on public.invoices(client_id);
create index if not exists idx_activity_created on public.activity_log(created_at desc);
create index if not exists idx_notifications_user on public.notifications(user_id, read_at);

-- Perfil automático ao criar usuário no Auth
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, full_name, role, title)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', upper(split_part(new.email, '@', 1))),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'comercial'),
    new.raw_user_meta_data->>'title'
  )
  on conflict (id) do nothing;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
  end if;
end $$;

-- RLS: time autenticado acessa tudo (equipe interna de 4 pessoas); o portal público usa funções dedicadas.
do $$
declare t text;
begin
  for t in select unnest(array['profiles','clients','client_contexts','questionnaire_responses','diagnoses','assets','brand_kits','projects','tasks',
    'content_plans','content_items','video_projects','campaigns','campaign_metrics_daily','report_subscriptions','reports','deals','quotes','contracts',
    'invoices','expenses','jobs','agent_runs','notifications','activity_log','approval_batches','approvals','integrations','competitors','research_reports',
    'sites','events','services_catalog','workflows'])
  loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'team_all') then
      execute format('create policy team_all on public.%I for all to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;

-- Portal de aprovação (anônimo) lê o lote pelo token e grava decisões
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='approval_batches' and policyname='portal_read_batches') then
    execute $p$ create policy portal_read_batches on public.approval_batches for select to anon using (true) $p$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='content_items' and policyname='portal_read_items') then
    execute $p$ create policy portal_read_items on public.content_items for select to anon using (status in ('em_aprovacao','aprovado','ajustar')) $p$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='content_items' and policyname='portal_update_items') then
    execute $p$ create policy portal_update_items on public.content_items for update to anon using (status in ('em_aprovacao','aprovado','ajustar')) with check (status in ('aprovado','ajustar','em_aprovacao')) $p$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='clients' and policyname='portal_read_clients') then
    execute $p$ create policy portal_read_clients on public.clients for select to anon using (true) $p$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='approvals' and policyname='portal_write_approvals') then
    execute $p$ create policy portal_write_approvals on public.approvals for insert to anon with check (true) $p$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='approval_batches' and policyname='portal_update_batches') then
    execute $p$ create policy portal_update_batches on public.approval_batches for update to anon using (true) with check (true) $p$;
  end if;
end $$;
