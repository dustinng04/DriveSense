import type { PoolClient } from "pg";
import { withUserTransaction } from "../db/withUserTransaction.js";

export type RuleType =
  | "folder_whitelist"
  | "folder_blacklist"
  | "filetype_whitelist"
  | "keyword_guard";

export interface FolderWhitelistRule {
  type: "folder_whitelist";
  path: string;
  platform: "google_drive" | "notion";
}

export interface FolderBlacklistRule {
  type: "folder_blacklist";
  path: string;
  platform: "google_drive" | "notion";
}

export interface FileTypeWhitelistRule {
  type: "filetype_whitelist";
  allowedTypes: string[];
}

export interface KeywordGuardRule {
  type: "keyword_guard";
  keywords: string[];
}

export type Rule =
  | FolderWhitelistRule
  | FolderBlacklistRule
  | FileTypeWhitelistRule
  | KeywordGuardRule;

export interface StoredRules {
  userId: string;
  rules: Rule[];
  updatedAt: string;
}

interface RulesRow {
  user_id: string;
  rules: Rule[];
  updated_at: string;
}

function rowToStored(row: RulesRow): StoredRules {
  return {
    userId: row.user_id,
    rules: row.rules || [],
    updatedAt: row.updated_at,
  };
}

async function selectRulesRow(
  client: PoolClient,
  userId: string,
): Promise<RulesRow | null> {
  const result = await client.query<RulesRow>(
    `select user_id, rules, updated_at
     from public.rules
     where user_id = $1
     limit 1`,
    [userId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}

async function getOrCreateRulesWithinClient(
  client: PoolClient,
  userId: string,
): Promise<StoredRules> {
  const existing = await selectRulesRow(client, userId);
  if (existing) {
    return rowToStored(existing);
  }

  const insertResult = await client.query<RulesRow>(
    `insert into public.rules (user_id, rules)
     values ($1, $2::jsonb)
     on conflict (user_id) do update
     set user_id = excluded.user_id
     returning user_id, rules, updated_at`,
    [userId, JSON.stringify([])],
  );
  return rowToStored(insertResult.rows[0]);
}

export async function getRules(userId: string): Promise<StoredRules | null> {
  return withUserTransaction(userId, async (client) => {
    const row = await selectRulesRow(client, userId);
    return row ? rowToStored(row) : null;
  });
}

export async function getOrCreateRules(userId: string): Promise<StoredRules> {
  return withUserTransaction(userId, async (client) => {
    return getOrCreateRulesWithinClient(client, userId);
  });
}

export async function addRule(userId: string, rule: Rule): Promise<StoredRules> {
  return withUserTransaction(userId, async (client) => {
    const stored = await getOrCreateRulesWithinClient(client, userId);
    const updatedRules = [...stored.rules, rule];

    const result = await client.query<RulesRow>(
      `update public.rules
       set rules = $2::jsonb
       where user_id = $1
       returning user_id, rules, updated_at`,
      [userId, JSON.stringify(updatedRules)],
    );

    if (result.rowCount === 0) {
      throw new Error("Failed to add rule");
    }
    return rowToStored(result.rows[0]);
  });
}

export async function removeRuleAt(
  userId: string,
  index: number,
): Promise<StoredRules> {
  return withUserTransaction(userId, async (client) => {
    const stored = await getOrCreateRulesWithinClient(client, userId);
    if (index < 0 || index >= stored.rules.length) {
      throw new Error("Rule index out of range");
    }

    const updatedRules = stored.rules.filter((_, i) => i !== index);

    const result = await client.query<RulesRow>(
      `update public.rules
       set rules = $2::jsonb
       where user_id = $1
       returning user_id, rules, updated_at`,
      [userId, JSON.stringify(updatedRules)],
    );

    if (result.rowCount === 0) {
      throw new Error("Failed to remove rule");
    }
    return rowToStored(result.rows[0]);
  });
}

export async function replaceAllRules(
  userId: string,
  rules: Rule[],
): Promise<StoredRules> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<RulesRow>(
      `insert into public.rules (user_id, rules)
       values ($1, $2::jsonb)
       on conflict (user_id) do update
       set rules = excluded.rules
       returning user_id, rules, updated_at`,
      [userId, JSON.stringify(rules)],
    );
    return rowToStored(result.rows[0]);
  });
}
