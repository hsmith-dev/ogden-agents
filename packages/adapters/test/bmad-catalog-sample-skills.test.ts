/**
 * Ogden Agents' own bundled sample skills (story 18, CAP-18): a content
 * sanity check on the real shipped `SAMPLE_SKILLS`, independent of
 * `bmad-catalog-setup.test.ts`'s behavioral tests (which use a small fixture
 * of their own, the way other catalog tests isolate themselves from shipped
 * content). Each one must be a real, discoverable `SKILL.md`: its folder
 * name, its frontmatter `name`, and `SKILL_NAME_PATTERN` all agree, it has a
 * non-empty description, and its name is clearly a sample, not a skill a
 * real user or module would plausibly already have (AC1, AC3).
 */
import { SKILL_NAME_PATTERN } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { parseSkillFrontmatter } from '../src/bmad-catalog/skills.js';
import { SAMPLE_SKILLS } from '../src/index.js';

describe('the shipped bundled sample skills (story 18, CAP-18)', () => {
  it('ships between two and four of them, as the ticket asks', () => {
    expect(SAMPLE_SKILLS.length).toBeGreaterThanOrEqual(2);
    expect(SAMPLE_SKILLS.length).toBeLessThanOrEqual(4);
  });

  it('each name is a valid, distinct skill name, clearly a sample', () => {
    const names = SAMPLE_SKILLS.map((skill) => skill.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(SKILL_NAME_PATTERN);
      expect(name.startsWith('sample-')).toBe(true);
    }
  });

  it("each SKILL.md's frontmatter name repeats the skill's own name, with a non-empty description", () => {
    for (const skill of SAMPLE_SKILLS) {
      const frontmatter = parseSkillFrontmatter(skill.content);
      expect(frontmatter?.name, skill.name).toBe(skill.name);
      expect(frontmatter?.description, skill.name).toBeTruthy();
    }
  });

  it('each body (not just its name) says plainly it is a bundled sample, so it reads as starter content, not core product content', () => {
    for (const skill of SAMPLE_SKILLS) {
      // Strip the frontmatter block first: every name is itself `sample-`-prefixed, so checking the
      // whole file would pass even if the body's own disclosure sentence were deleted.
      const end = skill.content.indexOf('\n---\n');
      expect(end, skill.name).toBeGreaterThan(-1);
      const body = skill.content.slice(end + '\n---\n'.length).toLowerCase();
      expect(body, skill.name).toContain('bundled sample');
    }
  });
});
