-- DriveSense extension-first settings hardening
-- BYOK API keys are stored locally by the browser extension, not in Supabase.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'llm_provider') then
    create type public.llm_provider as enum ('gemini', 'openai', 'anthropic', 'glm');
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'settings'
      and column_name = 'preference'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'settings'
      and column_name = 'preferences'
  ) then
    alter table public.settings rename column preference to preferences;
  end if;
end
$$;

alter table public.settings
  alter column llm_provider drop default,
  alter column llm_provider type public.llm_provider using llm_provider::public.llm_provider,
  alter column llm_provider set default 'gemini'::public.llm_provider,
  alter column llm_provider set not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'settings'
      and column_name = 'model'
  ) then
    alter table public.settings drop column model;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'settings'
      and column_name = 'llm_model'
  ) then
    alter table public.settings drop column llm_model;
  end if;
end
$$;

alter table public.settings
  alter column preferences set default '{}'::jsonb,
  alter column preferences set not null;

alter table public.settings
  add column if not exists timezone text not null default 'UTC',
  add column if not exists prompt_logging_enabled boolean not null default false,
  add column if not exists scan_schedule text not null default 'manual',
  add column if not exists stale_after_days integer not null default 90,
  add column if not exists not_accessed_after_days integer not null default 180,
  add column if not exists similarity_threshold numeric(4, 3) not null default 0.900,
  add column if not exists suggestion_notifications jsonb not null default '{"dashboard": true, "realtime": true}'::jsonb,
  add column if not exists auto_confirm_actions boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_scan_schedule_check') then
    alter table public.settings add constraint settings_scan_schedule_check check (scan_schedule in ('manual', 'daily', 'weekly'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'settings_stale_after_days_check') then
    alter table public.settings add constraint settings_stale_after_days_check check (stale_after_days between 1 and 3650);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'settings_not_accessed_after_days_check') then
    alter table public.settings add constraint settings_not_accessed_after_days_check check (not_accessed_after_days between 1 and 3650);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'settings_similarity_threshold_check') then
    alter table public.settings add constraint settings_similarity_threshold_check check (similarity_threshold >= 0.700 and similarity_threshold <= 1.000);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'settings_auto_confirm_disabled_check') then
    alter table public.settings add constraint settings_auto_confirm_disabled_check check (auto_confirm_actions = false);
  end if;
end
$$;
