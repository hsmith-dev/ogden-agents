/** Launchers in core (epic 16, story 16.5): the argument field is read as plain arguments, and a pane starts what the launchers port resolves, never a shell line. */
import { PaneLauncher } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createPanes, LauncherUnavailableError, splitLauncherArgs, ValidationError, type PaneLaunchers } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';
import { fakeTerminal } from './support/fake-terminal.js';

describe('the launcher argument field', () => {
  it('splits on spaces, keeps quoted text together, and interprets nothing else', () => {
    expect(splitLauncherArgs('')).toEqual([]);
    expect(splitLauncherArgs('--model big -p "a b" \'c d\'')).toEqual(['--model', 'big', '-p', 'a b', 'c d']);
    expect(splitLauncherArgs('"say \\"hi\\""')).toEqual(['say "hi"']);
    expect(splitLauncherArgs('$HOME ; rm -rf * && echo `x` | cat > y')).toEqual(['$HOME', ';', 'rm', '-rf', '*', '&&', 'echo', '`x`', '|', 'cat', '>', 'y']);
    expect(splitLauncherArgs('a "" b')).toEqual(['a', '', 'b']);
  });

  it('is undefined for an unclosed quote or too many arguments', () => {
    expect(splitLauncherArgs('"open')).toBeUndefined();
    expect(splitLauncherArgs(Array.from({ length: 33 }, () => 'x').join(' '))).toBeUndefined();
  });
});

const CLI = PaneLauncher.parse({ id: 'example', label: 'Example CLI', kind: 'cli', executables: {}, defaultArgs: ['--own'] });

function launchersPort(state: 'found' | 'not_found' | 'failed' = 'found') {
  const asked: Array<{ id: string; args: readonly string[] }> = [];
  const port: PaneLaunchers = {
    list: async () => [{ launcher: CLI, detection: { launcherId: 'example', state } }],
    detect: async () => [{ launcher: CLI, detection: { launcherId: 'example', state } }],
    get: (id) => (id === 'example' ? CLI : undefined),
    async command(id, args) {
      asked.push({ id, args });
      return state === 'found' ? { ok: true, file: '/abs/example', args: [...CLI.defaultArgs, ...args] } : { ok: false, code: state, reason: 'Example CLI was not found on this computer. Install it yourself, then press Detect.' };
    },
  };
  return { port, asked };
}

function setup(state: 'found' | 'not_found' | 'failed' = 'found') {
  const core = openTestCore();
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  core.installSettings.setDeveloperMode(true);
  const fake = fakeTerminal();
  const { port, asked } = launchersPort(state);
  const panes = createPanes({
    entities: core.entities,
    installSettings: core.installSettings,
    events: core.events,
    terminal: fake.port,
    launchers: port,
    shell: () => ({ file: '/bin/fake-shell', args: [] }),
    env: () => ({ PATH: '/usr/bin' }),
  });
  return { core, workspace, fake, panes, asked };
}

const SIZE = { cols: 80, rows: 24 };

describe('a pane started from a launcher', () => {
  it('runs the absolute path with the launcher\'s own arguments then the typed ones, is named after the program, and keeps the path for Restart pane', async () => {
    const { panes, workspace, fake } = setup();
    const pane = await panes.open(workspace.id, SIZE, undefined, { launcherId: 'example', args: '--flag "two words"' });
    expect(pane).toMatchObject({ launcherId: 'example', title: 'Example CLI 1' });
    expect(fake.processes[0]!.input).toMatchObject({ file: '/abs/example', args: ['--own', '--flag', 'two words'], env: { PATH: '/usr/bin' } });
    await panes.restart(workspace.id, pane.id, SIZE);
    expect(fake.processes[1]!.input).toMatchObject({ file: '/abs/example', args: ['--own', '--flag', 'two words'] });
    expect((await panes.open(workspace.id, SIZE, undefined, { launcherId: 'example' })).title).toBe('Example CLI 2');
  });

  it('lists the launchers with detection (Developer mode only), and looks again on request', async () => {
    const { panes } = setup('not_found');
    expect((await panes.launchers())[0]!.detection.state).toBe('not_found');
    expect((await panes.launchers(true))[0]!.detection.state).toBe('not_found');
  });

  it('opens nothing and says why when the program is not found, did not answer, is unknown or the arguments are unreadable', async () => {
    const missing = setup('not_found');
    await expect(missing.panes.open(missing.workspace.id, SIZE, undefined, { launcherId: 'example' })).rejects.toMatchObject({ launcherCode: 'not_found' });
    expect(missing.fake.processes).toEqual([]);
    expect(missing.panes.count()).toBe(0);
    const failed = setup('failed');
    await expect(failed.panes.open(failed.workspace.id, SIZE, undefined, { launcherId: 'example' })).rejects.toBeInstanceOf(LauncherUnavailableError);
    const ok = setup();
    await expect(ok.panes.open(ok.workspace.id, SIZE, undefined, { launcherId: 'nope' })).rejects.toMatchObject({ launcherCode: 'unknown_launcher' });
    await expect(ok.panes.open(ok.workspace.id, SIZE, undefined, { launcherId: 'example', args: '"open' })).rejects.toBeInstanceOf(ValidationError);
    expect(ok.asked).toEqual([]);
  });

  it('the plain shell takes no launcher and ignores arguments; without a launchers port only the shell opens', async () => {
    const { panes, workspace, fake } = setup();
    await panes.open(workspace.id, SIZE, undefined, { launcherId: 'shell', args: '--ignored' });
    expect(fake.processes[0]!.input).toMatchObject({ file: '/bin/fake-shell', args: [] });
    const core = openTestCore();
    const ws = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.installSettings.setDeveloperMode(true);
    const bare = createPanes({ entities: core.entities, installSettings: core.installSettings, terminal: fakeTerminal().port, shell: () => ({ file: '/x', args: [] }), env: () => ({}) });
    await expect(bare.open(ws.id, SIZE, undefined, { launcherId: 'example' })).rejects.toBeInstanceOf(LauncherUnavailableError);
    expect(await bare.launchers()).toEqual([]);
  });
});
