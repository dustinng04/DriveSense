-- Migration: Refine Multi-Account Schema
-- 1. Add account_id to suggestions to disambiguate in multi-account scenarios
-- 2. Add account_email to oauth_connections for UI display purposes

-- 1. Update suggestions table
alter table public.suggestions 
add column if not exists account_id text;

comment on column public.suggestions.account_id is 'The specific platform account ID this suggestion belongs to';

-- 2. Update oauth_connections table
alter table public.oauth_connections
add column if not exists account_email text;

comment on column public.oauth_connections.account_email is 'The email address associated with this specific account (for UI display)';
