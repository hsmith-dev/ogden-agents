/**
 * Two "plain" BMad Method installs (entry 4.11): repos whose BMad Method was
 * installed outside Ogden Agents, by the user or another tool, at an older
 * upstream. Tests build each in a temp folder (`createPlainRepo`) and read or
 * upgrade the copy; nothing here is written in place. Provenance and what
 * each one lacks: `README.md` beside this file.
 *
 * Plain Node only (no test runner import), so Vitest and Playwright specs
 * can both use it.
 */
import { createFakeBmadRepo, type FakeBmadRepo } from '../fake-bmad-repo.js';

/** A skill folder's `SKILL.md`, as upstream writes its frontmatter. */
const skill = (name: string, description: string) => `---\nname: ${name}\ndescription: '${description}'\n---\n\n# ${name}\n`;

/**
 * (a) The older layout: the classic installer's `_bmad/_config/manifest.yaml`
 * and `_bmad/bmm/config.yaml`, one skill Ogden Agents' label mapping doesn't
 * know, no module records (`bmod.toml`), no `_bmad/scripts/` and no
 * `_bmad/config.toml`. Lacks both capabilities.
 */
export const PLAIN_OLDER_FILES: Readonly<Record<string, string>> = {
  '_bmad/_config/manifest.yaml': 'installation:\n  version: 6.0.0-alpha.12\n  installDate: "2025-11-02T10:00:00.000Z"\nmodules:\n  - name: core\n  - name: bmm\n',
  '_bmad/bmm/config.yaml': 'project_name: plain-older\nuser_name: Sam\noutput_folder: "{project-root}/_bmad-output"\n',
  '.claude/skills/bmad-help/SKILL.md': skill('bmad-help', 'Get help with BMad Method in this project.'),
  '_bmad-output/planning-artifacts/brief.md': '# Brief\n\nWritten before Ogden Agents.\n',
};

/** The project's own values in (b)'s config, which an upgrade keeps. */
export const PLAIN_BMOD_CONFIG = '[core]\nproject_name = "plain-bmod"\nuser_name = "Sam"\noutput_folder = "{project-root}/docs/planning"\n';
/** (b)'s user config under `_bmad/custom/`, which an upgrade keeps. */
export const PLAIN_BMOD_USER_CONFIG = '[core]\ncommunication_language = "French"\n';
/** (b)'s own `bmad-spec` skill in `.agents/skills`, which an upgrade never touches. */
export const PLAIN_BMOD_OWN_SKILL = skill('bmad-spec', 'My own spec skill, changed by hand.');

/**
 * (b) The `bmod` layout of an older upstream: a module record at an older
 * version, `_bmad/config.toml` with the project's own values (an output
 * folder in `docs/planning`), `_bmad/custom/`, and a `_bmad/scripts/config_utils.py`
 * from before `load_central_config` existed. Its one skill is a mapped one,
 * kept in `.agents/skills`. Has `plain_labels`, lacks `ticket_tree`.
 */
export const PLAIN_BMOD_FILES: Readonly<Record<string, string>> = {
  '.claude/skills/bmod-method/bmod.toml': '[bmod]\ncode = "method"\nversion = "6.10.0"\nskills = ["bmad-spec"]\n',
  '.agents/skills/bmad-spec/SKILL.md': PLAIN_BMOD_OWN_SKILL,
  '_bmad/config.toml': PLAIN_BMOD_CONFIG,
  '_bmad/custom/.gitignore': '*.user.toml\n',
  '_bmad/custom/config.user.toml': PLAIN_BMOD_USER_CONFIG,
  '_bmad/scripts/config_utils.py': [
    '"""Config helpers of an older BMad Method: before the central config loader."""',
    '',
    'import tomllib',
    '',
    '',
    'def load_config(path):',
    '    with open(path, "rb") as handle:',
    '        return tomllib.load(handle)',
    '',
  ].join('\n'),
  'docs/planning/.keep': '',
};

export type PlainRepoKind = 'older' | 'bmod';

/** A temp copy of plain repo `kind` (with `files` added), removed by the caller (`remove()`). */
export function createPlainRepo(kind: PlainRepoKind, files: Readonly<Record<string, string>> = {}, parent?: string): FakeBmadRepo {
  return createFakeBmadRepo({
    bmad: false,
    files: { ...(kind === 'older' ? PLAIN_OLDER_FILES : PLAIN_BMOD_FILES), ...files },
    prefix: `ogden-agents-plain-${kind}-`,
    ...(parent === undefined ? {} : { parent }),
  });
}
