import type { SkillMetadata, Skill } from './types.js';
import { skillTriggers } from './triggers.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Skill loader
 * 
 * Loads and caches skills on demand. Skills are loaded when they match
 * a detected context and are needed for operations.
 */
export class SkillLoader {
  private loadedSkills: Map<string, Skill> = new Map();
  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot || process.cwd();
  }

  /**
   * Load a skill by name
   * 
   * @param skillName - Name of the skill to load
   * @returns Promise resolving to the loaded skill or null if not found
   */
  async loadSkill(skillName: string): Promise<Skill | null> {
    if (this.loadedSkills.has(skillName)) {
      return this.loadedSkills.get(skillName)!;
    }

    const metadata = skillTriggers.getSkillByName(skillName);
    if (!metadata) {
      console.warn(`Skill not found in registry: ${skillName}`);
      return null;
    }

    const skillPath = resolve(this.projectRoot, metadata.path);
    if (!existsSync(skillPath)) {
      console.warn(`Skill path does not exist: ${skillPath}`);
      return null;
    }

    console.log(`Skill ${skillName} found at ${skillPath} but runtime loading not yet implemented`);
    return null;
  }

  /**
   * Load multiple skills by name
   */
  async loadSkills(skillNames: string[]): Promise<Map<string, Skill>> {
    const skills = new Map<string, Skill>();
    
    for (const name of skillNames) {
      const skill = await this.loadSkill(name);
      if (skill) {
        skills.set(name, skill);
      }
    }

    return skills;
  }

  /**
   * Check if a skill is loaded
   */
  isLoaded(skillName: string): boolean {
    return this.loadedSkills.has(skillName);
  }

  /**
   * Get all loaded skills
   */
  getLoadedSkills(): Map<string, Skill> {
    return this.loadedSkills;
  }

  /**
   * Unload a skill
   */
  unloadSkill(skillName: string): void {
    this.loadedSkills.delete(skillName);
  }

  /**
   * Get skill metadata without loading
   */
  getSkillMetadata(skillName: string): SkillMetadata | undefined {
    return skillTriggers.getSkillByName(skillName);
  }

  /**
   * List all available skills
   */
  listAvailableSkills(): SkillMetadata[] {
    return skillTriggers.getAllSkills();
  }
}

export const skillLoader = new SkillLoader();
