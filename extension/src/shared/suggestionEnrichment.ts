import type { Confidence, Provider, Suggestion } from './types.js';
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
  // Keep aligned with `services/node-api/src/logging/prompts.ts` (SIMILARITY_ANALYSIS).
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
  return {
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

