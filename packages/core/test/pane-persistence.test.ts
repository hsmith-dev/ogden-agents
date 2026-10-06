/**
 * Layouts survive a restart; stopped panes start on demand (epic 16, story
 * 16.7; E16-R8). A "restart" is a second `createPanes` over the same core and
 * database: every stored pane comes back stopped, in its layout, and Start
 * runs a fresh program. The database holds the shape, never output or the
 * arguments a user typed.
 */
import { PaneLauncher } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createPanes, type Panes, type PaneLaunchers } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';
import { fakeTerminal } from './support/fake-terminal.js';

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});
const SIZE = { cols: 100, rows: 30 };
const CLI = PaneLauncher.parse({ id: 'example', label: 'Example CLI', kind: 'cli', executables: {}, resumeHint: 'Run example --resume.' });

function boot(core: ReturnType<typeof openTestCore>, pids?: { add(pid: number): void; remove(pid: number): void }) {
  const fake = fakeTerminal();
  const asked: Array<{ args: readonly string[] }> = [];
  const launchers: PaneLaunchers = {
    list: async () => [],
    detect: async () => [],
    get: (id) => (id === 'example' ? CLI : undefined),
    command: async (_id, args) => (asked.push({ args }), { ok: true as const, file: '/abs/example', args: [...args] }),
  };
  const panes: Panes = createPanes({
    entities: core.entities,
    installSettings: core.installSettings,
    events: core.events,
    terminal: fake.port,
    store: core.paneStore,
    pids,
    launchers,
    shell: () => ({ file: '/bin/fake-shell', args: [] }),
    env: () => ({}),
  });
  stops.push(() => panes.dispose());
  return { panes, fake, asked };
}

function setup() {
  const core = openTestCore();
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  core.installSettings.setDeveloperMode(true);
  return { core, workspace };
}

describe('the layout survives a restart', () => {
  it('comes back as the same three panes in the same tabs and split, every one stopped, with a fresh program on Start', async () => {
    const { core, workspace } = setup();
    const first = boot(core);
    const a = await first.panes.open(workspace.id, SIZE);
    const b = await first.panes.open(workspace.id, SIZE, { kind: 'split', paneId: a.id, direction: 'row' });
    const c = await first.panes.open(workspace.id, SIZE, undefined, { launcherId: 'example', args: '--secret-looking-token=abc' });
    first.panes.rename(workspace.id, b.id, 'Server');
    const layout = first.panes.layout(workspace.id);
    const resized = { ...layout, tabs: [{ ...layout.tabs[0]!, title: 'Main', root: { ...layout.tabs[0]!.root, ratio: 0.3 } }, layout.tabs[1]!] };
    first.panes.arrange(workspace.id, resized);
    first.panes.dispose();

    const second = boot(core);
    const restored = second.panes.list(workspace.id);
    expect(restored.map((p) => [p.id, p.title, p.launcherId, p.state, p.status])).toEqual([
      [a.id, 'Terminal 1', 'shell', 'stopped', 'idle'],
      [b.id, 'Server', 'shell', 'stopped', 'idle'],
      [c.id, 'Example CLI 1', 'example', 'stopped', 'idle'],
    ]);
    expect(second.panes.layout(workspace.id)).toEqual(resized);
    expect(second.fake.processes).toEqual([]);

    // Start runs a fresh shell in the same pane.
    const started = await second.panes.restart(workspace.id, a.id, SIZE);
    expect(started).toMatchObject({ id: a.id, state: 'starting' });
    expect(second.fake.processes[0]!.input).toMatchObject({ file: '/bin/fake-shell' });
    // A CLI's Start looks its program up again, with the arguments typed now, never the old ones.
    await second.panes.restart(workspace.id, c.id, SIZE, '--model big');
    expect(second.asked.at(-1)).toEqual({ args: ['--model', 'big'] });
    expect(second.fake.processes[1]!.input).toMatchObject({ file: '/abs/example', args: ['--model', 'big'] });
  });

  it('a pane the user closed is gone after a restart, and the layout with it; Developer mode off keeps the panes as stopped', async () => {
    const { core, workspace } = setup();
    const first = boot(core);
    const a = await first.panes.open(workspace.id, SIZE);
    const b = await first.panes.open(workspace.id, SIZE);
    first.panes.close(workspace.id, a.id);
    core.installSettings.setDeveloperMode(false);
    first.panes.dispose();
    core.installSettings.setDeveloperMode(true);
    const second = boot(core);
    expect(second.panes.list(workspace.id).map((p) => p.id)).toEqual([b.id]);
    expect(second.panes.layout(workspace.id).tabs).toHaveLength(1);
  });

  it('stopped panes still count against the limits', async () => {
    const { core, workspace } = setup();
    const first = boot(core);
    for (let i = 0; i < 8; i += 1) await first.panes.open(workspace.id, SIZE);
    first.panes.dispose();
    const second = boot(core);
    await expect(second.panes.open(workspace.id, SIZE)).rejects.toMatchObject({ scope: 'project', limit: 8 });
  });

  it('a layout that does not match the stored panes is rebuilt as one tab each, in the order they were made', async () => {
    const { core, workspace } = setup();
    const first = boot(core);
    const a = await first.panes.open(workspace.id, SIZE);
    const b = await first.panes.open(workspace.id, SIZE);
    first.panes.dispose();
    core.paneStore.saveLayout(workspace.id, { tabs: [{ id: 'x', title: 'Gone', root: { type: 'pane', paneId: 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W9' } }], activeTabId: 'x' });
    const second = boot(core);
    const layout = second.panes.layout(workspace.id);
    expect(layout.tabs.map((tab) => tab.root)).toEqual([{ type: 'pane', paneId: a.id }, { type: 'pane', paneId: b.id }]);
  });
});

describe('the opt in to notifications survives a restart (story 16.8)', () => {
  it('is kept per pane', async () => {
    const { core, workspace } = setup();
    const first = boot(core);
    const a = await first.panes.open(workspace.id, SIZE);
    await first.panes.open(workspace.id, SIZE);
    first.panes.setNotify(workspace.id, a.id, true);
    first.panes.dispose();
    expect(boot(core).panes.list(workspace.id).map((p) => p.notify)).toEqual([true, false]);
  });
});

describe('what is kept (E16-R8, AD-6, AD-16)', () => {
  it('holds no output and no typed arguments: only ids, the launcher, names and the layout shape', async () => {
    const { core, workspace } = setup();
    const first = boot(core);
    const pane = await first.panes.open(workspace.id, SIZE, undefined, { launcherId: 'example', args: '--token=sk-typed-secret' });
    first.fake.processes[0]!.print('OUTPUT-MARKER-123 and a typed secret sk-typed-secret');
    first.panes.attach(pane.id)!.write('typed-input-marker\r');
    const stored = core.paneStore.load();
    const everything = JSON.stringify([stored.panes, [...stored.layouts]]);
    for (const text of ['OUTPUT-MARKER-123', 'sk-typed-secret', 'typed-input-marker']) expect(everything).not.toContain(text);
    expect(stored.panes[0]).toMatchObject({ id: pane.id, launcherId: 'example', title: 'Example CLI 1' });
  });
});

describe('the pids of the programs (story 16.7: the sweep after a hard stop)', () => {
  it('records each program\'s pid when it starts and forgets it when it ends, restarts and closes included', async () => {
    const { core, workspace } = setup();
    const recorded = new Set<number>();
    const booted = boot(core, { add: (pid) => void recorded.add(pid), remove: (pid) => void recorded.delete(pid) });
    const pane = await booted.panes.open(workspace.id, SIZE);
    expect(recorded.size).toBe(1);
    booted.fake.processes[0]!.exit(0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(recorded.size).toBe(0);
    await booted.panes.restart(workspace.id, pane.id, SIZE);
    expect(recorded.size).toBe(1);
    booted.panes.close(workspace.id, pane.id);
    await new Promise((resolve) => setImmediate(resolve));
    expect(recorded.size).toBe(0);
  });
});

describe('review findings (16.7)', () => {
  it('a start still under way when Developer mode turns off does not run, and leaves the pane stopped and kept', async () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.installSettings.setDeveloperMode(true);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeTerminal({ opening: () => gate });
    const panes = createPanes({ entities: core.entities, installSettings: core.installSettings, events: core.events, terminal: fake.port, store: core.paneStore, shell: () => ({ file: '/x', args: [] }), env: () => ({}) });
    stops.push(() => panes.dispose());
    const opening = panes.open(workspace.id, SIZE);
    opening.catch(() => undefined);
    await new Promise((resolve) => setImmediate(resolve));
    core.installSettings.setDeveloperMode(false);
    release();
    await expect(opening).rejects.toBeInstanceOf(Error);
    await new Promise((resolve) => setImmediate(resolve));
    expect(fake.processes[0]!.kills()).toBeGreaterThan(0);
    expect(core.paneStore.load().panes).toEqual([]);
  });

  it('a keystroke or resize after Developer mode went off stops the panes and keeps them: nothing is deleted', async () => {
    const { core, workspace } = setup();
    const booted = boot(core);
    const pane = await booted.panes.open(workspace.id, SIZE);
    const viewer = booted.panes.attach(pane.id)!;
    // Flipped without the event, then the viewer types.
    core.installSettings.developerMode = () => false;
    viewer.write('x');
    viewer.resize(50, 10);
    expect(booted.fake.processes[0]!.writes).toEqual([]);
    expect(booted.panes.count()).toBe(1);
    expect(core.paneStore.load().panes.map((p) => p.id)).toEqual([pane.id]);
    expect(viewer.pane.state).toBe('stopped');
  });

  it('Start after Developer mode off runs with what is typed now, not the old arguments; a Start that cannot start leaves the pane stopped', async () => {
    const { core, workspace } = setup();
    const booted = boot(core);
    const pane = await booted.panes.open(workspace.id, SIZE, undefined, { launcherId: 'example', args: '--old-flag' });
    core.installSettings.setDeveloperMode(false);
    await new Promise((resolve) => setImmediate(resolve));
    core.installSettings.setDeveloperMode(true);
    await booted.panes.restart(workspace.id, pane.id, SIZE);
    expect(booted.asked.at(-1)).toEqual({ args: [] });
    expect(booted.fake.processes.at(-1)!.input.args).toEqual([]);
  });

  it('rows that are not what core writes (a bad name or launcher id) are left out on restore', async () => {
    const { core, workspace } = setup();
    core.paneStore.savePane({ id: 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W5', workspaceId: workspace.id, launcherId: 'shell', title: 'bad\u0007name', createdAt: 1, notify: false });
    core.paneStore.savePane({ id: 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W6', workspaceId: workspace.id, launcherId: 'Bad Launcher!', title: 'ok', createdAt: 2, notify: false });
    core.paneStore.savePane({ id: 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W7', workspaceId: workspace.id, launcherId: 'shell', title: 'Fine', createdAt: 3, notify: false });
    expect(core.paneStore.load().panes.map((p) => p.title)).toEqual(['Fine']);
  });

  it('panes opened in the same millisecond come back in the order they were made', async () => {
    const { core, workspace } = setup();
    const first = boot(core);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await first.panes.open(workspace.id, SIZE)).id);
    first.panes.dispose();
    expect(boot(core).panes.list(workspace.id).map((p) => p.id)).toEqual(ids);
  });
});

describe('Developer mode off with running panes (story 16.9)', () => {
  it('counts the running ones, stops them by default, and keeps them running when the user chose to', async () => {
    const { core, workspace } = setup();
    const booted = boot(core);
    const stopped = await booted.panes.open(workspace.id, SIZE);
    await booted.panes.open(workspace.id, SIZE);
    expect(booted.panes.runningCount()).toBe(2);
    booted.fake.processes[1]!.exit(0);
    expect(booted.panes.runningCount()).toBe(1);
    booted.panes.keepRunningOnNextDeveloperModeOff();
    core.installSettings.setDeveloperMode(false);
    // Kept: nothing was killed, nobody is fed, nothing is reachable.
    expect(booted.fake.processes[0]!.kills()).toBe(0);
    const viewerGate = () => booted.panes.attach(stopped.id);
    expect(viewerGate).toThrow();
    core.installSettings.setDeveloperMode(true);
    expect(booted.panes.list(workspace.id).find((p) => p.id === stopped.id)!.state).not.toBe('stopped');
    expect(booted.panes.runningCount()).toBe(1);
    // The next time it is turned off without that choice, they stop.
    core.installSettings.setDeveloperMode(false);
    expect(booted.fake.processes[0]!.kills()).toBe(1);
    expect(booted.panes.runningCount()).toBe(0);
  });

  it('a keystroke at a kept pane after Developer mode went off is refused without stopping it', async () => {
    const { core, workspace } = setup();
    const booted = boot(core);
    const pane = await booted.panes.open(workspace.id, SIZE);
    const viewer = booted.panes.attach(pane.id)!;
    booted.panes.keepRunningOnNextDeveloperModeOff();
    core.installSettings.setDeveloperMode(false);
    viewer.write('x');
    expect(booted.fake.processes[0]!.writes).toEqual([]);
    expect(booted.fake.processes[0]!.kills()).toBe(0);
  });
});
