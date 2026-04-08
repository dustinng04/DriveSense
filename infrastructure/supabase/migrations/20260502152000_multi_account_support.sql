-- Migration: Multi-Account Support for OAuth Connections
-- This migration updates the oauth_connections table to support multiple accounts
-- per provider for the same user by adding account identity columns to the primary key.

-- 1. Add new columns
alter table public.oauth_connections
add column if not exists account_id text,
add column if not exists account_email text,
add column if not exists is_primary boolean not null default false;

-- 2. Populate existing rows with a placeholder account_id if null
-- For existing rows, we'll use 'legacy_default' as the account_id
update public.oauth_connections
set account_id = 'legacy_default', account_email = 'unknown@account'
where account_id is null;

-- 3. Make account_id not null now that it's populated
alter table public.oauth_connections
alter column account_id set not null;

-- 4. Update the Primary Key
-- First, drop the old PK
alter table public.oauth_connections
drop constraint oauth_connections_pkey;

-- Add the new composite PK including account_id
alter table public.oauth_connections
add primary key (user_id, provider, account_id);

-- 5. Add an index on account_email for faster lookup during context matching
create index if not exists idx_oauth_connections_email on public.oauth_connections(account_email);

-- 6. Update comments for clarity
comment on column public.oauth_connections.account_id is 'The remote unique ID of the account (e.g. Google sub or Notion workspace ID)';
comment on column public.oauth_connections.account_email is 'The email associated with the remote account for context-aware matching in the extension';
