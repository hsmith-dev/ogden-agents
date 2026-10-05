/**
 * A ticket's checkpoint flags (story 5.4): read-only from its entry in its
 * epic's `tickets.toml`, since `tickets.py find` doesn't report them; a
 * link, a file outside the repo, a file too large or no such entry reads
 * as no checkpoints.
 */
import { fakeSnapshot, GUARD } from './snapshot-fake.js';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTicketsV7, type UvScriptRunner } from '../src/index.js';
import { checkpointsFromToml, MAX_TICKETS_TOML_BYTES, readTicketCheckpoints } from '../src/tickets-v7/checkpoints.js';

const TOML = `# the epic's tickets
[[entry]]
id = 1
title = "First"
plan_checkpoint = true # check the plan
done_checkpoint = false

[[entry]]
id = 2
title = "plan_checkpoint = true"
done_checkpoint = true

[[entry]]
id = "leaf"
plan_checkpoint = true

[notes]
plan_checkpoint = true
`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-checkpoints-'));
  dirs.push(dir);
  return dir;
};

describe('checkpoint flags from tickets.toml (story 5.4)', () => {
  it("reads only the entry whose id is the ticket's", () => {
    expect(checkpointsFromToml(TOML, 1)).toEqual({ plan_checkpoint: true, done_checkpoint: false });
    expect(checkpointsFromToml(TOML, 2)).toEqual({ plan_checkpoint: false, done_checkpoint: true });
    expect(checkpointsFromToml(TOML, 'leaf')).toEqual({ plan_checkpoint: true, done_checkpoint: false });
    expect(checkpointsFromToml(TOML, 9)).toEqual({ plan_checkpoint: false, done_checkpoint: false });
    expect(checkpointsFromToml('plan_checkpoint = true\n', 1)).toEqual({ plan_checkpoint: false, done_checkpoint: false });
    // A multi-line string's lines are never keys or headers; a nested array's line is not a header.
    const multi = `[[entry]]\nid = 3\ndescription = \"\"\"\n[a link](x)\nplan_checkpoint = true\n\"\"\"\nmatrix = [\n  [\"a\"],\n]\ndone_checkpoint = true\n`;
    expect(checkpointsFromToml(multi, 3)).toEqual({ plan_checkpoint: false, done_checkpoint: true });
    expect(checkpointsFromToml(`[[entry]]\nid = 4\nnote = '''one line'''\nplan_checkpoint = true\n`, 4)).toEqual({ plan_checkpoint: true, done_checkpoint: false });
  });

  it('reads the file beside the epic file inside the repo; never a link, a file outside it or one too large', async () => {
    const repo = temp();
    const epic = join(repo, '_bmad-output', 'init', 'epic-one');
    mkdirSync(epic, { recursive: true });
    writeFileSync(join(epic, 'tickets.toml'), TOML);
    const epicFile = join(epic, 'epic-one.md');
    expect(await readTicketCheckpoints(repo, epicFile, 1)).toEqual({ plan_checkpoint: true, done_checkpoint: false });
    expect(await readTicketCheckpoints(repo, null, 1)).toEqual({ plan_checkpoint: false, done_checkpoint: false });
    expect(await readTicketCheckpoints(repo, 'relative/epic.md', 1)).toEqual({ plan_checkpoint: false, done_checkpoint: false });
    expect(await readTicketCheckpoints(repo, epicFile, null)).toEqual({ plan_checkpoint: false, done_checkpoint: false });

    const outside = temp();
    writeFileSync(join(outside, 'tickets.toml'), TOML);
    expect(await readTicketCheckpoints(repo, join(outside, 'epic.md'), 1)).toEqual({ plan_checkpoint: false, done_checkpoint: false });

    if (process.platform !== 'win32') {
      const linked = join(repo, '_bmad-output', 'init', 'epic-two');
      mkdirSync(linked, { recursive: true });
      symlinkSync(join(outside, 'tickets.toml'), join(linked, 'tickets.toml'));
      expect(await readTicketCheckpoints(repo, join(linked, 'epic-two.md'), 1)).toEqual({ plan_checkpoint: false, done_checkpoint: false });
    }

    writeFileSync(join(epic, 'tickets.toml'), `${TOML}${'#'.repeat(MAX_TICKETS_TOML_BYTES)}`);
    expect(await readTicketCheckpoints(repo, epicFile, 1)).toEqual({ plan_checkpoint: false, done_checkpoint: false });
  });
});

describe("tickets-v7 find carries the entry's checkpoint flags (story 5.4)", () => {
  it('from the tickets.toml beside the epic file find reports', async () => {
    const repo = temp();
    const epic = join(repo, '_bmad-output', 'init', 'epic-one');
    mkdirSync(epic, { recursive: true });
    writeFileSync(join(epic, 'tickets.toml'), TOML);
    const runner: UvScriptRunner = {
      run: async (input) => ({ ref: input.args.find((arg) => /^1\.[12]$/.test(arg)), id: input.args.find((arg) => /^1\.[12]$/.test(arg)) === '1.1' ? 1 : 2, epic: 'epic-one', title: 'One', type: 'story', status: 'ready-for-dev', state: 'planned', blocked_reason: '', file: null, plan: null, epic_file: join(epic, 'epic-one.md') }),
      close: async () => {},
    };
    const tickets = createTicketsV7({ runner, snapshot: fakeSnapshot, script: () => '/verified/tickets.py', workDir: temp() });
    expect(await tickets.find(repo, '1.1', GUARD)).toMatchObject({ plan_checkpoint: true, done_checkpoint: false });
    expect(await tickets.find(repo, '1.2', GUARD)).toMatchObject({ plan_checkpoint: false, done_checkpoint: true });
  });
});
