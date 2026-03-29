/**
 * Prompt templates as defined in PROMPTS.md
 * These are used across all LLM calls with the renderTemplate utility.
 */

export const PROMPT_TEMPLATES = {
  /**
   * Similarity Analysis - Determine if two files are near-duplicates
   */
  SIMILARITY_ANALYSIS: `You are a file hygiene assistant. Compare the following two documents and determine if they are near-duplicates.

File A:
Title: {{file_a_title}}
Last modified: {{file_a_modified}}
Content summary: {{file_a_content}}

File B:
Title: {{file_b_title}}
Last modified: {{file_b_modified}}
Content summary: {{file_b_content}}

Answer the following:
1. Are these files near-duplicates? (yes / no / unsure)
2. If yes, which file appears to be the more complete or recent version?
3. In one sentence, explain why these files are similar.

Respond in JSON:
{
  "is_duplicate": true | false | "unsure",
  "preferred_file": "A" | "B" | null,
  "reason": "..."
}`,

  /**
   * Staleness Reasoning - Determine if a file is outdated and safe to archive
   */
  STALENESS_REASONING: `You are a file hygiene assistant. Assess whether the following file is likely stale and safe to archive.

File:
Title: {{file_title}}
Last modified: {{last_modified}}
Last accessed: {{last_accessed}}
Owner: {{owner}}
File type: {{file_type}}
Content summary: {{content_summary}}

Consider:
- Is the title or content time-sensitive (e.g. "Q3 2022 report", "onboarding v1")?
- Does the content appear to be a draft, template, or reference document?
- Are there signals this file is still actively needed?

Respond in JSON:
{
  "is_stale": true | false | "unsure",
  "confidence": "high" | "medium" | "low",
  "reason": "...",
  "suggested_action": "archive" | "review" | "keep"
}`,

  /**
   * Suggestion Generation - Create a user-facing suggestion card
   */
  SUGGESTION_GENERATION: `You are a file hygiene assistant. Generate a clear, concise suggestion for the user based on the following analysis result.

Action type: {{action_type}}  (archive | merge | rename | review)
File(s) involved: {{file_titles}}
Analysis result: {{analysis_json}}

Write a suggestion the user will see. It must:
- Be one to two sentences maximum
- Explain what the action is and why it is recommended
- Be written in plain language, not technical jargon
- Not assume the user will accept — frame it as a recommendation

Respond in JSON:
{
  "title": "Short action label (e.g. Archive stale file)",
  "description": "Plain language explanation of why this is recommended.",
  "action": "archive" | "merge" | "rename" | "review"
}`,
} as const;

export type PromptTemplateKey = keyof typeof PROMPT_TEMPLATES;
