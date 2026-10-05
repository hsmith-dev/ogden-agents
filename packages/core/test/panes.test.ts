/**
 * Terminal panes in core (epic 16, story 16.2; E16-R1, R3): the Developer
 * mode gate, the limits, the pane's life (starting, running, exited, Restart
 * pane, close), viewers and their sizes. Core depends on no adapter, so the
 * port is core's own fake terminal (`support/fake-terminal.ts`).
 */
import type { Pane } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createPanes, DeveloperModeRequiredError, NotFoundError, PaneLimitError, TerminalUnavailableError, type Panes, type PanesOptions } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';
import { fakeTerminal, type FakeTerminalOptions } from './support/fake-terminal.js';

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function setup(options: { developerMode?: boolean; terminal?: FakeTerminalOptions; limits?: PanesOptions['limits']; withPort?: boolean } = {}) {
  const core = openTestCore();
  const repo = tempDir('ogden-agents-repo-');
  const workspace = core.entities.ensureWorkspace(repo);
  const other = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  const fake = fakeTerminal(options.terminal);
  if (options.developerMode !== false) core.installSettings.setDeveloperMode(true);
  const errors: unknown[] = [];
  const panes: Panes = createPanes({
    entities: core.entities,
    installSettings: core.installSettings,
    events: core.events,
    terminal: options.withPort === false ? undefined : fake.port,
    shell: () => ({ file: '/bin/fake-shell', args: ['-l'] }),
    env: () => ({ PATH: '/usr/bin' }),
    onError: (error) => errors.push(error),
    limits: options.limits,
  });
  stops.push(() => panes.dispose());
  return { core, workspace, other, panes, fake, errors, repo };
}

const SIZE = { cols: 100, rows: 30 };

describe('Developer mode gates every operation in core (E16-R3)', () => {
  it('refuses every operation without it, and starts nothing', async () => {
    const { panes, workspace, fake } = setup({ developerMode: false });
    await expect(panes.open(workspace.id, SIZE)).rejects.toBeInstanceOf(DeveloperModeRequiredError);
    expect(() => panes.list(workspace.id)).toThrow(DeveloperModeRequiredError);
    expect(() => panes.attach('pan_01J9Z3K4M5N6P7Q8R9S0T1V2W3')).toThrow(DeveloperModeRequiredError);
    expect(() => panes.close(workspace.id, 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W3')).toThrow(DeveloperModeRequiredError);
    await expect(panes.restart(workspace.id, 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W3', SIZE)).rejects.toBeInstanceOf(DeveloperModeRequiredError);
    expect(fake.processes).toEqual([]);
  });

  it('stops every pane when Developer mode is turned off, and tells their viewers', async () => {
    const { panes, workspace, fake, core } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    const closed: string[] = [];
    panes.attach(pane.id)!.onClose(() => closed.push('closed'));
    core.installSettings.setDeveloperMode(false);
    expect(fake.processes[0]!.kills()).toBe(1);
    expect(closed).toEqual(['closed']);
    expect(panes.count()).toBe(0);
  });
});

describe('opening a pane', () => {
  it('starts the shell in the project folder with the given environment and size, as starting, then running once it prints', async () => {
    const { panes, workspace, fake, repo } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    expect(pane).toMatchObject({ launcherId: 'shell', title: 'Terminal 1', state: 'starting', exitCode: null, workspaceId: workspace.id });
    expect(fake.processes[0]!.input).toMatchObject({ file: '/bin/fake-shell', args: ['-l'], env: { PATH: '/usr/bin' }, cols: 100, rows: 30 });
    expect(fake.processes[0]!.input.cwd).toContain(repo.split(/[\\/]/).pop()!);
    const viewer = panes.attach(pane.id)!;
    expect(viewer.pane.state).toBe('starting');
    const states: string[] = [];
    viewer.onState((p) => states.push(p.state));
    fake.processes[0]!.print('prompt> ');
    expect(states).toEqual(['running']);
    fake.processes[0]!.print('more');
    expect(states).toEqual(['running']);
  });

  it('is exited, with its own exit code, when the program ends by itself', async () => {
    const { panes, workspace, fake } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    const viewer = panes.attach(pane.id)!;
    const seen: Pane[] = [];
    viewer.onState((p) => seen.push(p));
    fake.processes[0]!.exit(7);
    expect(seen.at(-1)).toMatchObject({ state: 'exited', exitCode: 7 });
    expect(panes.list(workspace.id)[0]).toMatchObject({ state: 'exited', exitCode: 7 });
  });

  it('numbers panes per project, reusing the lowest free number', async () => {
    const { panes, workspace, other } = setup();
    const first = await panes.open(workspace.id, SIZE);
    const second = await panes.open(workspace.id, SIZE);
    const foreign = await panes.open(other.id, SIZE);
    expect([first.title, second.title, foreign.title]).toEqual(['Terminal 1', 'Terminal 2', 'Terminal 1']);
    panes.close(workspace.id, first.id);
    expect((await panes.open(workspace.id, SIZE)).title).toBe('Terminal 1');
  });

  it('refuses an unknown project, and a pane that is another project\'s', async () => {
    const { panes, workspace, other } = setup();
    await expect(panes.open('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', SIZE)).rejects.toBeInstanceOf(NotFoundError);
    const pane = await panes.open(workspace.id, SIZE);
    expect(() => panes.close(other.id, pane.id)).toThrow(NotFoundError);
    expect(panes.list(other.id)).toEqual([]);
    expect(panes.list(workspace.id)).toHaveLength(1);
  });

  it('refuses past the limits, per project and per install, and frees a slot on close', async () => {
    const { panes, workspace, other } = setup({ limits: { perProject: 2, perInstall: 3 } });
    const a = await panes.open(workspace.id, SIZE);
    await panes.open(workspace.id, SIZE);
    await expect(panes.open(workspace.id, SIZE)).rejects.toMatchObject({ scope: 'project', limit: 2 });
    await panes.open(other.id, SIZE);
    await expect(panes.open(other.id, SIZE)).rejects.toMatchObject({ scope: 'install', limit: 3 });
    panes.close(workspace.id, a.id);
    await expect(panes.open(other.id, SIZE)).resolves.toMatchObject({ state: 'starting' });
    expect(PaneLimitError.name).toBe('PaneLimitError');
  });

  it('can not pass the limit with a burst of opens at once', async () => {
    const { panes, workspace } = setup({ limits: { perProject: 2 }, terminal: { opening: () => new Promise((resolve) => setTimeout(resolve, 5)) } });
    const results = await Promise.allSettled([panes.open(workspace.id, SIZE), panes.open(workspace.id, SIZE), panes.open(workspace.id, SIZE), panes.open(workspace.id, SIZE)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(panes.list(workspace.id)).toHaveLength(2);
  });

  it('opens nothing and says why in plain words when the terminal cannot start (AD-19)', async () => {
    const { panes, workspace } = setup({ terminal: { available: { ok: false, reason: 'no prebuilt terminal for this platform' } } });
    await expect(panes.open(workspace.id, SIZE)).rejects.toMatchObject({ terminalCode: 'pty_unavailable', message: expect.stringContaining('no prebuilt terminal') });
    expect(panes.count()).toBe(0);
    expect(await panes.available()).toEqual({ ok: false, reason: 'no prebuilt terminal for this platform' });
  });

  it('leaves nothing open, and a reason without a path, when the program cannot be spawned', async () => {
    const { panes, workspace } = setup({ terminal: { openError: new Error('File not found: C:\\Users\\someone\\bin\\shell.exe') } });
    const refused = await panes.open(workspace.id, SIZE).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(TerminalUnavailableError);
    expect((refused as Error).message).not.toContain('someone');
    expect(panes.count()).toBe(0);
  });

  it('has no panes without a terminal port', async () => {
    const { panes, workspace } = setup({ withPort: false });
    expect(await panes.available()).toMatchObject({ ok: false });
    await expect(panes.open(workspace.id, SIZE)).rejects.toBeInstanceOf(TerminalUnavailableError);
  });
});

describe('a pane that closes or restarts', () => {
  it('stops the program and tells its viewers on close; the viewer feed ends', async () => {
    const { panes, workspace, fake } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    const viewer = panes.attach(pane.id)!;
    const data: string[] = [];
    viewer.attach(() => {}, (chunk) => data.push(chunk));
    let closed = false;
    viewer.onClose(() => (closed = true));
    panes.close(workspace.id, pane.id);
    expect(fake.processes[0]!.kills()).toBe(1);
    expect(closed).toBe(true);
    fake.processes[0]!.print('late');
    expect(data).toEqual([]);
    expect(panes.attach(pane.id)).toBeUndefined();
  });

  it('Restart pane stops the old program, starts a new one in the same pane, and re-feeds the viewer from it', async () => {
    const { panes, workspace, fake } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    const viewer = panes.attach(pane.id)!;
    const snapshots: string[] = [];
    const data: string[] = [];
    viewer.attach((snapshot) => snapshots.push(snapshot), (chunk) => data.push(chunk));
    fake.processes[0]!.print('first program');
    expect(snapshots).toEqual(['']);
    const states: string[] = [];
    viewer.onState((p) => states.push(p.state));
    const restarted = await panes.restart(workspace.id, pane.id, { cols: 120, rows: 40 });
    expect(restarted.id).toBe(pane.id);
    expect(fake.processes).toHaveLength(2);
    expect(fake.processes[0]!.kills()).toBe(1);
    expect(fake.processes[1]!.input).toMatchObject({ cols: 120, rows: 40 });
    // The old program's end is not the pane's end.
    expect(states).not.toContain('exited');
    expect(snapshots).toEqual(['', '']);
    fake.processes[1]!.print('second program');
    expect(data).toEqual(['first program', 'second program']);
    expect(states.at(-1)).toBe('running');
    fake.processes[0]!.print('ghost');
    expect(data).toEqual(['first program', 'second program']);
  });

  it('Restart pane works on a pane that exited', async () => {
    const { panes, workspace, fake } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    fake.processes[0]!.exit(1);
    expect(panes.list(workspace.id)[0]!.state).toBe('exited');
    await panes.restart(workspace.id, pane.id, SIZE);
    expect(panes.list(workspace.id)[0]).toMatchObject({ state: 'starting', exitCode: null });
  });

  it('a failed restart leaves the pane stopped so it can be tried again', async () => {
    let failing = false;
    const { panes, workspace } = setup({
      terminal: {
        opening: async () => {
          if (failing) throw new Error('spawn failed');
        },
      },
    });
    const pane = await panes.open(workspace.id, SIZE);
    failing = true;
    await expect(panes.restart(workspace.id, pane.id, SIZE)).rejects.toBeInstanceOf(Error);
    expect(panes.list(workspace.id)).toHaveLength(1);
    expect(panes.list(workspace.id)[0]!.state).toBe('exited');
    failing = false;
    await expect(panes.restart(workspace.id, pane.id, SIZE)).resolves.toMatchObject({ state: 'starting' });
  });
});

describe('pane events: state only (story 16.3)', () => {
  const paneEvents = (core: ReturnType<typeof setup>['core']) => core.events.readAfter(0).filter((e) => e.type.startsWith('terminal.'));

  it('appends opened, exited and closed with their ids and cause, and never a pane\'s text', async () => {
    const { core, panes, workspace, fake } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    fake.processes[0]!.print('SECRET-OUTPUT-MARKER');
    fake.processes[0]!.exit(5);
    panes.close(workspace.id, pane.id);
    const events = paneEvents(core);
    expect(events.map((e) => e.type)).toEqual(['terminal.pane_opened', 'terminal.pane_exited', 'terminal.pane_closed']);
    expect(events[0]).toMatchObject({ workspaceId: workspace.id, streamId: workspace.id, payload: { paneId: pane.id, launcherId: 'shell', title: 'Terminal 1' } });
    expect(events[1]!.payload).toEqual({ paneId: pane.id, exitCode: 5 });
    expect(events[2]!.payload).toEqual({ paneId: pane.id, cause: 'user' });
    expect(JSON.stringify(events)).not.toContain('SECRET-OUTPUT-MARKER');
  });

  it('says why a pane closed: Developer mode off, or the server stopping', async () => {
    const { core, panes, workspace } = setup();
    await panes.open(workspace.id, SIZE);
    core.installSettings.setDeveloperMode(false);
    core.installSettings.setDeveloperMode(true);
    await panes.open(workspace.id, SIZE);
    panes.dispose();
    const causes = paneEvents(core).flatMap((e) => (e.type === 'terminal.pane_closed' ? [e.payload.cause] : []));
    expect(causes).toEqual(['developer_mode_off', 'server_stopped']);
  });

  it('emits nothing for an open that fails', async () => {
    const { core, panes, workspace } = setup({ terminal: { openError: new Error('no') } });
    await panes.open(workspace.id, SIZE).catch(() => undefined);
    expect(paneEvents(core)).toEqual([]);
  });
});

describe('review findings (security review of 16.2)', () => {
  it('two Restarts at once leave one program running, the other stopped', async () => {
    const { panes, workspace, fake } = setup({ terminal: { opening: () => new Promise((resolve) => setTimeout(resolve, 5)) } });
    const pane = await panes.open(workspace.id, SIZE);
    await Promise.all([panes.restart(workspace.id, pane.id, SIZE), panes.restart(workspace.id, pane.id, SIZE)]);
    const running = fake.processes.filter((p) => p.kills() === 0);
    expect(running).toHaveLength(1);
  });

  it('a live viewer typing after Developer mode went off (no event) stops the pane instead of reaching the shell', async () => {
    const { panes, workspace, fake, core } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    const viewer = panes.attach(pane.id)!;
    // Flipped without the event a listener would have heard.
    core.installSettings.developerMode = () => false;
    viewer.write('rm -rf x\r');
    expect(fake.processes[0]!.writes).toEqual([]);
    expect(fake.processes[0]!.kills()).toBe(1);
    expect(panes.count()).toBe(0);
  });
});

describe('viewers: the size follows whichever viewer last resized or typed', () => {
  it('gives the pane the resizing viewer\'s size, tells the others, and clamps', async () => {
    const { panes, workspace, fake } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    const a = panes.attach(pane.id)!;
    const b = panes.attach(pane.id)!;
    const toA: Array<{ cols: number; rows: number }> = [];
    const toB: Array<{ cols: number; rows: number }> = [];
    a.onSize((s) => toA.push(s));
    b.onSize((s) => toB.push(s));
    a.resize(90, 20);
    expect(fake.processes[0]!.resizes).toEqual([{ cols: 90, rows: 20 }]);
    expect(toB).toEqual([{ cols: 90, rows: 20 }]);
    b.resize(2000, 2000);
    expect(b.size).toEqual({ cols: 1000, rows: 500 });
    a.resize(Number.NaN, 5);
    expect(a.size).toEqual({ cols: 1000, rows: 500 });
    // Typing first gives the pane the typer's own size.
    a.resize(90, 20);
    b.resize(50, 10);
    a.write('ls\r');
    expect(fake.processes[0]!.resizes.at(-1)).toEqual({ cols: 90, rows: 20 });
    expect(fake.processes[0]!.writes).toEqual(['ls\r']);
    expect(toA.at(-1)).toEqual({ cols: 90, rows: 20 });
  });

  it('a viewer that detaches hears nothing more, and the pane runs on', async () => {
    const { panes, workspace, fake } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    const viewer = panes.attach(pane.id)!;
    const data: string[] = [];
    viewer.attach(() => {}, (chunk) => data.push(chunk));
    fake.processes[0]!.print('one');
    viewer.detach();
    fake.processes[0]!.print('two');
    expect(data).toEqual(['one']);
    expect(fake.processes[0]!.kills()).toBe(0);
    expect(panes.list(workspace.id)[0]!.state).not.toBe('exited');
  });

  it('a viewer that attaches later is given the screen so far, then the live output', async () => {
    const { panes, workspace, fake } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    fake.processes[0]!.print('already shown');
    // The fake's pane process records what it printed once the pane exists.
    const viewer = panes.attach(pane.id)!;
    const log: string[] = [];
    viewer.attach((snapshot) => log.push(`snapshot:${snapshot}`), (chunk) => log.push(`data:${chunk}`));
    fake.processes[0]!.print('live');
    expect(log).toEqual(['snapshot:already shown', 'data:live']);
  });

  it('a viewer callback that throws is reported, not raised into the pane', async () => {
    const { panes, workspace, fake, errors } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    const viewer = panes.attach(pane.id)!;
    viewer.attach(() => {}, () => {
      throw new Error('viewer failed');
    });
    expect(() => fake.processes[0]!.print('x')).not.toThrow();
    expect(errors).toHaveLength(1);
  });
});
