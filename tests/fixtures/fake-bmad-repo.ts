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
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

export interface FakeBmadRepoOptions {
  /** Create `_bmad/` (with a config file and one skill). Default `true`. */
  bmad?: boolean;
  /** Create `_bmad-output/` (with one planning artifact). Default `false`. */
  output?: boolean;
  /** More files, by `/`-separated path relative to the repo, such as the user's own `.claude/skills`. */
  files?: Readonly<Record<string, string>>;
  /** The temp folder's name prefix. Default `ogden-agents-bmad-repo-`. */
  prefix?: string;
  /** The folder the repo is created in. Default: the OS temp folder. A suite that sweeps its own folder passes it (story 10.8). */
  parent?: string;
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

function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, ...path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

/** Creates a fake repo in `parent` (the OS temp folder by default); the caller removes it (`remove()`). */
export function createFakeBmadRepo({ bmad = true, output = false, files = {}, prefix = 'ogden-agents-bmad-repo-', parent = tmpdir() }: FakeBmadRepoOptions = {}): FakeBmadRepo {
  const path = mkdtempSync(join(parent, prefix));
  writeFiles(path, { 'README.md': '# A project\n' });
  if (bmad) writeFiles(path, FAKE_BMAD_FILES);
  if (output) writeFiles(path, FAKE_BMAD_OUTPUT_FILES);
  writeFiles(path, files);
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
