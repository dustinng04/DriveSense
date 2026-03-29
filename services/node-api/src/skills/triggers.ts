import type { DetectedContext } from '../context/types.js';
import type { SkillMetadata, SkillOperation } from './types.js';
import registryJson from './registry.json';

const registryData = registryJson as { skills: SkillMetadata[] };

/**
 * Skill trigger system
 * 
 * Matches detected context to relevant skills based on platform,
 * context type, and required operations.
 */
export class SkillTriggers {
  private registry: SkillMetadata[];

  constructor() {
    this.registry = registryData.skills;
  }

  /**
   * Find skills that match the detected context
   * 
   * @param context - Detected context from URL
   * @param requiredOperations - Optional list of required operations
   * @returns Array of matching skill metadata
   */
  findMatchingSkills(
    context: DetectedContext,
    requiredOperations?: SkillOperation[]
  ): SkillMetadata[] {
    return this.registry.filter(skill => {
      const platformMatch = skill.triggers.platforms.includes(context.platform);
      const contextTypeMatch = skill.triggers.contextTypes.includes(context.contextType);
      
      const operationsMatch = requiredOperations
        ? requiredOperations.every(op => skill.triggers.operations.includes(op))
        : true;

      return platformMatch && contextTypeMatch && operationsMatch;
    });
  }

  /**
   * Get all registered skills
   */
  getAllSkills(): SkillMetadata[] {
    return this.registry;
  }

  /**
   * Get skill by name
   */
  getSkillByName(name: string): SkillMetadata | undefined {
    return this.registry.find(skill => skill.name === name);
  }

  /**
   * Check if a skill supports a specific operation
   */
  skillSupportsOperation(skillName: string, operation: SkillOperation): boolean {
    const skill = this.getSkillByName(skillName);
    return skill ? skill.triggers.operations.includes(operation) : false;
  }
}

export const skillTriggers = new SkillTriggers();
