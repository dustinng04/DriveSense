create table if not exists public.free_call_quotas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  used_calls integer not null default 0 check (used_calls >= 0),
  max_calls integer not null check (max_calls between 5 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint free_call_quotas_used_not_greater_than_max check (used_calls <= max_calls)
);

drop trigger if exists set_free_call_quotas_updated_at on public.free_call_quotas;
create trigger set_free_call_quotas_updated_at
before update on public.free_call_quotas
for each row
execute function public.set_updated_at();

alter table public.free_call_quotas enable row level security;

drop policy if exists "Users can read own free call quotas" on public.free_call_quotas;
create policy "Users can read own free call quotas"
on public.free_call_quotas for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own free call quotas" on public.free_call_quotas;
create policy "Users can insert own free call quotas"
on public.free_call_quotas for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own free call quotas" on public.free_call_quotas;
create policy "Users can update own free call quotas"
on public.free_call_quotas for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own free call quotas" on public.free_call_quotas;
create policy "Users can delete own free call quotas"
on public.free_call_quotas for delete
to authenticated
using (auth.uid() = user_id);
