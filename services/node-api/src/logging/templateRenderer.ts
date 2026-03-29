/**
 * Renders prompt templates by replacing {{variable}} placeholders with actual values.
 * This ensures consistent template handling across all LLM calls.
 */

export interface TemplateVariables {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Renders a template string by replacing {{key}} placeholders with values.
 * Placeholders not found in variables are left unchanged.
 */
export function renderTemplate(template: string, variables: TemplateVariables): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key];
    return value !== null && value !== undefined ? String(value) : match;
  });
}

/**
 * Extracts all {{variable}} placeholders from a template.
 */
export function extractPlaceholders(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  return Array.from(matches, (match) => match[1]);
}
