import { createLlmAdapter } from "./adapters.js";
import type { LlmProvider } from "./types.js";
import { PROMPT_TEMPLATES, renderTemplate } from "../logging/index.js";

export interface LlmEnrichmentInput {
  fileA: { name: string; content: string };
  fileB: { name: string; content: string };
  jaccardScore: number;
}

export interface LlmEnrichmentResult {
  adjustedConfidence: "high" | "medium" | "low";
  reason: string;
}

type SimilarityJson = {
  is_duplicate: boolean | "unsure";
  preferred_file: "A" | "B" | null;
  reason: string;
};

type StalenessJson = {
  is_stale: boolean | "unsure";
  confidence: "high" | "medium" | "low";
  reason: string;
  suggested_action: "archive" | "review" | "keep";
};

const MAX_CHARS = 8_000;

function truncateContent(value: string, maxChars = MAX_CHARS): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}…`;
}

function stripJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function safeParseJson<TJson>(value: string): TJson | null {
  const cleaned = stripJsonFence(value);
  try {
    return JSON.parse(cleaned) as TJson;
  } catch {
    return null;
  }
}

function confidenceFromDuplicate(isDuplicate: SimilarityJson["is_duplicate"], jaccardScore: number): LlmEnrichmentResult["adjustedConfidence"] {
  if (isDuplicate === true) {
    return jaccardScore >= 0.9 ? "high" : "medium";
  }
  if (isDuplicate === false) {
    return "low";
  }
  return "medium";
}

/**
 * Enrich similarity analysis with LLM reasoning.
 * Used when metadata+Jaccard score is inconclusive (roughly 0.75-0.9).
 */
export async function enrichSimilarityWithLlm(
  input: LlmEnrichmentInput,
  provider: LlmProvider,
  apiKey: string,
): Promise<LlmEnrichmentResult> {
  const llm = createLlmAdapter(provider);

  const prompt = renderTemplate(PROMPT_TEMPLATES.SIMILARITY_ANALYSIS, {
    file_a_title: input.fileA.name,
    file_a_modified: "unknown",
    file_a_content: truncateContent(input.fileA.content),
    file_b_title: input.fileB.name,
    file_b_modified: "unknown",
    file_b_content: truncateContent(input.fileB.content),
  });

  let raw = "";
  try {
    const response = await llm.generateText({
      apiKey,
      responseFormat: "json",
      maxOutputTokens: 500,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });
    raw = response.text;
  } catch {
    return {
      adjustedConfidence: "medium",
      reason: "LLM enrichment unavailable.",
    };
  }

  const parsed = safeParseJson<SimilarityJson>(raw);
  if (!parsed || typeof parsed.reason !== "string" || !parsed.reason.trim()) {
    return {
      adjustedConfidence: "medium",
      reason: "LLM returned an unclear response.",
    };
  }

  return {
    adjustedConfidence: confidenceFromDuplicate(parsed.is_duplicate, input.jaccardScore),
    reason: parsed.reason.trim(),
  };
}

/**
 * Enrich staleness analysis with LLM reasoning.
 * Used when deterministic staleness rules are inconclusive.
 */
export async function enrichStalenessWithLlm(
  file: { name: string; content: string; modifiedAt: string },
  provider: LlmProvider,
  apiKey: string,
): Promise<LlmEnrichmentResult> {
  const llm = createLlmAdapter(provider);

  const prompt = renderTemplate(PROMPT_TEMPLATES.STALENESS_REASONING, {
    file_title: file.name,
    last_modified: file.modifiedAt,
    last_accessed: "unknown",
    owner: "unknown",
    file_type: "unknown",
    content_summary: truncateContent(file.content),
  });

  let raw = "";
  try {
    const response = await llm.generateText({
      apiKey,
      responseFormat: "json",
      maxOutputTokens: 500,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });
    raw = response.text;
  } catch {
    return {
      adjustedConfidence: "medium",
      reason: "LLM enrichment unavailable.",
    };
  }

  const parsed = safeParseJson<StalenessJson>(raw);
  if (!parsed || typeof parsed.reason !== "string" || !parsed.reason.trim()) {
    return {
      adjustedConfidence: "medium",
      reason: "LLM returned an unclear response.",
    };
  }

  return {
    adjustedConfidence: parsed.confidence ?? "medium",
    reason: parsed.reason.trim(),
  };
}

