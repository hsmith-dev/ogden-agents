/**
 * Terminal panes in core (epic 16, story 16.2; E16-R1, R3): the Developer
 * mode gate, the limits, the pane's life (starting, running, exited, Restart
 * pane, close), viewers and their sizes. Core depends on no adapter, so the
 * port is core's own fake terminal (`support/fake-terminal.ts`).
 */
import type { Pane } from '@ogden-agents/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaneLauncher } from '@ogden-agents/shared';
import { createPanes, DeveloperModeRequiredError, NotFoundError, PaneLimitError, TerminalUnavailableError, ValidationError, type Panes, type PanesOptions } from '../src/index.js';
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

  it('stops every program when Developer mode is turned off, keeps each pane as stopped, and tells their viewers', async () => {
    const { panes, workspace, fake, core } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    const states: string[] = [];
    panes.attach(pane.id)!.onState((p) => states.push(p.state));
    core.installSettings.setDeveloperMode(false);
    expect(fake.processes[0]!.kills()).toBe(1);
    expect(states).toEqual(['stopped']);
    expect(panes.count()).toBe(1);
    core.installSettings.setDeveloperMode(true);
    expect(panes.list(workspace.id)[0]).toMatchObject({ id: pane.id, state: 'stopped' });
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
    const events = paneEvents(core).filter((e) => e.type !== 'terminal.pane_status_changed');
    expect(events.map((e) => e.type)).toEqual(['terminal.pane_opened', 'terminal.layout_changed', 'terminal.pane_exited', 'terminal.layout_changed', 'terminal.pane_closed']);
    expect(events[0]).toMatchObject({ workspaceId: workspace.id, streamId: workspace.id, payload: { paneId: pane.id, launcherId: 'shell', title: 'Terminal 1' } });
    expect(events[2]!.payload).toEqual({ paneId: pane.id, exitCode: 5 });
    expect(events[4]!.payload).toEqual({ paneId: pane.id, cause: 'user' });
    expect(JSON.stringify(events)).not.toContain('SECRET-OUTPUT-MARKER');
  });

  it('says a pane\'s program ended when Developer mode turns off (the pane stays), and closed only when the user closes it', async () => {
    const { core, panes, workspace } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    core.installSettings.setDeveloperMode(false);
    await new Promise((resolve) => setImmediate(resolve));
    core.installSettings.setDeveloperMode(true);
    panes.close(workspace.id, pane.id);
    const kinds = paneEvents(core).filter((e) => e.type !== 'terminal.layout_changed').map((e) => e.type);
    expect(kinds).toEqual(['terminal.pane_opened', 'terminal.pane_exited', 'terminal.pane_closed']);
  });

  it('delivers the Developer mode change to a later subscriber before the pane event, in order (no lost event)', async () => {
    const { core, panes, workspace } = setup();
    await panes.open(workspace.id, SIZE);
    const heard: string[] = [];
    // Registered after the panes' own subscriber, as the /ws broadcast is.
    core.events.subscribe(core.events.lastSeq(), (event) => void heard.push(event.type));
    core.installSettings.setDeveloperMode(false);
    await new Promise((resolve) => setImmediate(resolve));
    expect(heard).toEqual(['settings.developer_mode_changed', 'terminal.pane_exited']);
  });

  it('announces nothing for a pane closed while it was starting', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { core, panes, workspace } = setup({ terminal: { opening: () => gate } });
    const opening = panes.open(workspace.id, SIZE);
    opening.catch(() => undefined);
    await new Promise((resolve) => setImmediate(resolve));
    const id = panes.list(workspace.id)[0]!.id;
    panes.close(workspace.id, id);
    release();
    await expect(opening).rejects.toBeInstanceOf(NotFoundError);
    expect(paneEvents(core)).toEqual([]);
  });

  it('says exited with no code when Restart pane could not start the program', async () => {
    let failing = false;
    const { core, panes, workspace } = setup({ terminal: { opening: async () => void (failing && (() => { throw new Error('x'); })()) } });
    const pane = await panes.open(workspace.id, SIZE);
    failing = true;
    await panes.restart(workspace.id, pane.id, SIZE).catch(() => undefined);
    expect(paneEvents(core).at(-1)).toMatchObject({ type: 'terminal.pane_exited', payload: { paneId: pane.id, exitCode: null } });
  });

  it('emits nothing for an open that fails', async () => {
    const { core, panes, workspace } = setup({ terminal: { openError: new Error('no') } });
    await panes.open(workspace.id, SIZE).catch(() => undefined);
    expect(paneEvents(core)).toEqual([]);
  });
});

describe('the layout (story 16.4)', () => {
  it('a new pane gets a tab of its own; a split placement puts it beside another; closing collapses', async () => {
    const { panes, workspace } = setup();
    expect(panes.layout(workspace.id)).toEqual({ tabs: [], activeTabId: null });
    const a = await panes.open(workspace.id, SIZE);
    const b = await panes.open(workspace.id, SIZE, { kind: 'split', paneId: a.id, direction: 'row' });
    const c = await panes.open(workspace.id, SIZE);
    const layout = panes.layout(workspace.id);
    expect(layout.tabs).toHaveLength(2);
    expect(layout.tabs[0]!.root).toMatchObject({ type: 'split', direction: 'row', first: { paneId: a.id }, second: { paneId: b.id } });
    expect(layout.tabs[1]!.root).toEqual({ type: 'pane', paneId: c.id });
    expect(layout.activeTabId).toBe(layout.tabs[1]!.id);
    panes.close(workspace.id, a.id);
    expect(panes.layout(workspace.id).tabs[0]!.root).toEqual({ type: 'pane', paneId: b.id });
    panes.close(workspace.id, c.id);
    expect(panes.layout(workspace.id).tabs).toHaveLength(1);
  });

  it('a split of a pane that is not there falls back to a tab of its own', async () => {
    const { panes, workspace } = setup();
    await panes.open(workspace.id, SIZE, { kind: 'split', paneId: 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W3', direction: 'column' });
    expect(panes.layout(workspace.id).tabs).toHaveLength(1);
  });

  it('arranges ratios, tab names and the active tab, and refuses any other change', async () => {
    const { panes, workspace } = setup();
    const a = await panes.open(workspace.id, SIZE);
    await panes.open(workspace.id, SIZE, { kind: 'split', paneId: a.id, direction: 'row' });
    const layout = panes.layout(workspace.id);
    const tab = layout.tabs[0]!;
    const next = { ...layout, tabs: [{ ...tab, title: 'Servers', root: { ...tab.root, ratio: 0.25 } }] };
    expect(panes.arrange(workspace.id, next)).toEqual(next);
    expect(panes.layout(workspace.id).tabs[0]).toMatchObject({ title: 'Servers', root: { ratio: 0.25 } });
    expect(() => panes.arrange(workspace.id, { tabs: [], activeTabId: null })).toThrow(ValidationError);
    expect(() => panes.arrange(workspace.id, 'x')).toThrow(ValidationError);
  });

  it('renames a pane (plain names only) and says so in an event with no other text; the layout events carry counts', async () => {
    const { core, panes, workspace } = setup();
    const a = await panes.open(workspace.id, SIZE);
    expect(panes.rename(workspace.id, a.id, '  Server  ').title).toBe('Server');
    expect(() => panes.rename(workspace.id, a.id, 'bad\u0007')).toThrow(ValidationError);
    expect(() => panes.rename(workspace.id, a.id, '   ')).toThrow(ValidationError);
    const events = core.events.readAfter(0).filter((e) => e.type.startsWith('terminal.') && e.type !== 'terminal.pane_status_changed');
    expect(events.map((e) => e.type)).toEqual(['terminal.pane_opened', 'terminal.layout_changed', 'terminal.pane_renamed']);
    expect(events[1]!.payload).toEqual({ tabCount: 1, paneCount: 1 });
    expect(events[2]!.payload).toEqual({ paneId: a.id, title: 'Server' });
  });
});

describe('layout review findings (16.4)', () => {
  it('arrange refuses an unknown project and announces nothing when the layout did not change', async () => {
    const { core, panes, workspace } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    expect(() => panes.arrange('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', { tabs: [], activeTabId: null })).toThrow(NotFoundError);
    const before = core.events.readAfter(0).length;
    panes.arrange(workspace.id, panes.layout(workspace.id));
    expect(core.events.readAfter(0).length).toBe(before);
    expect(pane.id).toBeTruthy();
  });

  it('the layout stays when Developer mode turns the panes off, and arrange needs Developer mode', async () => {
    const { core, panes, workspace } = setup();
    await panes.open(workspace.id, SIZE);
    core.installSettings.setDeveloperMode(false);
    expect(() => panes.arrange(workspace.id, { tabs: [], activeTabId: null })).toThrow(DeveloperModeRequiredError);
    core.installSettings.setDeveloperMode(true);
    expect(panes.layout(workspace.id).tabs).toHaveLength(1);
  });

  it('a split whose target closes while the new pane starts still gets a place, and nothing opens after dispose', async () => {
    const { panes, workspace } = setup();
    const a = await panes.open(workspace.id, SIZE);
    panes.close(workspace.id, a.id);
    await panes.open(workspace.id, SIZE, { kind: 'split', paneId: a.id, direction: 'row' });
    expect(panes.layout(workspace.id).tabs).toHaveLength(1);
    panes.dispose();
    await expect(panes.open(workspace.id, SIZE)).rejects.toBeInstanceOf(DeveloperModeRequiredError);
  });

  it('a pane that is still starting can not be renamed (nothing announced it yet)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { panes, workspace } = setup({ terminal: { opening: () => gate } });
    const opening = panes.open(workspace.id, SIZE);
    await new Promise((resolve) => setImmediate(resolve));
    const id = panes.list(workspace.id)[0]!.id;
    expect(() => panes.rename(workspace.id, id, 'x')).toThrow(NotFoundError);
    release();
    await opening;
  });
});

describe('a pane\'s status (story 16.6)', () => {
  const LAUNCHER = PaneLauncher.parse({ id: 'example', label: 'Example CLI', kind: 'cli', executables: {}, promptPatterns: [{ name: 'q', pattern: '\\(y/n\\)', depth: 1 }] });

  function withLauncher() {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.installSettings.setDeveloperMode(true);
    const fake = fakeTerminal();
    const panes = createPanes({
      entities: core.entities,
      installSettings: core.installSettings,
      events: core.events,
      terminal: fake.port,
      launchers: {
        list: async () => [],
        detect: async () => [],
        get: (id) => (id === 'example' ? LAUNCHER : undefined),
        command: async () => ({ ok: true, file: '/abs/example', args: [] }),
      },
      shell: () => ({ file: '/bin/fake-shell', args: [] }),
      env: () => ({}),
    });
    stops.push(() => panes.dispose());
    return { core, workspace, fake, panes };
  }

  it('a program that asks a question goes to needs attention, with an event that names the pane and carries no text; typing makes it working; exit makes it exited', async () => {
    vi.useFakeTimers();
    try {
      const { core, workspace, fake, panes } = withLauncher();
      const pane = await panes.open(workspace.id, SIZE, undefined, { launcherId: 'example' });
      expect(pane.status).toBe('working');
      const viewer = panes.attach(pane.id)!;
      const seen: string[] = [];
      viewer.onState((p) => seen.push(p.status));
      fake.processes[0]!.setScreen(['Delete everything?', 'Sure? (y/n)']);
      fake.processes[0]!.print('Sure? (y/n)');
      await vi.advanceTimersByTimeAsync(500);
      expect(panes.list(workspace.id)[0]!.status).toBe('needs_attention');
      viewer.write('y\r');
      expect(panes.list(workspace.id)[0]!.status).toBe('working');
      fake.processes[0]!.exit(0);
      expect(panes.list(workspace.id)[0]!.status).toBe('exited');
      const changes = core.events.readAfter(0).filter((e) => e.type === 'terminal.pane_status_changed');
      expect(changes.map((e) => e.payload)).toEqual([
        { paneId: pane.id, status: 'needs_attention', previous: 'working', title: 'Example CLI 1', notify: false },
        { paneId: pane.id, status: 'working', previous: 'needs_attention', title: 'Example CLI 1', notify: false },
        { paneId: pane.id, status: 'exited', previous: 'working', title: 'Example CLI 1', notify: false },
      ]);
      expect(JSON.stringify(changes)).not.toContain('Sure?');
      expect(seen).toContain('needs_attention');
      expect(seen.at(-1)).toBe('exited');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a Restart pane that could not start leaves the pane exited in status too', async () => {
    let failing = false;
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.installSettings.setDeveloperMode(true);
    const panes = createPanes({
      entities: core.entities,
      installSettings: core.installSettings,
      events: core.events,
      terminal: fakeTerminal({ opening: async () => void (failing && (() => { throw new Error('x'); })()) }).port,
      shell: () => ({ file: '/x', args: [] }),
      env: () => ({}),
    });
    stops.push(() => panes.dispose());
    const pane = await panes.open(workspace.id, SIZE);
    failing = true;
    await panes.restart(workspace.id, pane.id, SIZE).catch(() => undefined);
    expect(panes.list(workspace.id)[0]).toMatchObject({ state: 'exited', status: 'exited' });
  });

  it('working and idle stay out of the event log (every command would add two rows): only into or out of needs attention, and the end', async () => {
    vi.useFakeTimers();
    try {
      const { core, workspace, fake, panes } = withLauncher();
      await panes.open(workspace.id, SIZE, undefined, { launcherId: 'example' });
      fake.processes[0]!.print('output');
      await vi.advanceTimersByTimeAsync(3_000);
      expect(panes.list(workspace.id)[0]!.status).toBe('idle');
      expect(core.events.readAfter(0).filter((e) => e.type === 'terminal.pane_status_changed')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the plain shell has no prompt patterns, so it is only ever working or idle; Restart pane starts the guess over', async () => {
    vi.useFakeTimers();
    try {
      const { workspace, fake, panes } = withLauncher();
      const shell = await panes.open(workspace.id, SIZE);
      fake.processes[0]!.setScreen(['Sure? (y/n)']);
      fake.processes[0]!.print('Sure? (y/n)');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(panes.list(workspace.id)[0]!.status).toBe('idle');
      fake.processes[0]!.exit(1);
      expect(panes.list(workspace.id)[0]!.status).toBe('exited');
      await panes.restart(workspace.id, shell.id, SIZE);
      expect(panes.list(workspace.id)[0]!.status).toBe('working');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('notifications are the user\'s opt in (story 16.8)', () => {
  const LAUNCHER = PaneLauncher.parse({ id: 'example', label: 'Example CLI', kind: 'cli', executables: {}, promptPatterns: [{ name: 'q', pattern: '\\(y/n\\)', depth: 1 }] });

  function booted(notifyLaunchers?: () => readonly string[]) {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.installSettings.setDeveloperMode(true);
    const fake = fakeTerminal();
    const panes = createPanes({
      entities: core.entities,
      installSettings: core.installSettings,
      events: core.events,
      terminal: fake.port,
      store: core.paneStore,
      notifyLaunchers,
      launchers: { list: async () => [], detect: async () => [], get: (id) => (id === 'example' ? LAUNCHER : undefined), command: async () => ({ ok: true, file: '/abs/example', args: [] }) },
      shell: () => ({ file: '/x', args: [] }),
      env: () => ({}),
    });
    stops.push(() => panes.dispose());
    return { core, workspace, fake, panes };
  }

  const waiting = async (b: ReturnType<typeof booted>, id: string) => {
    b.fake.processes[0]!.setScreen(['Sure? (y/n)']);
    b.fake.processes[0]!.print('Sure? (y/n)');
    await vi.advanceTimersByTimeAsync(600);
    return b.core.events.readAfter(0).filter((e) => e.type === 'terminal.pane_status_changed' && e.payload.paneId === id).at(-1)!.payload;
  };

  it('is off by default, saved per pane, and the status event says whether it is on; the setting is not text', async () => {
    vi.useFakeTimers();
    try {
      const b = booted();
      const pane = await b.panes.open(b.workspace.id, SIZE, undefined, { launcherId: 'example' });
      expect(pane.notify).toBe(false);
      expect(await waiting(b, pane.id)).toMatchObject({ status: 'needs_attention', notify: false });
      expect(b.panes.setNotify(b.workspace.id, pane.id, true).notify).toBe(true);
      expect(b.core.paneStore.load().panes[0]!.notify).toBe(true);
      // Typing answers it; the next wait carries the opt in.
      b.panes.attach(pane.id)!.write('y\r');
      b.fake.processes[0]!.print('Again? (y/n)');
      await vi.advanceTimersByTimeAsync(600);
      expect(b.core.events.readAfter(0).filter((e) => e.type === 'terminal.pane_status_changed').at(-1)!.payload).toMatchObject({ status: 'needs_attention', notify: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a launcher the user opted in turns it on for all its panes', async () => {
    vi.useFakeTimers();
    try {
      const b = booted(() => ['example']);
      const pane = await b.panes.open(b.workspace.id, SIZE, undefined, { launcherId: 'example' });
      expect(await waiting(b, pane.id)).toMatchObject({ notify: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a flip is announced to the other windows, once', async () => {
    const b = booted();
    const pane = await b.panes.open(b.workspace.id, SIZE);
    b.panes.setNotify(b.workspace.id, pane.id, true);
    b.panes.setNotify(b.workspace.id, pane.id, true);
    expect(b.core.events.readAfter(0).filter((e) => e.type === 'terminal.pane_renamed').map((e) => e.payload)).toEqual([{ paneId: pane.id, title: 'Terminal 1', notify: true }]);
  });

  it('needs Developer mode and a known pane', () => {
    const b = booted();
    expect(() => b.panes.setNotify(b.workspace.id, 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W3', true)).toThrow(NotFoundError);
    b.core.installSettings.setDeveloperMode(false);
    expect(() => b.panes.setNotify(b.workspace.id, 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W3', true)).toThrow(DeveloperModeRequiredError);
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

  it('a live viewer typing after Developer mode went off (no event) stops the panes and keeps them, and nothing reaches the shell', async () => {
    const { panes, workspace, fake, core } = setup();
    const pane = await panes.open(workspace.id, SIZE);
    const viewer = panes.attach(pane.id)!;
    // Flipped without the event a listener would have heard.
    core.installSettings.developerMode = () => false;
    viewer.write('rm -rf x\r');
    expect(fake.processes[0]!.writes).toEqual([]);
    expect(fake.processes[0]!.kills()).toBe(1);
    expect(panes.count()).toBe(1);
    expect(viewer.pane.state).toBe('stopped');
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
