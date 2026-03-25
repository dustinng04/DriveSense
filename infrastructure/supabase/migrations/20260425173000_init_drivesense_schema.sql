-- DriveSense initial schema for Supabase PostgreSQL
-- Covers: undo history, rules, settings, suggestions

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'suggestion_status') then
    create type public.suggestion_status as enum ('pending', 'confirmed', 'skipped', 'dismissed');
  end if;
end
$$;

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('google_drive', 'notion')),
  action text not null,
  status suggestion_status not null default 'pending',
  title text not null,
  description text not null,
  reason text,
  files jsonb not null default '[]'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  dismissed_forever boolean not null default false,
  confirmed_at timestamptz,
  skipped_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.undo_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  suggestion_id uuid references public.suggestions(id) on delete set null,
  action text not null,
  platform text not null check (platform in ('google_drive', 'notion')),
  action_details jsonb not null default '{}'::jsonb,
  undo_payload jsonb not null default '{}'::jsonb,
  executed_at timestamptz not null default now(),
  undone_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  llm_provider text not null default 'gemini',
  model text,
  preference jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists suggestions_user_status_created_idx
  on public.suggestions (user_id, status, created_at desc);
create index if not exists suggestions_user_action_created_idx
  on public.suggestions (user_id, action, created_at desc);
create index if not exists undo_history_user_executed_idx
  on public.undo_history (user_id, executed_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_suggestions_updated_at on public.suggestions;
create trigger set_suggestions_updated_at
before update on public.suggestions
for each row
execute function public.set_updated_at();

drop trigger if exists set_rules_updated_at on public.rules;
create trigger set_rules_updated_at
before update on public.rules
for each row
execute function public.set_updated_at();

drop trigger if exists set_settings_updated_at on public.settings;
create trigger set_settings_updated_at
before update on public.settings
for each row
execute function public.set_updated_at();

alter table public.suggestions enable row level security;
alter table public.undo_history enable row level security;
alter table public.rules enable row level security;
alter table public.settings enable row level security;

drop policy if exists "Users can read own suggestions" on public.suggestions;
create policy "Users can read own suggestions"
on public.suggestions for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own suggestions" on public.suggestions;
create policy "Users can insert own suggestions"
on public.suggestions for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own suggestions" on public.suggestions;
create policy "Users can update own suggestions"
on public.suggestions for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own suggestions" on public.suggestions;
create policy "Users can delete own suggestions"
on public.suggestions for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own undo history" on public.undo_history;
create policy "Users can read own undo history"
on public.undo_history for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own undo history" on public.undo_history;
create policy "Users can insert own undo history"
on public.undo_history for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own undo history" on public.undo_history;
create policy "Users can update own undo history"
on public.undo_history for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own undo history" on public.undo_history;
create policy "Users can delete own undo history"
on public.undo_history for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own rules" on public.rules;
create policy "Users can read own rules"
on public.rules for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own rules" on public.rules;
create policy "Users can insert own rules"
on public.rules for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own rules" on public.rules;
create policy "Users can update own rules"
on public.rules for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own rules" on public.rules;
create policy "Users can delete own rules"
on public.rules for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own settings" on public.settings;
create policy "Users can read own settings"
on public.settings for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own settings" on public.settings;
create policy "Users can insert own settings"
on public.settings for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own settings" on public.settings;
create policy "Users can update own settings"
on public.settings for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own settings" on public.settings;
create policy "Users can delete own settings"
on public.settings for delete
to authenticated
using (auth.uid() = user_id);

do $$
begin
  -- Only attempt to add to publication if the publication exists (Supabase environment)
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where schemaname = 'public'
        and tablename = 'suggestions'
        and pubname = 'supabase_realtime'
    ) then
      alter publication supabase_realtime add table public.suggestions;
    end if;
  end if;
end
$$;
