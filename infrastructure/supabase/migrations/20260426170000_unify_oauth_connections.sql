create table if not exists public.oauth_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google_drive', 'notion')),
  access_token text not null,
  refresh_token text,
  token_scope text,
  token_type text,
  expiry_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

drop trigger if exists set_oauth_connections_updated_at on public.oauth_connections;
create trigger set_oauth_connections_updated_at
before update on public.oauth_connections
for each row
execute function public.set_updated_at();

alter table public.oauth_connections enable row level security;

drop policy if exists "Users can read own oauth connections" on public.oauth_connections;
create policy "Users can read own oauth connections"
on public.oauth_connections for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own oauth connections" on public.oauth_connections;
create policy "Users can insert own oauth connections"
on public.oauth_connections for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own oauth connections" on public.oauth_connections;
create policy "Users can update own oauth connections"
on public.oauth_connections for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own oauth connections" on public.oauth_connections;
create policy "Users can delete own oauth connections"
on public.oauth_connections for delete
to authenticated
using (auth.uid() = user_id);

insert into public.oauth_connections (
  user_id,
  provider,
  access_token,
  refresh_token,
  token_scope,
  token_type,
  expiry_date,
  created_at,
  updated_at
)
select
  user_id,
  'google_drive',
  access_token,
  refresh_token,
  token_scope,
  token_type,
  expiry_date,
  created_at,
  updated_at
from public.google_drive_connections
on conflict (user_id, provider) do update
set
  access_token = excluded.access_token,
  refresh_token = excluded.refresh_token,
  token_scope = excluded.token_scope,
  token_type = excluded.token_type,
  expiry_date = excluded.expiry_date,
  updated_at = excluded.updated_at;

insert into public.oauth_connections (
  user_id,
  provider,
  access_token,
  refresh_token,
  token_scope,
  token_type,
  expiry_date,
  created_at,
  updated_at
)
select
  user_id,
  'notion',
  access_token,
  refresh_token,
  token_scope,
  token_type,
  expiry_date,
  created_at,
  updated_at
from public.notion_connections
on conflict (user_id, provider) do update
set
  access_token = excluded.access_token,
  refresh_token = excluded.refresh_token,
  token_scope = excluded.token_scope,
  token_type = excluded.token_type,
  expiry_date = excluded.expiry_date,
  updated_at = excluded.updated_at;

drop table if exists public.google_drive_connections cascade;
drop table if exists public.notion_connections cascade;
