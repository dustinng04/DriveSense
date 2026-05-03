import type { Confidence, Provider, Suggestion, SuggestionAction } from './types.js';
import { generateText, safeParseJson, type LlmMessage } from './llmAdapters.js';

type SimilarityJson = {
  is_duplicate: boolean | 'unsure';
  preferred_file: 'A' | 'B' | null;
  reason: string;
};

function truncate(value: string, maxChars = 8_000): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}…`;
}

function confidenceFromDuplicate(isDuplicate: SimilarityJson['is_duplicate'], jaccardScore: number): Confidence {
  if (isDuplicate === true) {
    return jaccardScore >= 0.9 ? 'high' : 'medium';
  }
  if (isDuplicate === false) {
    return 'low';
  }
  return 'medium';
}

function renderSimilarityPrompt(vars: {
  file_a_title: string;
  file_a_content: string;
  file_b_title: string;
  file_b_content: string;
}): string {
  return `You are a file hygiene assistant. Compare the following two documents and determine if they are near-duplicates.

File A:
Title: ${vars.file_a_title}
Last modified: unknown
Content summary: ${vars.file_a_content}

File B:
Title: ${vars.file_b_title}
Last modified: unknown
Content summary: ${vars.file_b_content}

Answer the following:
1. Are these files near-duplicates? (yes / no / unsure)
2. If yes, which file appears to be the more complete or recent version?
3. In one sentence, explain why these files are similar.

Respond in JSON:
{
  "is_duplicate": true | false | "unsure",
  "preferred_file": "A" | "B" | null,
  "reason": "..."
}`;
}

function renderContentDeduplicationPrompt(vars: {
  target_title: string;
  target_content: string;
  reference_title: string;
  reference_content: string;
}): string {
  return `You are a file hygiene assistant. The following document contains sections that duplicate content from another file.

Target document (to be edited):
Title: ${vars.target_title}
Content: ${vars.target_content}

Reference document (contains subset):
Title: ${vars.reference_title}
Content: ${vars.reference_content}

Task: Generate a cleaned version of the target document with redundant sections removed. Keep:
- All unique content from the target
- Proper document structure and formatting
- Section headings and transitions

Remove:
- Exact duplicates of content already in the reference document
- Near-duplicate paragraphs that convey the same information

Emit literal search-and-replace operations against the target content. Each old_str must be copied exactly from the target and include enough sentence or paragraph context to be unique.

Respond in JSON:
{
  "should_edit": true | false,
  "reason": "Explanation of what was removed and why",
  "content_updates": [
    {
      "old_str": "exact text to remove/replace — must be a complete sentence or paragraph for uniqueness",
      "new_str": "",
      "replace_all_matches": false
    }
  ],
  "confidence": "high" | "medium" | "low"
}`;
}

function readAnalysis(suggestion: Suggestion): {
  fileAName: string;
  fileBName: string;
  contentA: string;
  contentB: string;
  jaccardScore: number;
} | null {
  const analysis = suggestion.analysis ?? {};
  const files = (analysis as any).files as any;
  const contentPreview = (analysis as any).contentPreview as any;
  const content = (analysis as any).content as any;

  const fileAName = String(files?.candidate?.name ?? '');
  const fileBName = String(files?.match?.name ?? '');
  const contentA = String(contentPreview?.candidate ?? '');
  const contentB = String(contentPreview?.match ?? '');
  const jaccardScoreRaw = content?.jaccardScore;
  const jaccardScore = typeof jaccardScoreRaw === 'number' ? jaccardScoreRaw : 0;

  if (!fileAName || !fileBName || !contentA || !contentB) return null;

  return { fileAName, fileBName, contentA, contentB, jaccardScore };
}

export async function enrichSuggestionWithByok(
  suggestion: Suggestion,
  opts: { provider: Provider; apiKey: string },
): Promise<{
  action?: SuggestionAction;
  reason: string;
  confidence: Confidence;
  analysisPatch: Record<string, unknown>;
} | null> {
  if (suggestion.action !== 'merge') return null;

  const extracted = readAnalysis(suggestion);
  if (!extracted) return null;

  const messages: LlmMessage[] = [
    {
      role: 'user',
      content: renderSimilarityPrompt({
        file_a_title: extracted.fileAName,
        file_a_content: truncate(extracted.contentA),
        file_b_title: extracted.fileBName,
        file_b_content: truncate(extracted.contentB),
      }),
    },
  ];

  const response = await generateText({
    provider: opts.provider,
    apiKey: opts.apiKey,
    responseFormat: 'json',
    maxOutputTokens: 500,
    temperature: 0.2,
    messages,
  });

  const parsed = safeParseJson<SimilarityJson>(response.text);
  if (!parsed || typeof parsed.reason !== 'string' || !parsed.reason.trim()) {
    return {
      reason: 'LLM returned an unclear response.',
      confidence: 'medium',
      analysisPatch: { enrichment: { provider: opts.provider, ok: false, error: 'malformed_json' } },
    };
  }

  const adjustedConfidence = confidenceFromDuplicate(parsed.is_duplicate, extracted.jaccardScore);
  const action =
    parsed.is_duplicate === false || parsed.is_duplicate === 'unsure' ? 'review' : undefined;
  return {
    action,
    reason: parsed.reason.trim(),
    confidence: adjustedConfidence,
    analysisPatch: {
      enrichment: {
        provider: opts.provider,
        ok: true,
        result: {
          is_duplicate: parsed.is_duplicate,
          preferred_file: parsed.preferred_file,
          reason: parsed.reason.trim(),
        },
      },
    },
  };
}

type EditDeduplicationJson = {
  should_edit: boolean;
  reason: string;
  content_updates?: Array<{
    old_str: string;
    new_str: string;
    replace_all_matches?: boolean;
  }>;
  confidence: 'high' | 'medium' | 'low';
};

function countOccurrences(content: string, needle: string): number {
  if (needle.length === 0) return 0;

  let count = 0;
  let index = 0;
  while (true) {
    const nextIndex = content.indexOf(needle, index);
    if (nextIndex === -1) return count;
    count += 1;
    index = nextIndex + needle.length;
  }
}

function readEditAnalysis(suggestion: Suggestion): {
  targetName: string;
  referenceName: string;
  targetContent: string;
  referenceContent: string;
} | null {
  const analysis = suggestion.analysis ?? {};
  const files = (analysis as any).files as any;
  const contentPreview = (analysis as any).contentPreview as any;

  const targetName = String(files?.target?.name ?? '');
  const referenceName = String(files?.reference?.name ?? '');
  const targetContent = String(contentPreview?.target ?? '');
  const referenceContent = String(contentPreview?.reference ?? '');

  if (!targetName || !targetContent) return null;

  return { targetName, referenceName, targetContent, referenceContent };
}

export async function enrichEditSuggestionWithByok(
  suggestion: Suggestion,
  opts: { provider: Provider; apiKey: string },
): Promise<{
  action?: SuggestionAction;
  reason: string;
  confidence: Confidence;
  analysisPatch: Record<string, unknown>;
} | null> {
  if (suggestion.action !== 'edit') return null;

  const extracted = readEditAnalysis(suggestion);
  if (!extracted) return null;

  const messages: LlmMessage[] = [
    {
      role: 'user',
      content: renderContentDeduplicationPrompt({
        target_title: extracted.targetName,
        target_content: truncate(extracted.targetContent, 6000),
        reference_title: extracted.referenceName,
        reference_content: truncate(extracted.referenceContent, 2000),
      }),
    },
  ];

  const response = await generateText({
    provider: opts.provider,
    apiKey: opts.apiKey,
    responseFormat: 'json',
    maxOutputTokens: 8000,
    temperature: 0.1,
    messages,
  });

  const parsed = safeParseJson<EditDeduplicationJson>(response.text);
  if (!parsed || !parsed.reason) {
    return {
      reason: 'LLM could not generate edit.',
      confidence: 'low',
      analysisPatch: {
        enrichment: { provider: opts.provider, ok: false, error: 'malformed_response' },
      },
    };
  }

  const contentUpdates = Array.isArray(parsed.content_updates)
    ? parsed.content_updates.filter(
        (op) =>
          op &&
          typeof op.old_str === 'string' &&
          op.old_str.length > 0 &&
          typeof op.new_str === 'string' &&
          (op.replace_all_matches === undefined || typeof op.replace_all_matches === 'boolean'),
      )
    : [];

  if (!parsed.should_edit || contentUpdates.length === 0) {
    return {
      action: 'review',
      reason: parsed.reason,
      confidence: 'low',
      analysisPatch: {
        enrichment: {
          provider: opts.provider,
          ok: true,
          result: { should_edit: false, reason: parsed.reason },
        },
      },
    };
  }

  for (const op of contentUpdates) {
    const count = countOccurrences(extracted.targetContent, op.old_str);
    if (count === 0) {
      return {
        reason: 'LLM returned an edit that no longer matches the source text.',
        confidence: 'low',
        analysisPatch: {
          enrichment: { provider: opts.provider, ok: false, error: 'llm_mismatch' },
        },
      };
    }
    if (count > 1 && !op.replace_all_matches) {
      return {
        reason: 'LLM returned an ambiguous edit that matches multiple places.',
        confidence: 'low',
        analysisPatch: {
          enrichment: { provider: opts.provider, ok: false, error: 'ambiguous_edit', count },
        },
      };
    }
  }

  return {
    reason: parsed.reason,
    confidence: parsed.confidence,
    analysisPatch: {
      enrichment: {
        provider: opts.provider,
        ok: true,
        result: {
          should_edit: true,
          reason: parsed.reason,
          content_length_before: extracted.targetContent.length,
          update_count: contentUpdates.length,
        },
      },
      editPatch: {
        version: 1,
        content_updates: contentUpdates,
      },
    },
  };
}
