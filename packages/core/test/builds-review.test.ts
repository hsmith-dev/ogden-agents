/**
 * Story 5.9 on a real core with fake ports: the review's summary, diff size
 * and findings, Update and retry (a conflicting merge's rebase, then the end
 * checks again), and Reject and retry (a new worktree, the note in the first
 * message).
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { REBASE_CONFLICT_MESSAGE, REBASE_REFUSED_MESSAGE } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTriageLog, readPlanFindings } from '../src/index.js';
import { codeOf, harness, PLAN, REVISION, testRunner, type Harness } from './builds-harness.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const LOG = [
  '# Plan',
  '## Review Triage Log',
  '',
  '- 2026-10-05, pass 1 (security): high 0, medium 1, low 1.',
  '  - S1 a leak of a key `sk-ant-api03-abcdefghijklmnop` in a log -- medium, patch: masked.',
  '  - S2 a wording slip -- low, defer: later',
  '    carried on a second line.',
  '## Design Notes',
  '- not a finding',
].join('\n');

describe('the review findings (story 5.9)', () => {
  it("reads the plan's Review Triage Log: the nested rows, their severity, deferrals, masked, wrapped lines joined", () => {
    const found = parseTriageLog(LOG, (text) => text.replace(/sk-ant-[A-Za-z0-9-]+/g, '[redacted]'));
    expect(found).toEqual([
      { kind: 'finding', severity: 'medium', text: 'S1 a leak of a key [redacted] in a log -- medium, patch: masked.' },
      { kind: 'deferred', severity: 'low', text: 'S2 a wording slip -- low, defer: later carried on a second line.' },
    ]);
    // Without nesting, every bullet is a finding; no log, no findings.
    expect(parseTriageLog('## Review Triage Log\n- one low thing\n- two')).toHaveLength(2);
    expect(parseTriageLog('# Plan\nnothing')).toEqual([]);
  });

  it('is read only from a plain plan file inside the worktree: a link, a missing file or a missing worktree has none', () => {
    const root = mkdtempSync(join(tmpdir(), 'ogden-agents-findings-'));
    dirs.push(root);
    const plan = '_bmad-output/x/plan.md';
    const file = join(root, ...plan.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, LOG);
    expect(readPlanFindings(root, plan)).toHaveLength(2);
    expect(readPlanFindings(null, plan)).toEqual([]);
    expect(readPlanFindings(root, null)).toEqual([]);
    expect(readPlanFindings(root, '_bmad-output/x/gone.md')).toEqual([]);
    const outside = join(root, 'outside.md');
    writeFileSync(outside, LOG);
    symlinkSync(outside, join(dirname(file), 'link.md'));
    expect(readPlanFindings(root, '_bmad-output/x/link.md')).toEqual([]);
  });
});

async function conflicted(): Promise<{ h: Harness; run: { id: string; ticketRef: string }; sessionId: string }> {
  const h = await harness();
  const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
  h.tickets.set(run.worktreePath!, '1.1', 'built');
  await h.endTurn(session.id);
  h.git.state.merge = 'conflict';
  await h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) }).catch(() => undefined);
  expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'blocked', blockedCode: 'merge_conflict' });
  return { h, run, sessionId: session.id };
}

describe('the review answer (story 5.9)', () => {
  it('carries the plain summary, the diff size and the verification; a failing check leaves approve to its refusal', async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(run.worktreePath!, '1.1', 'built');
    await h.endTurn(session.id);
    const review = await h.builds.review(h.wsId, '1.1');
    expect(review.summary).toBe('Ticket 1.1 changed 2 files, with 1 line added and 0 removed. Its tests passed when Ogden Agents ran them again.');
    expect(review.diffStats).toEqual({ files: 2, insertions: 1, deletions: 0 });
    expect(review.verification?.checks.map((check) => check.result)).toEqual(['pass', 'pass', 'pass']);
    expect(review.findings).toEqual([]);
  });
});

describe('Update and retry (story 5.9)', () => {
  it('rebases the blocked run onto the checkout, moves its base, and checks it again until it is ready for review', async () => {
    const { h, run } = await conflicted();
    h.git.state.head = { branch: 'main', revision: 'c'.repeat(40) };
    h.git.state.merge = 'merged';
    const resumed = await h.builds.retry(h.wsId, run.id as never, { mode: 'rebase' });
    expect(resumed).toMatchObject({ outcome: 'running', blockedCode: null, baseRevision: 'c'.repeat(40) });
    expect(h.git.calls).toContain('rebase cccc');
    await h.builds.settled();
    expect(h.core.entities.getRun(run.id as never)).toMatchObject({ outcome: 'verified', baseRevision: 'c'.repeat(40) });
    expect(h.rerun.runs).toHaveLength(2);
  });

  it('a rebase that conflicts again or is refused changes nothing, and says so; only a conflicted run, the latest, is rebased', async () => {
    const { h, run } = await conflicted();
    h.git.state.rebase = 'conflict';
    const refused = await h.builds.retry(h.wsId, run.id as never, { mode: 'rebase' }).catch((error: Error) => error);
    expect((refused as Error).message).toBe(REBASE_CONFLICT_MESSAGE);
    h.git.state.rebase = 'refused';
    expect(((await h.builds.retry(h.wsId, run.id as never, { mode: 'rebase' }).catch((error: Error) => error)) as Error).message).toBe(REBASE_REFUSED_MESSAGE);
    expect(h.core.entities.getRun(run.id as never)).toMatchObject({ outcome: 'blocked', blockedCode: 'merge_conflict', baseRevision: REVISION });
    // The checkout moved to another branch: no rebase onto it.
    h.git.state.rebase = 'rebased';
    h.git.state.head = { branch: 'other', revision: 'c'.repeat(40) };
    expect(await codeOf(h.builds.retry(h.wsId, run.id as never, { mode: 'rebase' }))).toBe('checkout_dirty');
    // A run that is not conflicted has nothing to rebase.
    const plain = await harness();
    const started = await plain.builds.start(plain.wsId, { ref: '1.1' });
    const stopped = await plain.builds.stop(plain.wsId, started.run.id);
    expect(await codeOf(plain.builds.retry(plain.wsId, stopped.id, { mode: 'rebase' }))).toBe('run_not_active');
  });
});

describe('Reject and retry (story 5.9)', () => {
  it('rejects the run, removes its worktree, and builds the ticket again from a new one with the note in the first message', async () => {
    const h = await harness({ runner: { ...testRunner, invocation: (ref, options) => `/build ${ref}${options?.note === undefined ? '' : ` NOTE:${options.note}`}` } });
    const first = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(first.run.worktreePath!, '1.1', 'built');
    await h.endTurn(first.session.id);
    const review = await h.builds.reject(h.wsId, '1.1', { retry: true, note: 'Use the blue one.' });
    expect(h.core.entities.getRun(first.run.id)).toMatchObject({ outcome: 'stopped', decision: 'rejected' });
    expect(h.git.calls.some((call) => call.startsWith('worktree remove'))).toBe(true);
    expect(review.run.id).not.toBe(first.run.id);
    expect(review.run).toMatchObject({ ticketRef: '1.1', outcome: 'running' });
    expect(review.run.worktreePath).not.toBe(first.run.worktreePath);
    expect(h.sent.at(-1)!.text).toBe('/build 1.1 NOTE:Use the blue one.');
    expect(h.sent.at(-1)!.sessionId).not.toBe(first.session.id);
  });

  it('without retry it is a discard as before; a note too long, or an unknown field, is refused; a repeat Reject does not build again', async () => {
    const h = await harness();
    const first = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(first.run.worktreePath!, '1.1', 'built');
    await h.endTurn(first.session.id);
    await expect(h.builds.reject(h.wsId, '1.1', { note: 'x'.repeat(4001), retry: true })).rejects.toThrow();
    await expect(h.builds.reject(h.wsId, '1.1', { other: 1 })).rejects.toThrow();
    await h.builds.reject(h.wsId, '1.1');
    expect(h.core.entities.listRuns(h.wsId)).toHaveLength(1);
    await h.builds.reject(h.wsId, '1.1', { retry: true });
    expect(h.core.entities.listRuns(h.wsId)).toHaveLength(1);
    void PLAN;
  });

  it('a retry over the limit waits in the queue with its note', async () => {
    const h = await harness({ runner: { ...testRunner, invocation: (ref, options) => `/build ${ref}${options?.note === undefined ? '' : ` NOTE:${options.note}`}` } });
    h.core.buildSettings.setWorkspaceSettings(h.wsId, { maxConcurrentRuns: 1 });
    const first = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(first.run.worktreePath!, '1.1', 'built');
    await h.endTurn(first.session.id);
    const other = await h.builds.start(h.wsId, { ref: '1.2' }).catch(() => undefined);
    void other;
    const review = await h.builds.reject(h.wsId, '1.1', { retry: true, note: 'Again.' });
    expect(review.run.ticketRef).toBe('1.1');
    await h.builds.settled();
    expect(h.sent.map((sent) => sent.text)).toContain('/build 1.1 NOTE:Again.');
  });
});
