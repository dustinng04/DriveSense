-- Add execution and undo tracking columns to undo_history
-- Supports multi-step actions (merge), expiry windows, and detailed status tracking

alter table public.undo_history
  add column if not exists action_group_id uuid,
  add column if not exists action_group_step smallint,
  add column if not exists undo_status text not null default 'available'
    check (undo_status in ('available', 'expired', 'failed', 'done')),
  add column if not exists undo_error text,
  add column if not exists expires_at timestamptz;

-- Drop undone_at: superseded by undo_status = 'done'. Single source of truth.
alter table public.undo_history
  drop column if exists undone_at;

-- Indexes for grouped and expiring entries
create index if not exists undo_history_group_idx
  on public.undo_history (action_group_id)
  where action_group_id is not null;

create index if not exists undo_history_expires_idx
  on public.undo_history (expires_at)
  where expires_at is not null and undo_status = 'available';

-- Add account_id to undo_history for cross-platform accountability
alter table public.undo_history
  add column if not exists account_id text;

create index if not exists undo_history_account_idx
  on public.undo_history (user_id, account_id, executed_at desc);
