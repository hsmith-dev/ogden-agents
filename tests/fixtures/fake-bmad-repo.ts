/**
 * A fake project repo for epic 10's detection tests (story 10.2 owns it;
 * entries 10.3, 10.7 and 10.9 use it): a temp folder with or without
 * `_bmad/` and `_bmad-output/`, laid out as BMad Method's installer leaves
 * them (a config file, a skill, a planning artifact), plus a hash of the
 * whole file tree so a test can prove that detecting, turning pieces on and
 * turning them off changed nothing in the repo.
 *
 * Plain Node only (no test runner import), so Vitest and Playwright specs can
 * both use it. Like the real thing, it is ordinary files on disk: the real
 * `bmad-catalog` adapter reads it exactly as it would a user's repo.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

export interface FakeBmadRepoOptions {
  /** Create `_bmad/` (with a config file and one skill). Default `true`. */
  bmad?: boolean;
  /** Create `_bmad-output/` (with one planning artifact). Default `false`. */
  output?: boolean;
  /**
   * Add an active initiative with a ticket tree `tickets.py status` reads
   * ({@link FAKE_TICKET_TREE_FILES}; story 4.1), and the BMad config script
   * it loads. Default `false`.
   */
  tickets?: boolean;
  /** More files, by `/`-separated path relative to the repo, such as the user's own `.claude/skills`. */
  files?: Readonly<Record<string, string>>;
  /** The temp folder's name prefix. Default `ogden-agents-bmad-repo-`. */
  prefix?: string;
  /** The folder the repo is created in. Default: the OS temp folder. A suite that sweeps its own folder passes it (story 10.8). */
  parent?: string;
  /**
   * Make it a git repository on branch `main` with everything committed
   * (story 5.2: builds branch from it), with a local identity and no hook
   * ever run by the commit. Default `false`.
   */
  git?: boolean;
}

export interface FakeBmadRepo {
  /** The repo's absolute path (inside `parent`, the OS temp folder by default). */
  path: string;
  /** {@link hashFileTree} of the repo now. */
  hash(): string;
  /** Removes the repo. Safe to call more than once. */
  remove(): void;
}

/** What `_bmad/` holds in the fake: enough to look like an installed BMad Method. */
export const FAKE_BMAD_FILES: Readonly<Record<string, string>> = {
  '_bmad/_config/manifest.yaml': 'installation:\n  version: 7.0.0\nmodules:\n  - name: bmm\n',
  '_bmad/bmm/config.yaml': 'project_name: fake\noutput_folder: "{project-root}/_bmad-output"\n',
  '.claude/skills/bmad-help/SKILL.md': '---\nname: bmad-help\ndescription: Fake BMad help skill.\n---\n',
};

/** What `_bmad-output/` holds in the fake. */
export const FAKE_BMAD_OUTPUT_FILES: Readonly<Record<string, string>> = {
  '_bmad-output/planning-artifacts/spec.md': '# Spec\n\nA fake planning artifact.\n',
};

/**
 * A ticket tree as BMad Method's `tickets.py` reads it (story 4.1; story 4.2
 * covers every board column case): the project's config script naming the
 * active initiative `initiative-demo`, an initiative with one epic of four
 * stories, and plans for three of them. `tickets.py status` reports `1.1`
 * (status `in-review`, state `review`), `1.2` (no plan: state `planned`, the
 * Draft column), `1.3` (status `blocked` with a reason and date, the Blocked
 * column) and `1.4` (status `dropped`: in no column).
 */
export const FAKE_TICKET_TREE_FILES: Readonly<Record<string, string>> = {
  '_bmad/scripts/config_utils.py': [
    'class ConfigError(Exception):',
    '    pass',
    '',
    '',
    'def load_central_config(project_root):',
    '    return {"core": {"output_folder": "{project-root}/_bmad-output", "active_initiative": "initiative-demo"}}',
    '',
  ].join('\n'),
  '_bmad-output/initiative-demo/tickets.toml': '[[epic]]\nid = 1\nslug = "epic-first"\ntitle = "The first epic"\n',
  '_bmad-output/initiative-demo/epic-first/epic-first.md': '---\ntype: epic\ntitle: "The first epic"\nparent: initiative-demo\nafter: []\n---\n\n# The first epic\n',
  '_bmad-output/initiative-demo/epic-first/tickets.toml': [
    '[[entry]]',
    'id = 1',
    'type = "story"',
    'title = "Build the first thing"',
    'after = []',
    '',
    '[[entry]]',
    'id = 2',
    'type = "story"',
    'title = "Build the second thing"',
    'after = [1]',
    '',
    '[[entry]]',
    'id = 3',
    'type = "story"',
    'title = "Build the blocked thing"',
    'after = []',
    '',
    '[[entry]]',
    'id = 4',
    'type = "story"',
    'title = "Build the dropped thing"',
    'after = []',
    '',
  ].join('\n'),
  '_bmad-output/initiative-demo/epic-first/story-first-plan.md': '---\ntitle: "Build the first thing"\ntype: "feature"\nticket: 1\nstatus: "in-review"\n---\n',
  '_bmad-output/initiative-demo/epic-first/story-build-the-blocked-thing-plan.md':
    '---\ntitle: "Build the blocked thing"\nticket: 3\nstatus: blocked\nblocked_at: "2026-10-01"\nblocked_reason: "Waits on the payment API"\n---\n',
  '_bmad-output/initiative-demo/epic-first/story-build-the-dropped-thing-plan.md': '---\ntitle: "Build the dropped thing"\nticket: 4\nstatus: dropped\n---\n',
};

function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, ...path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

/**
 * A ready ticket to build (story 5.2; story 5.3 makes it both epics'
 * fixture): ticket `1.1` of `initiative-demo`'s first epic, its plan
 * `ready-for-dev`, waiting for nothing; and `1.2`, ready too but waiting for
 * `1.1` (an unmet prerequisite). With the config script `tickets.py` loads.
 * Add {@link FAKE_TEST_COMMAND_FILES} for a test command to re-run.
 */
export const FAKE_BUILD_PLAN = '_bmad-output/initiative-demo/epic-first/story-build-the-thing-plan.md';
export const FAKE_BUILD_WAITING_PLAN = '_bmad-output/initiative-demo/epic-first/story-build-the-next-thing-plan.md';
export const FAKE_BUILD_TICKET_FILES: Readonly<Record<string, string>> = {
  '_bmad/scripts/config_utils.py': FAKE_TICKET_TREE_FILES['_bmad/scripts/config_utils.py']!,
  '_bmad-output/initiative-demo/tickets.toml': '[[epic]]\nid = 1\nslug = "epic-first"\ntitle = "The first epic"\n',
  '_bmad-output/initiative-demo/epic-first/tickets.toml':
    '[[entry]]\nid = 1\ntype = "story"\ntitle = "Build the thing"\nafter = []\n\n[[entry]]\nid = 2\ntype = "story"\ntitle = "Build the next thing"\nafter = [1]\n',
  [FAKE_BUILD_PLAN]: '---\ntitle: "Build the thing"\ntype: "feature"\nticket: 1\nstatus: ready-for-dev\n---\n\n# Build the thing\n',
  [FAKE_BUILD_WAITING_PLAN]: '---\ntitle: "Build the next thing"\ntype: "feature"\nticket: 2\nstatus: ready-for-dev\n---\n\n# Build the next thing\n',
};

/**
 * A fake test command for verification's re-run (story 5.3; 5.8 and 11.2
 * use it): `package.json`'s `test` script runs one plain Node process that
 * never reads stdin, takes about 50 ms, prints a jest-like summary and
 * passes, or, while `.fake-tests-fail` exists at the project's root (the
 * fake agent writes it with `FAKE_ACP_BUILD_FAIL_TESTS=1`, a test can write
 * it by hand), fails 3 of its 5 tests and exits 1. Removing the file makes
 * it pass again (Check again).
 */
export const FAKE_TESTS_FAIL_MARKER = '.fake-tests-fail';
export const FAKE_TEST_SCRIPT = 'scripts/fake-tests.mjs';
export const FAKE_TEST_COMMAND_FILES: Readonly<Record<string, string>> = {
  'package.json': `${JSON.stringify({ name: 'fake-project', private: true, type: 'module', scripts: { test: `node ${FAKE_TEST_SCRIPT}` } }, null, 2)}\n`,
  [FAKE_TEST_SCRIPT]: [
    "import { existsSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'await new Promise((done) => setTimeout(done, 50));',
    `const failing = existsSync(join(process.cwd(), '${FAKE_TESTS_FAIL_MARKER}'));`,
    "process.stdout.write(failing ? 'Tests: 3 failed, 2 passed, 5 total\\n' : 'Tests: 5 passed, 5 total\\n');",
    'process.exitCode = failing ? 1 : 0;',
    '',
  ].join('\n'),
};

/** The builds fixture with a test command (story 5.8: the verification's re-run needs one). */
export const FAKE_BUILD_REPO_FILES: Readonly<Record<string, string>> = { ...FAKE_BUILD_TICKET_FILES, ...FAKE_TEST_COMMAND_FILES };

/** Runs git in `cwd` for the fixture: no hook, a local identity, no output. */
export function fixtureGit(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', `core.hooksPath=${join(cwd, '.no-hooks')}`, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Creates a fake repo in `parent` (the OS temp folder by default); the caller removes it (`remove()`). */
export function createFakeBmadRepo({ bmad = true, output = false, tickets = false, files = {}, prefix = 'ogden-agents-bmad-repo-', parent = tmpdir(), git = false }: FakeBmadRepoOptions = {}): FakeBmadRepo {
  const path = mkdtempSync(join(parent, prefix));
  writeFiles(path, { 'README.md': '# A project\n' });
  if (bmad) writeFiles(path, FAKE_BMAD_FILES);
  if (output) writeFiles(path, FAKE_BMAD_OUTPUT_FILES);
  if (tickets) writeFiles(path, FAKE_TICKET_TREE_FILES);
  writeFiles(path, files);
  if (git) {
    fixtureGit(path, 'init', '--quiet', '--initial-branch=main');
    // Files as written, LF, whatever the OS's git does by default (Windows runners set core.autocrlf).
    fixtureGit(path, 'config', 'core.autocrlf', 'false');
    fixtureGit(path, 'config', 'user.name', 'Fixture');
    fixtureGit(path, 'config', 'user.email', 'fixture@example.com');
    fixtureGit(path, 'add', '-A');
    fixtureGit(path, 'commit', '--quiet', '--no-verify', '-m', 'The fixture');
  }
  return {
    path,
    hash: () => hashFileTree(path),
    remove: () => rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

/**
 * A SHA-256 over every entry under `root`, in sorted order: each folder by
 * its path, each file by its path and bytes, each link by its path and
 * target (never followed). Any created, removed, renamed or changed entry
 * changes it; timestamps do not.
 */
export function hashFileTree(root: string): string {
  const hash = createHash('sha256');
  const visit = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = relative(root, full).split(sep).join('/');
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) hash.update(`link\0${rel}\0${readlinkSync(full)}\0`);
      else if (stat.isDirectory()) {
        hash.update(`dir\0${rel}\0`);
        visit(full);
      } else hash.update(`file\0${rel}\0${stat.size}\0`).update(readFileSync(full)).update('\0');
    }
  };
  visit(root);
  return hash.digest('hex');
}
