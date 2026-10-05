/**
 * Epic 7's fixture repo (story 7.2): a git project with a finished epic, as a
 * look-back reads it. `epic-demo` holds two stories whose plans say `done`
 * (their `baseline_revision`s are the repo's first commit), a `tickets.toml`
 * that lists them, and an `AGENTS.md`; everything is committed on `main`, so a
 * build's worktree would carry what is committed. With `retrospective` set,
 * the epic folder also holds `epic-demo-retrospective.md` with that verdict
 * (`'damaged'`: frontmatter with no readable verdict). The initiative folder
 * is `initiative-demo`, the same name the other fixtures use, so the real
 * `tickets.py` and `tickets-v7` read it as they would a user's repo.
 *
 * Plain Node only, like `fake-bmad-repo.ts`.
 */
import { execFileSync } from 'node:child_process';
import { createFakeBmadRepo, type FakeBmadRepo } from './fake-bmad-repo.js';

export const RETRO_EPIC = 'epic-demo';
export const RETRO_INITIATIVE = 'initiative-demo';
export const RETRO_EPIC_FOLDER = `_bmad-output/${RETRO_INITIATIVE}/${RETRO_EPIC}`;
export const RETRO_FILE = `${RETRO_EPIC_FOLDER}/${RETRO_EPIC}-retrospective.md`;
export const RETRO_PITFALL = 'Run the fake check before you say a fake change is done.';

export type FixtureVerdict = 'accepted' | 'accepted-with-open-items' | 'rejected' | 'damaged';

export interface RetrospectiveRepoOptions {
  /** A retrospective file already in the epic folder (committed). Default none. */
  retrospective?: FixtureVerdict;
  /** Whether the repo has an `AGENTS.md`. Default `true`. */
  agentsFile?: boolean;
  /** The temp folder's name prefix. */
  prefix?: string;
}

/** The retrospective file's text for a verdict, as the skill writes it. */
export function retrospectiveText(verdict: FixtureVerdict): string {
  const verdictLine = verdict === 'damaged' ? 'verdict: [unfinished' : `verdict: ${verdict}`;
  return `---\nepic: ${RETRO_EPIC}\ndate: 2026-10-05T12:00:00-0600\n${verdictLine}\n---\n\n# Retrospective\n\n## Proposed AGENTS.md pitfalls\n\n- ${RETRO_PITFALL}\n`;
}

const STORY = (id: number, title: string) =>
  `---\ntitle: '${title}'\ntype: 'feature'\nticket: '${id}'\nstatus: 'done'\nbaseline_revision: 'NO_VCS'\n---\n\n# ${title}\n`;

/** The finished epic's files (not including any retrospective). */
export function finishedEpicFiles(): Record<string, string> {
  return {
    '_bmad/scripts/config_utils.py': [
      'class ConfigError(Exception):',
      '    pass',
      '',
      '',
      'def load_central_config(project_root):',
      `    return {"core": {"output_folder": "{project-root}/_bmad-output", "active_initiative": "${RETRO_INITIATIVE}"}}`,
      '',
    ].join('\n'),
    [`_bmad-output/${RETRO_INITIATIVE}/tickets.toml`]: `[[epic]]\nid = 1\nslug = "${RETRO_EPIC}"\ntitle = "A finished epic"\n`,
    [`${RETRO_EPIC_FOLDER}/${RETRO_EPIC}.md`]: `---\ntype: epic\ntitle: "A finished epic"\nparent: ${RETRO_INITIATIVE}\nafter: []\n---\n\n# A finished epic\n`,
    [`${RETRO_EPIC_FOLDER}/tickets.toml`]: '[[entry]]\nid = 1\ntype = "story"\ntitle = "First story"\nafter = []\n\n[[entry]]\nid = 2\ntype = "story"\ntitle = "Second story"\nafter = [1]\n',
    [`${RETRO_EPIC_FOLDER}/story-first-story-plan.md`]: STORY(1, 'First story'),
    [`${RETRO_EPIC_FOLDER}/story-second-story-plan.md`]: STORY(2, 'Second story'),
    '.claude/skills/bmad-retrospective/SKILL.md': "---\nname: bmad-retrospective\ndescription: 'Look back on a finished epic.'\n---\n",
    '.claude/skills/bmad-project-context/SKILL.md': "---\nname: bmad-project-context\ndescription: 'Keep AGENTS.md current.'\n---\n",
  };
}

/** Creates the repo, committed on `main`; the caller removes it (`remove()`). */
export function createRetrospectiveRepo({ retrospective, agentsFile = true, prefix = 'ogden-agents-retro-fixture-' }: RetrospectiveRepoOptions = {}): FakeBmadRepo & { git(...args: string[]): string } {
  const repo = createFakeBmadRepo({
    bmad: true,
    output: false,
    git: true,
    prefix,
    files: {
      ...finishedEpicFiles(),
      ...(agentsFile ? { 'AGENTS.md': '# Project instructions\n\n- Keep it small.\n' } : {}),
      ...(retrospective === undefined ? {} : { [RETRO_FILE]: retrospectiveText(retrospective) }),
    },
  });
  return { ...repo, git: (...args) => execFileSync('git', args, { cwd: repo.path, encoding: 'utf8' }) };
}
