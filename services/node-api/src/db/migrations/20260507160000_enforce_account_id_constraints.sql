-- Migration: Enforce account_id constraints and add identity uniqueness
-- 1. Add NOT NULL constraint to suggestions.account_id (now required for all suggestions)
-- 2. Add unique index on oauth_connections(provider, account_id) for global identity resolution

-- 1. Make account_id NOT NULL on suggestions table
-- Note: This assumes no existing data; if data exists, must backfill first
alter table public.suggestions
alter column account_id set not null;

-- 2. Create unique index on oauth_connections for deterministic identity lookup
-- This ensures that (provider, account_id) pairs are globally unique,
-- allowing safe lookup of userId via findUserIdByPlatformAccount()
create unique index if not exists oauth_connections_provider_account_id_key
on public.oauth_connections (provider, account_id);
