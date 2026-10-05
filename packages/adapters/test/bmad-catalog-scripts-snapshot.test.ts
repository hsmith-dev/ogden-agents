/**
 * The private snapshot of a trusted project's BMad Method scripts (the
 * maintained-fork story; closes the 4.13 check-then-use entry): the scripts
 * are read once, checked against the trusted fingerprint, and those bytes are
 * written into a fresh owner-only run folder that `tickets.py` imports from
 * (`--config-utils`). A change after the check never runs; scripts that no
 * longer match are `ScriptsChangedError` and nothing is written.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { ScriptsChangedError } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBmadRepo, FAKE_TICKET_TREE_FILES, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { scriptsFingerprint } from '../src/bmad-catalog/scripts-fingerprint.js';
import { createScriptsSnapshotter, createTicketsV7, type UvScriptRunner } from '../src/index.js';

const SCRIPT = '_bmad/scripts/config_utils.py';
const ORIGINAL = FAKE_TICKET_TREE_FILES[SCRIPT]!;
const PLANTED = `open("planted-ran", "w").write("ran")\n${ORIGINAL}`;

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const repo = (files: Record<string, string> = { [SCRIPT]: ORIGINAL, '_bmad/scripts/helper.py': 'x = 1\n' }, bmad = true): FakeBmadRepo => {
  const made = createFakeBmadRepo({ bmad, files });
  cleanups.push(() => made.remove());
  return made;
};
const runsRoot = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-script-runs-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'bmad-script-runs');
};
const posix = process.platform !== 'win32';

describe('the script snapshot (maintained-fork story)', () => {
  it('writes the checked files into a fresh owner-only folder outside the repo, and removes it on dispose', async () => {
    const r = repo();
    const root = runsRoot();
    const snapshot = await createScriptsSnapshotter(root)(r.path, (await scriptsFingerprint(r.path))!);
    expect(relative(root, snapshot.dir).startsWith('..')).toBe(false);
    expect(relative(r.path, snapshot.dir).startsWith('..')).toBe(true);
    expect(snapshot.configUtils).toBe(join(snapshot.dir, 'config_utils.py'));
    expect(readFileSync(snapshot.configUtils, 'utf8')).toBe(ORIGINAL);
    expect(readFileSync(join(snapshot.dir, 'helper.py'), 'utf8')).toBe('x = 1\n');
    if (posix) {
      expect(statSync(snapshot.dir).mode & 0o777).toBe(0o700);
      expect(statSync(snapshot.configUtils).mode & 0o777).toBe(0o600);
    }
    await snapshot.dispose();
    expect(existsSync(snapshot.dir)).toBe(false);
  });

  it('scripts that no longer match the trusted fingerprint are ScriptsChangedError and nothing is written', async () => {
    const r = repo();
    const trusted = (await scriptsFingerprint(r.path))!;
    writeFileSync(join(r.path, SCRIPT), PLANTED);
    const root = runsRoot();
    await expect(createScriptsSnapshotter(root)(r.path, trusted)).rejects.toBeInstanceOf(ScriptsChangedError);
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });

  it.skipIf(!posix)('scripts it cannot hash (a link) are ScriptsChangedError', async () => {
    const r = repo();
    const trusted = (await scriptsFingerprint(r.path))!;
    rmSync(join(r.path, SCRIPT));
    symlinkSync(join(r.path, '_bmad', 'scripts', 'helper.py'), join(r.path, SCRIPT));
    await expect(createScriptsSnapshotter(runsRoot())(r.path, trusted)).rejects.toBeInstanceOf(ScriptsChangedError);
  });

  it("a project with no _bmad/scripts/ ('none') gets an empty folder, so a config script that appears later is never read", async () => {
    const r = repo({});
    const snapshot = await createScriptsSnapshotter(runsRoot())(r.path, 'none');
    expect(readdirSync(snapshot.dir)).toEqual([]);
    mkdirSync(join(r.path, '_bmad', 'scripts'), { recursive: true });
    writeFileSync(join(r.path, SCRIPT), PLANTED);
    expect(existsSync(snapshot.configUtils)).toBe(false);
    await snapshot.dispose();
  });

  it('clears run folders an earlier server left behind on its first snapshot', async () => {
    const root = runsRoot();
    mkdirSync(join(root, 'run-leftover'), { recursive: true });
    const r = repo();
    const snapshot = await createScriptsSnapshotter(root)(r.path, (await scriptsFingerprint(r.path))!);
    expect(readdirSync(root)).toEqual([relative(root, snapshot.dir)]);
    await snapshot.dispose();
  });

  it('tickets-v7: a config_utils.py swapped in after the check never runs; the run imports the checked bytes', async () => {
    const r = repo();
    const trusted = (await scriptsFingerprint(r.path))!;
    const seen: Array<{ args: readonly string[]; imported: string }> = [];
    const runner: UvScriptRunner = {
      run: async (input) => {
        // The swap lands after the check and the snapshot, right before Python would import the config script.
        writeFileSync(join(r.path, SCRIPT), PLANTED);
        const configUtils = input.args[input.args.indexOf('--config-utils') + 1]!;
        seen.push({ args: input.args, imported: readFileSync(configUtils, 'utf8') });
        return { tickets: [], problems: [] };
      },
      close: async () => {},
    };
    const work = runsRoot();
    mkdirSync(work, { recursive: true });
    const root = runsRoot();
    const store = createTicketsV7({ runner, snapshot: createScriptsSnapshotter(root), script: () => '/verified/tickets.py', workDir: work });
    await store.tree(r.path, { scripts: trusted });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.args.slice(0, 3)).toEqual(['--project-root', r.path, '--config-utils']);
    expect(seen[0]!.imported).toBe(ORIGINAL);
    expect(readFileSync(join(r.path, SCRIPT), 'utf8')).toBe(PLANTED);
    // The run folder is gone once the run ends.
    expect(readdirSync(root)).toEqual([]);

    // The next run checks again: the planted script no longer matches the trust, so nothing runs.
    await expect(store.tree(r.path, { scripts: trusted })).rejects.toBeInstanceOf(ScriptsChangedError);
    expect(seen).toHaveLength(1);
  });
});
