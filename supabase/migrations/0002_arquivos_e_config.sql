-- IMPACTO HEADSOFTWARE · arquivos (Supabase Storage) e configuração compartilhada do time.
-- Já aplicada no projeto do time; fica aqui para recriar o ambiente. Pode rodar de novo sem efeito colateral.

-- 1) Bucket privado "files": uploads de clientes e do Studio e imagens geradas por IA.
--    O app entrega os arquivos por /api/files/<chave> (URL assinada de 1 hora).
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 4294967296)
on conflict (id) do nothing;

-- Qualquer usuário logado do time lê, envia, troca e apaga arquivos do bucket.
drop policy if exists team_files_all on storage.objects;
create policy team_files_all on storage.objects
  for all to authenticated
  using (bucket_id = 'files')
  with check (bucket_id = 'files');

-- 2) Configuração compartilhada (chaves de API, modelos de IA e dados do Studio salvos em Settings).
--    Uma linha só, id = 'main'. Todos os logados leem; só quem é admin grava.
create table if not exists public.app_config (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.app_config enable row level security;

drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config
  for select to authenticated
  using (true);

drop policy if exists app_config_admin_write on public.app_config;
create policy app_config_admin_write on public.app_config
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
