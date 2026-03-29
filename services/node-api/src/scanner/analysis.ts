import { createHash } from 'node:crypto';

export interface FileContentCandidate {
  id: string;
  name: string;
  rawBytes: Uint8Array;
  textContent?: string;
}

export interface ExactDuplicateGroup {
  hash: string;
  files: FileContentCandidate[];
  normalizedTextHash?: string;
}

export interface NearDuplicateCandidate {
  id: string;
  name: string;
  textContent: string;
}

export interface NearDuplicatePair {
  left: NearDuplicateCandidate;
  right: NearDuplicateCandidate;
  score: number;
}

export interface StalenessCandidate {
  id: string;
  name: string;
  modifiedAt: string;
  lastAccessedAt?: string;
}

export interface OptionalLlmStalenessReasoning {
  isStale: boolean | 'unsure';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  suggestedAction: 'archive' | 'review' | 'keep';
}

export interface StalenessAssessment {
  fileId: string;
  isStale: boolean;
  staleByModifiedDays: boolean;
  staleByAccessDays: boolean;
  modifiedDaysAgo: number;
  lastAccessedDaysAgo: number | null;
  reason: string;
  llmReasoning?: OptionalLlmStalenessReasoning;
}

export interface StalenessOptions {
  now?: Date;
  staleAfterDays?: number;
  notAccessedAfterDays?: number;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.9;
const DEFAULT_STALE_AFTER_DAYS = 90;
const DEFAULT_NOT_ACCESSED_AFTER_DAYS = 180;

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): Set<string> {
  const normalized = normalizeText(text);

  if (!normalized) {
    return new Set<string>();
  }

  return new Set(normalized.split(' '));
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }

  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function daysBetween(olderIsoDate: string, newerDate: Date): number {
  const olderDate = new Date(olderIsoDate);
  const diffMs = newerDate.getTime() - olderDate.getTime();

  if (Number.isNaN(diffMs)) {
    return 0;
  }

  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Exact duplicate detection by raw-byte SHA-256 hash.
 * A normalized-text hash is also attached when all files in the group expose text.
 */
export function detectExactDuplicates(files: FileContentCandidate[]): ExactDuplicateGroup[] {
  const groups = new Map<string, FileContentCandidate[]>();

  for (const file of files) {
    const hash = hashBytes(file.rawBytes);
    const existing = groups.get(hash);

    if (existing) {
      existing.push(file);
      continue;
    }

    groups.set(hash, [file]);
  }

  const duplicates: ExactDuplicateGroup[] = [];

  for (const [hash, matchingFiles] of groups.entries()) {
    if (matchingFiles.length < 2) {
      continue;
    }

    const allHaveText = matchingFiles.every((file) => typeof file.textContent === 'string');
    const normalizedTextHash = allHaveText
      ? hashBytes(new TextEncoder().encode(normalizeText(matchingFiles[0].textContent ?? '')))
      : undefined;

    duplicates.push({
      hash,
      files: matchingFiles,
      normalizedTextHash,
    });
  }

  return duplicates;
}

/**
 * Near-duplicate detection by token Jaccard similarity.
 */
export function detectNearDuplicates(
  files: NearDuplicateCandidate[],
  threshold = DEFAULT_SIMILARITY_THRESHOLD,
): NearDuplicatePair[] {
  const pairs: NearDuplicatePair[] = [];
  const tokenCache = new Map<string, Set<string>>();

  for (const file of files) {
    tokenCache.set(file.id, tokenize(file.textContent));
  }

  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const left = files[i];
      const right = files[j];
      const leftTokens = tokenCache.get(left.id) ?? new Set<string>();
      const rightTokens = tokenCache.get(right.id) ?? new Set<string>();
      const score = jaccardSimilarity(leftTokens, rightTokens);

      if (score >= threshold) {
        pairs.push({ left, right, score });
      }
    }
  }

  return pairs;
}

/**
 * Rule-first staleness detector.
 * Deterministic rule outcome is the source of truth.
 * Optional LLM reasoning can be attached for extra explanation.
 */
export function detectStaleness(
  file: StalenessCandidate,
  options: StalenessOptions = {},
  llmReasoning?: OptionalLlmStalenessReasoning,
): StalenessAssessment {
  const now = options.now ?? new Date();
  const staleAfterDays = options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
  const notAccessedAfterDays = options.notAccessedAfterDays ?? DEFAULT_NOT_ACCESSED_AFTER_DAYS;

  const modifiedDaysAgo = daysBetween(file.modifiedAt, now);
  const lastAccessedDaysAgo = file.lastAccessedAt ? daysBetween(file.lastAccessedAt, now) : null;

  const staleByModifiedDays = modifiedDaysAgo > staleAfterDays;
  const staleByAccessDays = lastAccessedDaysAgo !== null && lastAccessedDaysAgo > notAccessedAfterDays;
  const isStale = staleByModifiedDays || staleByAccessDays;

  const ruleReason = isStale
    ? `Rule-based detector flagged stale (modified ${modifiedDaysAgo} days ago, last accessed ${
        lastAccessedDaysAgo ?? 'unknown'
      } days ago).`
    : `Rule-based detector kept file active (modified ${modifiedDaysAgo} days ago, last accessed ${
        lastAccessedDaysAgo ?? 'unknown'
      } days ago).`;

  const reason = llmReasoning ? `${ruleReason} LLM note: ${llmReasoning.reason}` : ruleReason;

  return {
    fileId: file.id,
    isStale,
    staleByModifiedDays,
    staleByAccessDays,
    modifiedDaysAgo,
    lastAccessedDaysAgo,
    reason,
    llmReasoning,
  };
}
