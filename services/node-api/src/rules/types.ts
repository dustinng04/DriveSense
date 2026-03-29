import type { Platform } from '../context/types.js';

export type RuleType =
  | 'folder_whitelist'
  | 'folder_blacklist'
  | 'filetype_whitelist'
  | 'keyword_guard';

export interface BaseRule {
  type: RuleType;
  platform?: Exclude<Platform, 'unknown'>;
}

export interface FolderWhitelistRule extends BaseRule {
  type: 'folder_whitelist';
  path: string;
}

export interface FolderBlacklistRule extends BaseRule {
  type: 'folder_blacklist';
  path: string;
}

export interface FileTypeWhitelistRule extends BaseRule {
  type: 'filetype_whitelist';
  allowed_types: string[];
}

export interface KeywordGuardRule extends BaseRule {
  type: 'keyword_guard';
  keywords: string[];
}

export type DriveSenseRule =
  | FolderWhitelistRule
  | FolderBlacklistRule
  | FileTypeWhitelistRule
  | KeywordGuardRule;

export type RuleDecision = 'allow' | 'skip';

export type RuleSkipCode =
  | 'not_whitelisted'
  | 'folder_blacklisted'
  | 'filetype_not_allowed'
  | 'keyword_guard';

export interface RuleEvaluationTarget {
  platform: Platform;
  path?: string;
  name?: string;
  mimeType?: string;
  fileType?: string;
}

export interface RuleEvaluationOptions {
  now?: Date;
}

export interface RuleEvaluationResult {
  decision: RuleDecision;
  checkedAt: string;
  matchedRule?: DriveSenseRule;
  skipCode?: RuleSkipCode;
  reason?: string;
}
