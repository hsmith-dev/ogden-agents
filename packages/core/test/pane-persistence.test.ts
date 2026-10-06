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
