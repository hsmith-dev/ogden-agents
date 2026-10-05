/**
 * A build run's folder (story 5.4): the per-run result is validated before
 * it is written and replaced whole; the activity recorder writes only build
 * runs' session streams, masked, without message deltas, and stops at its
 * bound with one `activity.truncated` line.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD_ACTIVITY_FILE, BUILD_RESULT_FILE, type BuildRunResult, type RunId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createRunActivityRecorder, runFolderOf, writeRunResult } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const RUN = 'run_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as RunId;
const result = (overrides: Partial<BuildRunResult> = {}): BuildRunResult => ({
  version: 1,
  runId: RUN,
  ticketRef: '1.1',
  status: 'built',
  commit: 'a'.repeat(40),
  baseRevision: 'b'.repeat(40),
  blockedCondition: null,
  blockedReason: null,
  intentGapPatch: null,
  networkFailure: false,
  endedAt: '2026-10-04T12:00:00.000Z',
  ...overrides,
});

describe('the per-run result (story 5.4)', () => {
  it('is written whole in the run folder, replaced on the next write, and refused when invalid', async () => {
    const data = tempDir('ogden-agents-run-folder-');
    const folder = runFolderOf(data, RUN);
    expect(folder).toBe(join(data, 'r', RUN));
    expect(() => runFolderOf(data, '../escape')).toThrow();
    await writeRunResult(folder, result());
    await writeRunResult(folder, result({ status: 'blocked', blockedCondition: 'intent gap' }));
    expect(JSON.parse(readFileSync(join(folder, BUILD_RESULT_FILE), 'utf8'))).toMatchObject({ status: 'blocked', blockedCondition: 'intent gap' });
    expect(readdirSync(folder)).toEqual([BUILD_RESULT_FILE]);
    if (process.platform !== 'win32') {
      expect(statSync(folder).mode & 0o777).toBe(0o700);
      expect(statSync(join(folder, BUILD_RESULT_FILE)).mode & 0o777).toBe(0o600);
    }
    await expect(writeRunResult(folder, result({ intentGapPatch: '../outside.patch' }))).rejects.toThrow();
    await expect(writeRunResult(folder, result({ commit: 'not a commit' }))).rejects.toThrow();
    expect(JSON.parse(readFileSync(join(folder, BUILD_RESULT_FILE), 'utf8')).status).toBe('blocked');
    expect(readdirSync(folder)).toEqual([BUILD_RESULT_FILE]);
  });
});

describe('the activity recorder (story 5.4)', () => {
  it("records a build run's session stream masked, skips deltas and chats, notes a network failure and stops at its bound", async () => {
    const data = tempDir('ogden-agents-activity-');
    const core = openTestCore(data);
    const ws = core.entities.ensureWorkspace(tempDir('ogden-agents-activity-repo-'));
    const recorder = createRunActivityRecorder({ events: core.events, entities: core.entities, dataDir: data, mask: (text) => text.replaceAll('SECRET', '[hidden]'), maxBytes: 1500 });
    const chat = core.entities.createSession({ workspaceId: ws.id, kind: 'chat' });
    const build = core.entities.createSession({ workspaceId: ws.id, kind: 'build' });
    const run = core.entities.createRun({ sessionId: build.id, ticketRef: '1.1', worktreePath: data, sandbox: 'test', branch: null, baseRevision: null, agent: 'claude-code' });
    const say = (sessionId: typeof build.id, text: string) =>
      core.sessionEvents.appendSessionEvent(sessionId, { type: 'session.message_completed', payload: { messageId: `m${Math.random()}`, role: 'agent', content: text } } as never);
    say(chat.id, 'not a build');
    say(build.id, 'npm ERR! getaddrinfo ENOTFOUND registry.npmjs.org SECRET');
    core.entities.setRunOutcome(run.id, 'blocked', 'stopped');
    await recorder.flushed();
    const file = join(runFolderOf(data, run.id), BUILD_ACTIVITY_FILE);
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { type: string });
    expect(lines.map((line) => line.type)).toEqual(expect.arrayContaining(['session.message_completed', 'run.outcome_changed']));
    expect(readFileSync(file, 'utf8')).not.toContain('SECRET');
    expect(readFileSync(file, 'utf8')).not.toContain('not a build');
    expect(recorder.networkFailure(run.id)).toBe(true);
    expect(existsSync(runFolderOf(data, 'run_01J9Z3K4M5N6P7Q8R9S0T1V2W4'))).toBe(false);
    for (let index = 0; index < 20; index += 1) say(build.id, 'x'.repeat(100));
    await recorder.flushed();
    const text = readFileSync(file, 'utf8');
    expect(Buffer.byteLength(text)).toBeLessThan(1600);
    expect(text.trim().split('\n').at(-1)).toBe('{"type":"activity.truncated"}');
    recorder.close();
    core.close();
  });
});
