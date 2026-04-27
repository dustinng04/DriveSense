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

export type FileRelationship = 'exact' | 'near-duplicate' | 'subset' | 'unrelated';

export interface RelationshipMetrics {
  jaccardScore: number;
  leftContainment: number;
  rightContainment: number;
  maxContainment: number;
}

export interface SubsetPair {
  parent: NearDuplicateCandidate;
  child: NearDuplicateCandidate;
  metrics: RelationshipMetrics;
}

export interface RelationshipClassification {
  left: NearDuplicateCandidate;
  right: NearDuplicateCandidate;
  relationship: FileRelationship;
  metrics: RelationshipMetrics;
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
const DEFAULT_CONTAINMENT_THRESHOLD = 0.7;
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

function containmentScore(smaller: Set<string>, larger: Set<string>): number {
  if (smaller.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of smaller) {
    if (larger.has(token)) {
      intersection += 1;
    }
  }

  return intersection / smaller.size;
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

/**
 * Subset/containment detection by one-sided token similarity.
 * Identifies when one file is substantially contained within another (e.g., summary vs full doc).
 */
export function detectSubsets(
  files: NearDuplicateCandidate[],
  threshold = DEFAULT_CONTAINMENT_THRESHOLD,
): SubsetPair[] {
  const pairs: SubsetPair[] = [];
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

      const jaccardScore = jaccardSimilarity(leftTokens, rightTokens);
      const contLR = containmentScore(leftTokens, rightTokens);
      const contRL = containmentScore(rightTokens, leftTokens);
      const maxContainment = Math.max(contLR, contRL);

      if (maxContainment >= threshold) {
        const isLeftChild = contLR > contRL;
        pairs.push({
          parent: isLeftChild ? right : left,
          child: isLeftChild ? left : right,
          metrics: {
            jaccardScore,
            leftContainment: contLR,
            rightContainment: contRL,
            maxContainment,
          },
        });
      }
    }
  }

  return pairs;
}

/**
 * Relationship classifier — deterministically maps similarity metrics to relationship types.
 * Uses exact hash match, Jaccard similarity, and containment scores to classify.
 */
export function classifyRelationship(
  left: NearDuplicateCandidate,
  right: NearDuplicateCandidate,
  isExactMatch: boolean,
  similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
  containmentThreshold = DEFAULT_CONTAINMENT_THRESHOLD,
): RelationshipClassification {
  const leftTokens = tokenize(left.textContent);
  const rightTokens = tokenize(right.textContent);

  const jaccardScore = jaccardSimilarity(leftTokens, rightTokens);
  const contLR = containmentScore(leftTokens, rightTokens);
  const contRL = containmentScore(rightTokens, leftTokens);
  const maxContainment = Math.max(contLR, contRL);

  const metrics: RelationshipMetrics = {
    jaccardScore,
    leftContainment: contLR,
    rightContainment: contRL,
    maxContainment,
  };

  let relationship: FileRelationship;

  if (isExactMatch) {
    relationship = 'exact';
  } else if (jaccardScore >= similarityThreshold) {
    relationship = 'near-duplicate';
  } else if (maxContainment >= containmentThreshold) {
    relationship = 'subset';
  } else {
    relationship = 'unrelated';
  }

  return {
    left,
    right,
    relationship,
    metrics,
  };
}

/**
 * Cross-folder metadata-only duplicate detection.
 * Uses exact name match + mime type + size proximity to identify likely duplicates
 * without requiring file content.
 *
 * Scoring:
 *  - mimeType match is required; different types → skip
 *  - nameSimilarity = Jaccard on tokenized names
 *  - sizeSimilarity = 1 - |a - b| / max(a, b) for ±15% proximity (or 0.5 if either missing)
 *  - combined score = 0.6 * name + 0.4 * size
 */

export interface IndexedFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  modifiedAt: string;
  createdAt?: string;
  sizeBytes?: number;
  platform: 'google_drive' | 'notion';
  parentFolderIds: string[];
}

export interface MetadataDuplicatePair {
  candidate: IndexedFileMetadata;
  match: IndexedFileMetadata;
  score: number;
  nameSimilarity: number;
  sizeSimilarity: number;
}

function sizeSimilarity(sizeA?: number, sizeB?: number): number {
  if (sizeA === undefined || sizeB === undefined) {
    return 0.5; // neutral if either size is missing
  }
  if (sizeA === 0 && sizeB === 0) {
    return 1; // both empty files
  }
  const maxSize = Math.max(sizeA, sizeB);
  const diff = Math.abs(sizeA - sizeB);
  return 1 - diff / maxSize;
}

function hasCommonParent(a: IndexedFileMetadata, b: IndexedFileMetadata): boolean {
  const setA = new Set(a.parentFolderIds);
  return b.parentFolderIds.some((id) => setA.has(id));
}

export function detectMetadataDuplicates(
  candidates: IndexedFileMetadata[],
  universe: IndexedFileMetadata[],
  options: { nameThreshold?: number; sizeTolerancePct?: number } = {},
): MetadataDuplicatePair[] {
  const nameThreshold = options.nameThreshold ?? 0.75;
  const pairs: MetadataDuplicatePair[] = [];
  const tokenCache = new Map<string, Set<string>>();

  // Tokenize all names once
  for (const file of [...candidates, ...universe]) {
    if (!tokenCache.has(file.id)) {
      tokenCache.set(file.id, tokenize(file.name));
    }
  }

  // Compare each candidate against the rest of the universe
  for (const candidate of candidates) {
    for (const universeFile of universe) {
      // Skip if same file
      if (candidate.id === universeFile.id) continue;

      // Skip if they share a common parent folder (same folder already handled elsewhere)
      if (hasCommonParent(candidate, universeFile)) continue;

      // Skip if mime types differ
      if (candidate.mimeType !== universeFile.mimeType) continue;

      // Compute name similarity
      const candTokens = tokenCache.get(candidate.id) ?? new Set<string>();
      const univTokens = tokenCache.get(universeFile.id) ?? new Set<string>();
      const nameScore = jaccardSimilarity(candTokens, univTokens);

      // Compute size similarity
      const sizeScore = sizeSimilarity(candidate.sizeBytes, universeFile.sizeBytes);

      // Combine scores
      const combinedScore = 0.6 * nameScore + 0.4 * sizeScore;

      // Emit pair if above threshold
      if (combinedScore >= nameThreshold) {
        pairs.push({
          candidate,
          match: universeFile,
          score: combinedScore,
          nameSimilarity: nameScore,
          sizeSimilarity: sizeScore,
        });
      }
    }
  }

  return pairs;
}
