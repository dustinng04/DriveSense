import type { ContextMetadata, DetectedContext, Platform } from '../context/types.js';
import { contextDetector } from '../context/detector.js';
import { PROMPT_TEMPLATES } from '../logging/prompts.js';
import { renderTemplate } from '../logging/templateRenderer.js';
import { createLlmAdapter, DEFAULT_LLM_PROVIDER, isLlmProvider } from '../llm/adapters.js';
import type { LlmProvider } from '../llm/types.js';
import { evaluateRules } from '../rules/evaluator.js';
import type { DriveSenseRule, RuleEvaluationResult, RuleEvaluationTarget } from '../rules/types.js';
import { detectStaleness } from '../scanner/analysis.js';
import type { NearDuplicatePair } from '../scanner/analysis.js';
import { buildMergeCard, buildRenameCard, buildStalenessCard } from './builder.js';
import type { SuggestionCard } from './types.js';

export type ValidationAction = 'archive' | 'merge' | 'rename';

export interface ValidationLlmOptions {
  enabled?: boolean;
  provider?: string;
  model?: string;
  apiKey?: string;
}

export interface ValidationRequest {
  url?: string;
  metadata?: ContextMetadata;
  target?: RuleEvaluationTarget;
  rules?: DriveSenseRule[];
  actions?: ValidationAction[];
  llm?: ValidationLlmOptions;
}

export interface ValidationResponse {
  context: DetectedContext | null;
  ruleEvaluation: RuleEvaluationResult;
  suggestions: SuggestionCard[];
}

export async function generateValidationSuggestions(
  request: ValidationRequest,
): Promise<ValidationResponse> {
  const context = detectOptionalContext(request.url, request.metadata);
  const target = resolveTarget(request, context);
  const rules = request.rules ?? buildDefaultRules(target);
  const ruleEvaluation = evaluateRules(rules, target);

  if (ruleEvaluation.decision === 'skip') {
    return {
      context,
      ruleEvaluation,
      suggestions: [],
    };
  }

  const actions = normalizeActions(request.actions);
  const baseCards = actions.map((action) => buildCardForAction(action));
  const suggestions = await maybeEnhanceWithLlm(baseCards, request.llm);

  return {
    context,
    ruleEvaluation,
    suggestions,
  };
}

function detectOptionalContext(url: string | undefined, metadata: ContextMetadata | undefined): DetectedContext | null {
  if (!url) {
    return null;
  }

  try {
    return contextDetector.detect(url, metadata);
  } catch {
    return null;
  }
}

function resolveTarget(request: ValidationRequest, context: DetectedContext | null): RuleEvaluationTarget {
  const target = request.target;
  const metadata = request.metadata ?? context?.metadata;
  const platform: Platform = target?.platform ?? context?.platform ?? 'google_drive';

  return {
    platform,
    path: target?.path ?? metadata?.path ?? '/MockWorkspace',
    name: target?.name ?? metadata?.title ?? 'mock-note.md',
    fileType: target?.fileType ?? 'md',
    mimeType: target?.mimeType,
  };
}

function buildDefaultRules(target: RuleEvaluationTarget): DriveSenseRule[] {
  const fileType = target.fileType ?? 'md';

  return [
    {
      type: 'filetype_whitelist',
      allowedTypes: [fileType],
      ...(target.platform !== 'unknown' ? { platform: target.platform } : {}),
    },
  ];
}

function normalizeActions(actions: ValidationAction[] | undefined): ValidationAction[] {
  if (!actions || actions.length === 0) {
    return ['archive', 'merge', 'rename'];
  }

  return actions;
}

function buildCardForAction(action: ValidationAction): SuggestionCard {
  if (action === 'archive') {
    const assessment = detectStaleness({
      id: 'mock-file-archive',
      name: 'Quarterly-notes-2024.md',
      modifiedAt: isoDaysAgo(120),
      lastAccessedAt: isoDaysAgo(220),
    });

    return buildStalenessCard(assessment);
  }

  if (action === 'merge') {
    const pair: NearDuplicatePair = {
      left: {
        id: 'mock-file-merge-a',
        name: 'Project plan draft.md',
        textContent: 'Project milestones and owners for the DriveSense launch.',
      },
      right: {
        id: 'mock-file-merge-b',
        name: 'Project plan v2.md',
        textContent: 'Project milestones and owners for the DriveSense launch.',
      },
      score: 0.94,
    };

    return buildMergeCard(pair, 'high');
  }

  return buildRenameCard(
    'mock-file-rename',
    'notes-final-v3-new.doc',
    'project-kickoff-notes-2025.doc',
    'medium',
  );
}

function isoDaysAgo(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() - days);
  return now.toISOString();
}

async function maybeEnhanceWithLlm(
  cards: SuggestionCard[],
  llmOptions: ValidationLlmOptions | undefined,
): Promise<SuggestionCard[]> {
  const apiKey = llmOptions?.apiKey?.trim();
  if (!llmOptions?.enabled || !apiKey) {
    return cards;
  }

  const provider = resolveProvider(llmOptions.provider);
  const adapter = createLlmAdapter(provider);

  const enhancedCards: SuggestionCard[] = [];
  for (const card of cards) {
    const prompt = renderTemplate(PROMPT_TEMPLATES.SUGGESTION_GENERATION, {
      action_type: card.action,
      file_titles: card.fileIds.join(', '),
      analysis_json: JSON.stringify({
        source: 'mock_validation',
        action: card.action,
        confidence: card.confidence,
      }),
    });

    try {
      const response = await adapter.generateJson<{
        title?: string;
        description?: string;
        action?: SuggestionCard['action'];
      }>({
        apiKey,
        model: llmOptions.model,
        responseFormat: 'json',
        messages: [{ role: 'user', content: prompt }],
      });

      if (
        typeof response.json.title === 'string' &&
        typeof response.json.description === 'string' &&
        response.json.action === card.action
      ) {
        enhancedCards.push({
          ...card,
          title: response.json.title,
          description: response.json.description,
        });
        continue;
      }
    } catch {
      // Keep deterministic card when LLM call fails.
    }

    enhancedCards.push(card);
  }

  return enhancedCards;
}

function resolveProvider(provider: string | undefined): LlmProvider {
  if (provider && isLlmProvider(provider)) {
    return provider;
  }

  return DEFAULT_LLM_PROVIDER;
}
