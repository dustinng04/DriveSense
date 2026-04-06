import { config } from "../config.js";
import { withUserTransaction } from "../db/withUserTransaction.js";

interface FreeCallQuotaRow {
  user_id: string;
  used_calls: number;
  max_calls: number;
  created_at: string;
  updated_at: string;
}

export interface FreeCallQuota {
  userId: string;
  usedCalls: number;
  maxCalls: number;
  remainingCalls: number;
  createdAt: string;
  updatedAt: string;
}

function rowToQuota(row: FreeCallQuotaRow): FreeCallQuota {
  return {
    userId: row.user_id,
    usedCalls: row.used_calls,
    maxCalls: row.max_calls,
    remainingCalls: Math.max(0, row.max_calls - row.used_calls),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getOrCreateQuotaRow(userId: string): Promise<FreeCallQuotaRow> {
  return withUserTransaction(userId, async (client) => {
    await client.query(
      `insert into public.free_call_quotas (user_id, max_calls)
       values ($1, $2)
       on conflict (user_id) do nothing`,
      [userId, config.freeCallTrialLimit],
    );

    const result = await client.query<FreeCallQuotaRow>(
      `select user_id, used_calls, max_calls, created_at, updated_at
       from public.free_call_quotas
       where user_id = $1
       limit 1`,
      [userId],
    );

    if (result.rowCount === 0) {
      throw new Error("Failed to load free-call quota row.");
    }

    return result.rows[0];
  });
}

export async function getFreeCallQuota(userId: string): Promise<FreeCallQuota> {
  const row = await getOrCreateQuotaRow(userId);
  return rowToQuota(row);
}

export async function consumeFreeCall(userId: string): Promise<{
  allowed: boolean;
  quota: FreeCallQuota;
}> {
  return withUserTransaction(userId, async (client) => {
    await client.query(
      `insert into public.free_call_quotas (user_id, max_calls)
       values ($1, $2)
       on conflict (user_id) do nothing`,
      [userId, config.freeCallTrialLimit],
    );

    const current = await client.query<FreeCallQuotaRow>(
      `select user_id, used_calls, max_calls, created_at, updated_at
       from public.free_call_quotas
       where user_id = $1
       for update`,
      [userId],
    );

    if (current.rowCount === 0) {
      throw new Error("Failed to lock free-call quota row.");
    }

    const row = current.rows[0];
    if (row.used_calls >= row.max_calls) {
      return { allowed: false, quota: rowToQuota(row) };
    }

    const updated = await client.query<FreeCallQuotaRow>(
      `update public.free_call_quotas
       set used_calls = used_calls + 1
       where user_id = $1
       returning user_id, used_calls, max_calls, created_at, updated_at`,
      [userId],
    );

    return { allowed: true, quota: rowToQuota(updated.rows[0]) };
  });
}
