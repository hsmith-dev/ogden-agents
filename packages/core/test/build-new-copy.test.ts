/**
 * Epic 26: what a build's new copy gets before its agent starts. The copy on
 * a real file system (with a fake `ignoredPaths`), and the start, Retry and
 * attended paths through the builds harness (fake ports: no real git,
 * sandbox or agent).
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { blockedSentence } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { attendedSetupNote, copyIgnoredFiles } from '../src/build-new-copy.js';
import { codeOf, harness, testRunner } from './builds-harness.js';
import { tempDir } from './helpers.js';

const listing = (paths: string[]) => ({ ignoredPaths: async (_repo: string, patterns: readonly string[]) => (patterns.length === 0 ? [] : paths) });

describe('copying ignored files into a new copy (E26-R1)', () => {
  it('copies listed files and folders, keeps the links inside a folder as links, and skips what the worktree already has', async () => {
    const repo = realpathSync.native(tempDir('ogden-copy-repo-'));
    const worktree = realpathSync.native(tempDir('ogden-copy-wt-'));
    writeFileSync(join(repo, '.env'), 'KEY=value\n');
    mkdirSync(join(repo, 'node_modules', '.pnpm', 'a@1'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', '.pnpm', 'a@1', 'index.js'), 'module.exports = 1;\n');
    symlinkSync(join('.pnpm', 'a@1'), join(repo, 'node_modules', 'a'));
    writeFileSync(join(repo, 'committed.txt'), 'main checkout edit\n');
    writeFileSync(join(worktree, 'committed.txt'), 'as committed\n');

    const result = await copyIgnoredFiles(listing(['.env', 'node_modules', 'committed.txt']), repo, worktree, ['.env', 'node_modules', 'committed.txt']);

    expect(result.copied).toEqual(['.env', 'node_modules']);
    expect(result.skipped).toEqual(['committed.txt']);
    expect(readFileSync(join(worktree, '.env'), 'utf8')).toBe('KEY=value\n');
    expect(lstatSync(join(worktree, 'node_modules', 'a')).isSymbolicLink()).toBe(true);
    // Relative, as it was: it points inside the copy, never back at the main checkout.
    expect(readlinkSync(join(worktree, 'node_modules', 'a'))).toBe(join('.pnpm', 'a@1'));
    expect(readFileSync(join(worktree, 'node_modules', 'a', 'index.js'), 'utf8')).toContain('module.exports');
    expect(readFileSync(join(worktree, 'committed.txt'), 'utf8')).toBe('as committed\n');
  });

  it('does nothing and asks git nothing with no patterns', async () => {
    const asked: string[][] = [];
    const vcs = { ignoredPaths: async (_repo: string, patterns: readonly string[]) => (asked.push([...patterns]), ['.env']) };
    expect(await copyIgnoredFiles(vcs, tempDir('ogden-copy-repo-'), tempDir('ogden-copy-wt-'), [])).toEqual({ copied: [], skipped: [] });
    expect(asked).toEqual([]);
  });

  it('never copies a link, a protected name, a path through a linked folder, or into a committed link', async () => {
    const repo = realpathSync.native(tempDir('ogden-copy-repo-'));
    const worktree = realpathSync.native(tempDir('ogden-copy-wt-'));
    const outside = realpathSync.native(tempDir('ogden-copy-outside-'));
    writeFileSync(join(outside, 'secret'), 'not yours\n');
    symlinkSync(join(outside, 'secret'), join(repo, 'linked.env'));
    symlinkSync(outside, join(repo, 'elsewhere'));
    mkdirSync(join(repo, '.claude'));
    writeFileSync(join(repo, '.claude', 'settings.local.json'), '{}');
    mkdirSync(join(repo, 'app'));
    writeFileSync(join(repo, 'app', '.env'), 'APP=1\n');
    // The worktree's `app` is a committed link out of it: nothing may be written through it.
    symlinkSync(outside, join(worktree, 'app'));

    const result = await copyIgnoredFiles(listing(['linked.env', 'elsewhere/secret', '.claude/settings.local.json', 'app/.env', '../up']), repo, worktree, ['*']);

    expect(result.copied).toEqual([]);
    expect(result.skipped).toEqual(['linked.env', 'elsewhere/secret', '.claude/settings.local.json', 'app/.env', '../up']);
    expect(existsSync(join(worktree, 'linked.env'))).toBe(false);
    expect(existsSync(join(worktree, '.claude'))).toBe(false);
    expect(existsSync(join(outside, '.env'))).toBe(false);
  });
});

describe('the setup command in a build (E26-R2)', () => {
  it('copies the files, runs the setup in the run sandbox before the prompt, then the tests use the same sandbox', async () => {
    const h = await harness();
    h.core.buildSettings.setWorkspaceSettings(h.wsId, { copyPatterns: ['.env'], setupCommand: 'pnpm install --offline' });
    const { run } = await h.builds.start(h.wsId, { ref: '1.1' });
    expect(h.git.calls).toContain('ignored .env');
    expect(h.rerun.runs.map((each) => each.command)).toEqual(['pnpm install --offline']);
    const [setup] = h.rerun.runs;
    expect(setup!.cwd).toBe(run.worktreePath);
    expect(setup!.env.PATH).toBe('/bin');
    expect(run.outcome).toBe('running');
    expect(h.sent).toHaveLength(1);
  });

  it('a failed setup blocks the run with its exit code and masked output, sends no prompt, and Retry runs it again', async () => {
    const h = await harness();
    h.core.buildSettings.setWorkspaceSettings(h.wsId, { setupCommand: 'make deps' });
    h.rerun.result = { exitCode: 2, timedOut: false, output: 'make: *** No rule to make target deps.\n' };
    const { run } = await h.builds.start(h.wsId, { ref: '1.1' });
    expect(run).toMatchObject({ outcome: 'blocked', blockedCode: 'setup_failed' });
    expect(run.reason).toContain(blockedSentence('setup_failed'));
    expect(run.reason).toContain('exited with code 2');
    expect(run.reason).toContain('No rule to make target deps');
    expect(h.sent).toEqual([]);
    // The worktree stays for Retry.
    expect(existsSync(run.worktreePath!)).toBe(true);

    // Still failing: refused, still blocked, still no prompt.
    expect(await codeOf(h.builds.retry(h.wsId, run.id, {}))).toBe('setup_failed');
    expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'blocked', blockedCode: 'setup_failed' });
    expect(h.sent).toEqual([]);

    h.rerun.result = { exitCode: 0, timedOut: false, output: '' };
    await h.builds.retry(h.wsId, run.id, {});
    expect(h.rerun.runs.map((each) => each.command)).toEqual(['make deps', 'make deps', 'make deps']);
    expect(h.sent).toHaveLength(1);
  });

  it('with no sandbox able to run it, the setup fails closed', async () => {
    const h = await harness();
    h.core.buildSettings.setWorkspaceSettings(h.wsId, { setupCommand: 'make deps' });
    h.rerun.result = undefined;
    const { run } = await h.builds.start(h.wsId, { ref: '1.1' });
    expect(run).toMatchObject({ outcome: 'blocked', blockedCode: 'setup_failed' });
    expect(run.reason).toContain('No sandbox here could run it');
  });

  it('an attended run never runs it itself: its first message asks the agent, so it comes as a card', async () => {
    const h = await harness({ runner: { ...testRunner, invocation: (ref, options) => `/build ${ref}\n${options?.note ?? ''}` } });
    h.sandbox.available = false;
    h.core.buildSettings.setWorkspaceSettings(h.wsId, { setupCommand: 'npm ci' });
    await h.builds.start(h.wsId, { ref: '1.1', mode: 'attended' });
    expect(h.rerun.runs).toEqual([]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.text).toContain('`npm ci`');
  });

  it('with no setup command nothing runs before the prompt', async () => {
    const h = await harness();
    await h.builds.start(h.wsId, { ref: '1.1' });
    expect(h.rerun.runs).toEqual([]);
    // No patterns: git is not even asked.
    expect(h.git.calls.some((call) => call.startsWith('ignored'))).toBe(false);
    expect(h.sent).toHaveLength(1);
  });

  it("the attended note puts the setup first and keeps the user's own note", () => {
    expect(attendedSetupNote('npm ci', undefined)).toMatch(/^Before you start, .*`npm ci`$/);
    expect(attendedSetupNote('npm ci', 'Mind the tests.')).toMatch(/`npm ci`\n\nMind the tests\.$/);
  });
});
