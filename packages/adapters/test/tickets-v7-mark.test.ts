/**
 * `tickets-v7`'s mark (story 4.10) with a fake script runner: it runs an
 * exact `find` first, then `mark` with argv only (`--project-root <repo>
 * mark <ref> <status> [--blocked=<reason>]`, the reason one element); an
 * expected status that no longer matches runs no `mark`
 * (`TicketChangedError`); a ref the script resolves to another ticket (a
 * title word) never marks.
 */
import { NotFoundError, StatusNotAllowedError, TicketChangedError, TicketsUnavailableError } from '@ogden-agents/core';
import { describe, expect, it } from 'vitest';
import { createTicketsV7, ScriptRunError, type UvScriptRunner } from '../src/index.js';

const REPO = '/repo';
const SCRIPT = '/verified/tickets.py';
const WORK = '/work';

/** A runner whose `find` answers the ticket `found` names (another ref for a title match) and whose `mark` answers its status. */
function fakeRunner(found: { ref: string; status: string }, { markExit }: { markExit?: number } = {}) {
  const runs: Array<{ script: string; args: readonly string[]; cwd: string | undefined }> = [];
  const runner: UvScriptRunner = {
    run: async (input) => {
      runs.push({ script: input.script, args: input.args, cwd: input.cwd });
      const command = input.args[2];
      if (command === 'find') {
        return { ref: found.ref, id: 2, epic: 'epic-a', title: 'Two', type: 'story', status: found.status, state: 'planned', blocked_reason: '', file: null, plan: null };
      }
      if (command === 'mark') {
        if (markExit !== undefined) throw new ScriptRunError('failed', { exitCode: markExit });
        return { ref: input.args[3], status: input.args[4] };
      }
      throw new Error(`unexpected ${String(command)}`);
    },
    close: async () => {},
  };
  return { runs, runner };
}

const store = (runner: UvScriptRunner) => createTicketsV7({ runner, script: () => SCRIPT, workDir: WORK });

describe('tickets-v7 mark (story 4.10)', () => {
  it('finds the exact ticket, then marks it with argv only; the blocked reason is one element', async () => {
    const { runs, runner } = fakeRunner({ ref: '1.2', status: '' });
    const reason = 'Needs the API key\nstatus: done';
    expect(await store(runner).mark(REPO, '1.2', 'blocked', { blockedReason: reason, expectedStatus: '' })).toEqual({ ref: '1.2', status: 'blocked' });
    expect(runs.map((run) => run.args)).toEqual([
      ['--project-root', REPO, 'find', '1.2'],
      ['--project-root', REPO, 'mark', '1.2', 'blocked', `--blocked=${reason}`],
    ]);
    expect(runs.every((run) => run.script === SCRIPT && run.cwd === WORK)).toBe(true);
  });

  it('without a reason, mark gets no --blocked', async () => {
    const { runs, runner } = fakeRunner({ ref: '1.2', status: '' });
    await store(runner).mark(REPO, '1.2', 'ready-for-dev');
    expect(runs.at(-1)!.args).toEqual(['--project-root', REPO, 'mark', '1.2', 'ready-for-dev']);
  });

  it('an expected status that no longer matches is TicketChangedError and no mark runs', async () => {
    const { runs, runner } = fakeRunner({ ref: '1.2', status: 'in-progress' });
    const error = await store(runner)
      .mark(REPO, '1.2', 'ready-for-dev', { expectedStatus: '' })
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TicketChangedError);
    expect(runs.map((run) => run.args[2])).toEqual(['find']);
    // The status the plan has matches: it marks.
    await store(runner).mark(REPO, '1.2', 'ready-for-dev', { expectedStatus: 'in-progress' });
    expect(runs.map((run) => run.args[2])).toEqual(['find', 'find', 'mark']);
  });

  it('a ref the script resolves to another ticket (a title word) never marks; a malformed ref runs nothing', async () => {
    const { runs, runner } = fakeRunner({ ref: '1.3', status: '' });
    await expect(store(runner).mark(REPO, '1.2', 'ready-for-dev')).rejects.toThrow(NotFoundError);
    await expect(store(runner).mark(REPO, 'Two', 'ready-for-dev')).rejects.toThrow(NotFoundError);
    await expect(store(runner).mark(REPO, '-h', 'ready-for-dev')).rejects.toThrow(NotFoundError);
    expect(runs.map((run) => run.args.slice(2))).toEqual([
      ['find', '1.2'],
      ['find', 'Two'],
    ]);
  });

  it('done is refused before anything runs', async () => {
    const { runs, runner } = fakeRunner({ ref: '1.2', status: '' });
    await expect(store(runner).mark(REPO, '1.2', 'done')).rejects.toThrow(StatusNotAllowedError);
    expect(runs).toEqual([]);
  });

  it('a tracker store (exit 2) is store_refused', async () => {
    const { runner } = fakeRunner({ ref: '1.2', status: '' }, { markExit: 2 });
    const error = await store(runner)
      .mark(REPO, '1.2', 'ready-for-dev')
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TicketsUnavailableError);
    expect((error as TicketsUnavailableError).reason).toBe('store_refused');
  });
});
