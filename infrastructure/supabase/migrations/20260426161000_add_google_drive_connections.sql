create table if not exists public.google_drive_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  token_scope text,
  token_type text,
  expiry_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_google_drive_connections_updated_at on public.google_drive_connections;
create trigger set_google_drive_connections_updated_at
before update on public.google_drive_connections
for each row
execute function public.set_updated_at();

alter table public.google_drive_connections enable row level security;

drop policy if exists "Users can read own google drive connections" on public.google_drive_connections;
create policy "Users can read own google drive connections"
on public.google_drive_connections for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own google drive connections" on public.google_drive_connections;
create policy "Users can insert own google drive connections"
on public.google_drive_connections for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own google drive connections" on public.google_drive_connections;
create policy "Users can update own google drive connections"
on public.google_drive_connections for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own google drive connections" on public.google_drive_connections;
create policy "Users can delete own google drive connections"
on public.google_drive_connections for delete
to authenticated
using (auth.uid() = user_id);
