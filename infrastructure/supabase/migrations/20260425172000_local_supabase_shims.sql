-- Local development setup for PostgreSQL
-- Creates mock auth schema and utilities for testing RLS and foreign keys
-- This is only for local development; Supabase provides auth natively in production

create schema if not exists auth;

-- Create authenticated role if it doesn't exist (used in Supabase RLS policies)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end
$$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Mock function to get current user ID
-- In local dev, you can set this via: SET app.current_user_id = 'uuid-here';
-- In Supabase, this is provided by the auth system
create or replace function auth.uid()
returns uuid as $$
  select coalesce(
    nullif(current_setting('app.current_user_id', true), '')::uuid,
    (select id from auth.users order by created_at limit 1)
  );
$$ language sql stable;

-- Create a default local user for testing
do $$
declare
  local_user_id uuid;
begin
  if not exists (select 1 from auth.users where email = 'test@local.dev') then
    insert into auth.users (email, created_at, updated_at)
    values ('test@local.dev', now(), now())
    returning id into local_user_id;
    
    raise notice 'Created local test user: %', local_user_id;
  end if;
end
$$;
