create table if not exists public.notion_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  token_scope text,
  token_type text,
  expiry_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_notion_connections_updated_at on public.notion_connections;
create trigger set_notion_connections_updated_at
before update on public.notion_connections
for each row
execute function public.set_updated_at();

alter table public.notion_connections enable row level security;

drop policy if exists "Users can read own notion connections" on public.notion_connections;
create policy "Users can read own notion connections"
on public.notion_connections for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own notion connections" on public.notion_connections;
create policy "Users can insert own notion connections"
on public.notion_connections for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own notion connections" on public.notion_connections;
create policy "Users can update own notion connections"
on public.notion_connections for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own notion connections" on public.notion_connections;
create policy "Users can delete own notion connections"
on public.notion_connections for delete
to authenticated
using (auth.uid() = user_id);
