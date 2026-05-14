import type {
  DriveSenseRule,
  FileTypeWhitelistRule,
  FolderBlacklistRule,
  KeywordGuardRule,
  RuleEvaluationOptions,
  RuleEvaluationResult,
  RuleEvaluationTarget,
} from './types.js';

function normalizePath(path: string): string {
  const collapsed = path.replace(/\/+/g, '/').trim();
  const withLeadingSlash = collapsed.startsWith('/') ? collapsed : `/${collapsed}`;

  if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')) {
    return withLeadingSlash.slice(0, -1);
  }

  return withLeadingSlash;
}

function isInsideFolder(targetPath: string | undefined, rulePath: string): boolean {
  if (!targetPath) {
    return false;
  }

  const normalizedTargetPath = normalizePath(targetPath);
  const normalizedRulePath = normalizePath(rulePath);

  return (
    normalizedTargetPath === normalizedRulePath ||
    normalizedTargetPath.startsWith(`${normalizedRulePath}/`)
  );
}

function appliesToPlatform(rule: DriveSenseRule, target: RuleEvaluationTarget): boolean {
  if (target.platform === 'unknown') {
    return false;
  }

  return rule.platform === undefined || rule.platform === target.platform;
}

function extractFileType(target: RuleEvaluationTarget): string | undefined {
  if (target.fileType) {
    return target.fileType.toLowerCase();
  }

  if (target.mimeType) {
    const mimeParts = target.mimeType.toLowerCase().split('/');
    return mimeParts[mimeParts.length - 1];
  }

  const extension = target.name?.split('.').pop();
  return extension && extension !== target.name ? extension.toLowerCase() : undefined;
}

function skip(
  checkedAt: string,
  matchedRule: DriveSenseRule | undefined,
  skipCode: RuleEvaluationResult['skipCode'],
  reason: string,
): RuleEvaluationResult {
  return {
    decision: 'skip',
    checkedAt,
    matchedRule,
    skipCode,
    reason,
  };
}

function findBlacklists(rules: DriveSenseRule[], target: RuleEvaluationTarget): FolderBlacklistRule[] {
  return rules.filter(
    (rule): rule is FolderBlacklistRule =>
      rule.type === 'folder_blacklist' && appliesToPlatform(rule, target),
  );
}

function findFileTypeWhitelists(
  rules: DriveSenseRule[],
  target: RuleEvaluationTarget,
): FileTypeWhitelistRule[] {
  return rules.filter(
    (rule): rule is FileTypeWhitelistRule =>
      rule.type === 'filetype_whitelist' && appliesToPlatform(rule, target),
  );
}

function findKeywordGuards(rules: DriveSenseRule[], target: RuleEvaluationTarget): KeywordGuardRule[] {
  return rules.filter(
    (rule): rule is KeywordGuardRule =>
      rule.type === 'keyword_guard' && appliesToPlatform(rule, target),
  );
}

/**
 * Declarative rule evaluation shared by extension and Node API callers.
 * Evaluation order intentionally mirrors RULES.md.
 */
export function evaluateRules(
  rules: DriveSenseRule[],
  target: RuleEvaluationTarget,
  options: RuleEvaluationOptions = {},
): RuleEvaluationResult {
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();

  const matchingBlacklist = findBlacklists(rules, target).find((rule) =>
    isInsideFolder(target.path, rule.path),
  );

  if (matchingBlacklist) {
    return skip(
      checkedAt,
      matchingBlacklist,
      'folder_blacklisted',
      `Path "${target.path ?? ''}" is inside blacklisted folder "${matchingBlacklist.path}".`,
    );
  }

  const targetFileType = extractFileType(target);
  const fileTypeWhitelistRules = findFileTypeWhitelists(rules, target);
  const matchingFileTypeWhitelist = fileTypeWhitelistRules.find((rule) =>
    targetFileType
      ? rule.allowedTypes.some((fileType) => fileType.toLowerCase() === targetFileType)
      : false,
  );

  if (!matchingFileTypeWhitelist) {
    return skip(
      checkedAt,
      fileTypeWhitelistRules[0],
      'filetype_not_allowed',
      targetFileType
        ? `File type "${targetFileType}" is not explicitly allowed.`
        : 'No file type was available to prove this resource is allowed.',
    );
  }

  const targetName = target.name?.toLowerCase() ?? '';
  for (const rule of findKeywordGuards(rules, target)) {
    const matchedKeyword = rule.keywords.find((keyword) =>
      targetName.includes(keyword.toLowerCase()),
    );

    if (matchedKeyword) {
      return skip(
        checkedAt,
        rule,
        'keyword_guard',
        `Title contains blocked keyword "${matchedKeyword}".`,
      );
    }
  }

  return {
    decision: 'allow',
    checkedAt,
  };
}
