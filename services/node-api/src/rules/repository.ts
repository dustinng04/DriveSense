import type { PoolClient } from "pg";
import { withUserTransaction } from "../db/withUserTransaction.js";

export type RuleType =
  | "folder_blacklist"
  | "filetype_whitelist"
  | "keyword_guard";

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
  | FolderBlacklistRule
  | FileTypeWhitelistRule
  | KeywordGuardRule;

interface LegacyFolderWhitelistRule {
  type: "folder_whitelist";
  path: string;
  platform: "google_drive" | "notion";
}

export interface StoredRules {
  userId: string;
  rules: Rule[];
  updatedAt: string;
}

interface RulesRow {
  user_id: string;
  rules: unknown[];
  updated_at: string;
}

function isPlatform(value: unknown): value is "google_drive" | "notion" {
  return value === "google_drive" || value === "notion";
}

function sanitizeRule(rule: unknown): Rule | null {
  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
    return null;
  }

  const input = rule as Record<string, unknown>;

  if (input.type === "folder_whitelist") {
    return null;
  }

  if (input.type === "folder_blacklist") {
    if (typeof input.path !== "string" || input.path.trim().length === 0 || !isPlatform(input.platform)) {
      return null;
    }

    return {
      type: "folder_blacklist",
      path: input.path,
      platform: input.platform,
    };
  }

  if (input.type === "filetype_whitelist") {
    const rawTypes = Array.isArray(input.allowedTypes)
      ? input.allowedTypes
      : Array.isArray(input.allowed_types)
        ? input.allowed_types
        : null;

    if (!rawTypes || !rawTypes.every((value) => typeof value === "string" && value.trim().length > 0)) {
      return null;
    }

    return {
      type: "filetype_whitelist",
      allowedTypes: rawTypes,
    };
  }

  if (input.type === "keyword_guard") {
    if (
      !Array.isArray(input.keywords) ||
      !input.keywords.every((value) => typeof value === "string" && value.trim().length > 0)
    ) {
      return null;
    }

    return {
      type: "keyword_guard",
      keywords: input.keywords,
    };
  }

  return null;
}

function rowToStored(row: RulesRow): StoredRules {
  return {
    userId: row.user_id,
    rules: Array.isArray(row.rules) ? row.rules.map(sanitizeRule).filter((rule): rule is Rule => rule !== null) : [],
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

const DEFAULT_RULES: Rule[] = [
  { type: "folder_blacklist", path: "/Team Drive/Marketing/Legal", platform: "google_drive" },
  { type: "folder_blacklist", path: "/Legal", platform: "google_drive" },
  { type: "folder_blacklist", path: "/HR", platform: "google_drive" },
];

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
    [userId, JSON.stringify(DEFAULT_RULES)],
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
