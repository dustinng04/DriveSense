/**
 * Platform types for skill system
 */
export type Platform = 'google_drive' | 'notion' | 'unknown';

/**
 * Operation types that skills can perform
 */
export type SkillOperation = 'read' | 'write' | 'move' | 'delete' | 'share' | 'archive';

/**
 * Context type from detector
 */
export type ContextType = 'file' | 'folder' | 'page' | 'unknown';

/**
 * Skill trigger configuration
 */
export interface SkillTrigger {
  /** Platforms this skill works with */
  platforms: Platform[];
  /** Context types this skill handles */
  contextTypes: ContextType[];
  /** Operations this skill can perform */
  operations: SkillOperation[];
}

/**
 * Skill metadata from registry
 */
export interface SkillMetadata {
  /** Unique skill name */
  name: string;
  /** Path to skill directory */
  path: string;
  /** Trigger conditions */
  triggers: SkillTrigger;
  /** Optional description */
  description?: string;
}

/**
 * Skill registry structure
 */
export interface SkillRegistry {
  skills: SkillMetadata[];
}

/**
 * Skill interface for runtime
 */
export interface Skill {
  /** Skill name */
  name: string;
  /** Platform this skill works with */
  platform: Platform;
  /** Initialize the skill */
  initialize(): Promise<void>;
  /** Check if skill is authenticated and ready */
  isAuthenticated(): Promise<boolean>;
  /** Get list of capabilities/operations */
  getCapabilities(): string[];
}
