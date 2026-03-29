import { randomUUID } from 'node:crypto';
import type { StalenessAssessment, NearDuplicatePair } from '../scanner/analysis.js';
import type { SuggestionCard, SuggestionRequest } from './types.js';

/**
 * Build a suggestion card from a staleness assessment.
 * The assessment already contains confidence and reasoning from prior analysis.
 */
export function buildStalenessCard(assessment: StalenessAssessment): SuggestionCard {
  const request = stalennessToRequest(assessment);
  return buildCard(request);
}

/**
 * Build a suggestion card from a near-duplicate pair.
 * Both files are included; the UI will decide which to keep.
 */
export function buildMergeCard(pair: NearDuplicatePair, confidence: 'high' | 'medium' | 'low' = 'medium'): SuggestionCard {
  const request = nearDuplicateToRequest(pair, confidence);
  return buildCard(request);
}

/**
 * Build a suggestion card for renaming a single file.
 */
export function buildRenameCard(
  fileId: string,
  currentName: string,
  proposedName: string,
  confidence: 'high' | 'medium' | 'low' = 'medium',
): SuggestionCard {
  const request: SuggestionRequest = {
    action: 'rename',
    fileIds: [fileId],
    title: 'Rename unclear file',
    description: `Rename "${currentName}" to "${proposedName}" so it is easier to find later.`,
    confidence,
  };

  return buildCard(request);
}

/**
 * Core builder: transform a SuggestionRequest into a SuggestionCard.
 * Generates ID and timestamp.
 */
function buildCard(request: SuggestionRequest): SuggestionCard {
  return {
    id: randomUUID(),
    title: request.title,
    description: request.description,
    action: request.action,
    fileIds: request.fileIds,
    confidence: request.confidence,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Transform a StalenessAssessment into a SuggestionRequest.
 * Only called when staleness is confirmed.
 */
function stalennessToRequest(assessment: StalenessAssessment): SuggestionRequest {
  if (!assessment.isStale) {
    throw new Error(`File ${assessment.fileId} is not marked as stale`);
  }

  const confidence = assessment.llmReasoning?.confidence ?? 'medium';

  return {
    action: 'archive',
    fileIds: [assessment.fileId],
    title: 'Archive stale file',
    description: assessment.reason,
    confidence,
  };
}

/**
 * Transform a NearDuplicatePair into a SuggestionRequest.
 */
function nearDuplicateToRequest(pair: NearDuplicatePair, confidence: 'high' | 'medium' | 'low'): SuggestionRequest {
  const similarity = Math.round(pair.score * 100);

  return {
    action: 'merge',
    fileIds: [pair.left.id, pair.right.id],
    title: 'Merge duplicate files',
    description: `These files are ${similarity}% similar. Consider merging or deleting the older one.`,
    confidence,
  };
}
