/**
 * Processes metadata duplicates and inserts suggestions into Supabase.
 * Runs asynchronously to avoid blocking the HTTP response.
 */

import { classifyRelationship, detectMetadataDuplicates, type IndexedFileMetadata, type MetadataDuplicatePair } from "./analysis.js";
import { checkRejectionHistory, storeSuggestion, type ReceiveSuggestionInput } from "../suggestions/repository.js";
import type { Platform } from "../context/types.js";
import { GoogleDriveContentAdapter } from "../google-drive/adapter.js";
import { NotionContentAdapter } from "../notion/adapter.js";
import type { PlatformContentAdapter } from "./types.js";

export interface CrossFolderScanTask {
  userId: string;
  platform: Platform;
  accountId: string;
  candidates: IndexedFileMetadata[];
  universe: IndexedFileMetadata[];
  llm?: {
    provider?: string;
    hasByokKey?: boolean;
  };
}

/**
 * Convert metadata duplicate pair to suggestion input.
 * Uses metadata scoring to determine confidence level.
 */
function confidenceFromScore(score: number): "high" | "medium" | "low" {
  if (score >= 0.9) return "high";
  if (score >= 0.75) return "medium";
  return "low";
}

function pairToSuggestionInput(
  pair: MetadataDuplicatePair,
  platform: "google_drive" | "notion",
  options?: {
    jaccardScore?: number;
    relationship?: "exact" | "near-duplicate" | "subset" | "unrelated";
    combinedScore?: number;
    contentA?: string;
    contentB?: string;
  },
): ReceiveSuggestionInput {
  const similarity = Math.round(pair.score * 100);
  const combined = typeof options?.combinedScore === "number" ? options.combinedScore : pair.score;
  const confidence = confidenceFromScore(combined);
  const relationship = options?.relationship;
  const jaccard = typeof options?.jaccardScore === "number" ? options.jaccardScore : null;

  // Use 'edit' action for subset relationships (one file contains the other)
  const isSubset = relationship === 'subset';
  const action = isSubset ? 'edit' : 'merge';

  // For subset: longer file is target, shorter is reference
  let targetFile = pair.candidate;
  let referenceFile = pair.match;
  let targetContent = options?.contentA ?? null;
  let referenceContent = options?.contentB ?? null;

  if (isSubset && pair.match.sizeBytes && pair.candidate.sizeBytes && pair.match.sizeBytes > pair.candidate.sizeBytes) {
    // Swap if match is larger
    targetFile = pair.match;
    referenceFile = pair.candidate;
    targetContent = options?.contentB ?? null;
    referenceContent = options?.contentA ?? null;
  }

  return {
    platform,
    action,
    status: "pending_enrichment",
    title: isSubset ? 'Remove duplicate content' : 'Possible duplicate in another folder',
    description: isSubset
      ? `"${targetFile.name}" contains duplicate content from "${referenceFile.name}". Consider removing redundant sections.`
      : `Found "${pair.match.name}" in a different folder with ${similarity}% metadata match${
          relationship ? ` (${relationship})` : ""
        }. Consider merging with "${pair.candidate.name}".`,
    confidence,
    fileIds: isSubset ? [targetFile.id] : [pair.candidate.id, pair.match.id],
    reason: [
      `Metadata match: name=${Math.round(pair.nameSimilarity * 100)}%, size=${Math.round(pair.sizeSimilarity * 100)}%`,
      jaccard !== null ? `Text similarity (Jaccard): ${Math.round(jaccard * 100)}%` : null,
    ]
      .filter(Boolean)
      .join(" • "),
    analysis: {
      metadata: {
        overallScore: pair.score,
        nameSimilarity: pair.nameSimilarity,
        sizeSimilarity: pair.sizeSimilarity,
      },
      content: jaccard !== null ? { jaccardScore: jaccard } : undefined,
      relationship: relationship ?? undefined,
      combinedScore: combined,
      files: isSubset
        ? {
            target: {
              id: targetFile.id,
              name: targetFile.name,
              mimeType: targetFile.mimeType,
            },
            reference: {
              id: referenceFile.id,
              name: referenceFile.name,
              mimeType: referenceFile.mimeType,
            },
          }
        : {
            candidate: {
              id: pair.candidate.id,
              name: pair.candidate.name,
              mimeType: pair.candidate.mimeType,
            },
            match: {
              id: pair.match.id,
              name: pair.match.name,
              mimeType: pair.match.mimeType,
            },
          },
      contentPreview: isSubset
        ? {
            target: targetContent,
            reference: referenceContent,
          }
        : {
            candidate: options?.contentA ?? null,
            match: options?.contentB ?? null,
          },
      enrichment: { kind: "byok_extension" },
    },
  };
}

function getContentAdapter(platform: Platform): PlatformContentAdapter | null {
  switch (platform) {
    case "google_drive":
      return new GoogleDriveContentAdapter();
    case "notion":
      return new NotionContentAdapter();
    default:
      return null;
  }
}

async function filterByRejectionHistory(
  userId: string,
  pairs: MetadataDuplicatePair[],
  action: string,
): Promise<MetadataDuplicatePair[]> {
  const results = await Promise.all(
    pairs.map(async (pair) => {
      const skip = await checkRejectionHistory(userId, [pair.candidate.id, pair.match.id], action);
      return skip ? null : pair;
    }),
  );
  return results.filter((pair): pair is MetadataDuplicatePair => pair !== null);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function truncateForPreview(value: string, maxChars = 2_000): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}…`;
}

async function enrichPairWithContent(
  task: CrossFolderScanTask,
  adapter: PlatformContentAdapter,
  pair: MetadataDuplicatePair,
): Promise<
  | {
      pair: MetadataDuplicatePair;
      contentA: string;
      contentB: string;
      jaccardScore: number;
      relationship: "exact" | "near-duplicate" | "subset" | "unrelated";
      combinedScore: number;
    }
  | null
> {
  const [contentA, contentB] = await Promise.all([
    adapter.fetchTextContent(task.userId, task.accountId, pair.candidate.id, pair.candidate.mimeType),
    adapter.fetchTextContent(task.userId, task.accountId, pair.match.id, pair.match.mimeType),
  ]);

  if (!contentA || !contentB) {
    return null;
  }

  const left = { id: pair.candidate.id, name: pair.candidate.name, textContent: contentA };
  const right = { id: pair.match.id, name: pair.match.name, textContent: contentB };
  const classification = classifyRelationship(left, right, false);
  const jaccardScore = clamp01(classification.metrics.jaccardScore);
  const combinedScore = clamp01(0.6 * pair.score + 0.4 * jaccardScore);

  return {
    pair,
    contentA: truncateForPreview(contentA),
    contentB: truncateForPreview(contentB),
    jaccardScore,
    relationship: classification.relationship,
    combinedScore,
  };
}

/**
 * Process a cross-folder scan asynchronously.
 * Detects metadata duplicates and stores suggestions for each pair found.
 * Runs in the background; does not await completion before returning.
 */
export async function processCrossFolderScan(task: CrossFolderScanTask): Promise<void> {
  const logPrefix = "[CrossFolderScan]";
  try {
    console.info(
      `${logPrefix} start user=${task.userId.slice(0, 8)}… platform=${task.platform} candidates=${task.candidates.length} universe=${task.universe.length}`,
    );

    const pairs = detectMetadataDuplicates(task.candidates, task.universe);

    if (pairs.length === 0) {
      const nearPairs = detectMetadataDuplicates(task.candidates, task.universe, { nameThreshold: 0 });
      const best = nearPairs[0];
      if (best) {
        console.info(
          `${logPrefix} no metadata pairs (threshold=0.6). best near match score=${best.score.toFixed(3)} name=${best.nameSimilarity.toFixed(3)} size=${best.sizeSimilarity.toFixed(3)} candidate="${best.candidate.name}" match="${best.match.name}"`,
        );
      } else {
        console.info(
          `${logPrefix} no metadata pairs — comparisons skip: same file id, shared parent folder (not cross-folder), mimeType mismatch, or no comparable files`,
        );
      }
      return;
    }

    const top = pairs[0];
    console.info(
      `${logPrefix} metadata pairs=${pairs.length} sample score=${top.score.toFixed(3)} names="${top.candidate.name}" vs "${top.match.name}"`,
    );

    const filteredPairs = await filterByRejectionHistory(task.userId, pairs, "merge");
    if (filteredPairs.length === 0) {
      console.info(`${logPrefix} all ${pairs.length} pair(s) filtered by merge rejection history`);
      return;
    }
    if (filteredPairs.length < pairs.length) {
      console.info(`${logPrefix} after rejection history: ${filteredPairs.length}/${pairs.length}`);
    }

    const adapter = getContentAdapter(task.platform);
    if (!adapter) {
      console.warn(`${logPrefix} no content adapter for platform=${task.platform} — storing metadata-only suggestions`);
    }

    const analyzed = adapter
      ? await Promise.all(filteredPairs.map((pair) => enrichPairWithContent(task, adapter, pair)))
      : [];

    const analyzedPairs = analyzed.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const enrichMissed = adapter ? filteredPairs.length - analyzedPairs.length : 0;
    if (adapter && enrichMissed > 0) {
      console.info(
        `${logPrefix} content fetch: ${analyzedPairs.length}/${filteredPairs.length} enriched (${enrichMissed} missing text from one or both files — metadata-only suggestion path)`,
      );
    }
    const analyzedByKey = new Map<string, (typeof analyzedPairs)[number]>();

    for (const entry of analyzedPairs) {
      const key = [entry.pair.candidate.id, entry.pair.match.id].sort().join(":");
      analyzedByKey.set(key, entry);
    }

    await Promise.all(
      filteredPairs.map((pair) => {
        const key = [pair.candidate.id, pair.match.id].sort().join(":");
        const analyzedEntry = analyzedByKey.get(key);

        if (!analyzedEntry) {
          const input = pairToSuggestionInput(pair, task.platform as "google_drive" | "notion");
          return storeSuggestion(task.userId, task.accountId, input);
        }

        const input = pairToSuggestionInput(pair, task.platform as "google_drive" | "notion", {
          jaccardScore: analyzedEntry.jaccardScore,
          relationship: analyzedEntry.relationship,
          combinedScore: analyzedEntry.combinedScore,
          contentA: analyzedEntry.contentA,
          contentB: analyzedEntry.contentB,
        });
        return storeSuggestion(task.userId, task.accountId, input);
      }),
    );
    console.info(`${logPrefix} queued storeSuggestion for ${filteredPairs.length} pair(s)`);
  } catch (error) {
    // Log error but don't throw; the HTTP response was already sent
    console.error(
      `[CrossFolderWorker] Failed to process cross-folder scan for user ${task.userId}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Fire-and-forget wrapper: spawn background task without awaiting.
 * Caller can return HTTP response immediately while work continues.
 */
export function spawnCrossFolderScan(task: CrossFolderScanTask): void {
  // Schedule the work asynchronously, do not await
  void processCrossFolderScan(task);
}
