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
    // A Windows path keeps its backslashes, quoted or not.
    expect(splitLauncherArgs('--add-dir "C:\\Users\\me" C:\\x')).toEqual(['--add-dir', 'C:\\Users\\me', 'C:\\x']);
  });

  it('is undefined for an unclosed quote or too many arguments', () => {
    expect(splitLauncherArgs('"open')).toBeUndefined();
    expect(splitLauncherArgs(Array.from({ length: 33 }, () => 'x').join(' '))).toBeUndefined();
  });
});

const CLI = PaneLauncher.parse({ id: 'example', label: 'Example CLI', kind: 'cli', executables: {}, defaultArgs: ['--own'] });

function launchersPort(state: 'found' | 'not_found' | 'failed' = 'found') {
  const asked: Array<{ id: string; args: readonly string[] }> = [];
  let file = '/abs/example';
  const port: PaneLaunchers = {
    list: async () => [{ launcher: CLI, detection: { launcherId: 'example', state } }],
    detect: async () => [{ launcher: CLI, detection: { launcherId: 'example', state } }],
    get: (id) => (id === 'example' ? CLI : undefined),
    async command(id, args) {
      asked.push({ id, args });
      return state === 'found' ? { ok: true, file, args: [...CLI.defaultArgs, ...args] } : { ok: false, code: state, reason: 'Example CLI was not found on this computer. Install it yourself, then press Detect.' };
    },
  };
  return { port, asked, moveTo: (next: string) => (file = next) };
}

function setup(state: 'found' | 'not_found' | 'failed' = 'found') {
  const core = openTestCore();
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  core.installSettings.setDeveloperMode(true);
  const fake = fakeTerminal();
  const { port, asked, moveTo } = launchersPort(state);
  const panes = createPanes({
    entities: core.entities,
    installSettings: core.installSettings,
    events: core.events,
    terminal: fake.port,
    launchers: port,
    shell: () => ({ file: '/bin/fake-shell', args: [] }),
    env: () => ({ PATH: '/usr/bin' }),
  });
  return { core, workspace, fake, panes, asked, moveTo };
}

const SIZE = { cols: 80, rows: 24 };

describe('a pane started from a launcher', () => {
  it('runs the absolute path with the launcher\'s own arguments then the typed ones, and is named after the program', async () => {
    const { panes, workspace, fake } = setup();
    const pane = await panes.open(workspace.id, SIZE, undefined, { launcherId: 'example', args: '--flag "two words"' });
    expect(pane).toMatchObject({ launcherId: 'example', title: 'Example CLI 1' });
    expect(fake.processes[0]!.input).toMatchObject({ file: '/abs/example', args: ['--own', '--flag', 'two words'], env: { PATH: '/usr/bin' } });
    await panes.restart(workspace.id, pane.id, SIZE);
    expect(fake.processes[1]!.input).toMatchObject({ file: '/abs/example', args: ['--own', '--flag', 'two words'] });
    expect((await panes.open(workspace.id, SIZE, undefined, { launcherId: 'example' })).title).toBe('Example CLI 2');
  });

  it('Restart pane looks the program up again (it may have moved) with the same typed arguments, and says so if it is gone', async () => {
    const { panes, workspace, fake, moveTo } = setup();
    const pane = await panes.open(workspace.id, SIZE, undefined, { launcherId: 'example', args: '--flag' });
    moveTo('/new/place/example');
    await panes.restart(workspace.id, pane.id, SIZE);
    expect(fake.processes[1]!.input).toMatchObject({ file: '/new/place/example', args: ['--own', '--flag'] });
  });

  it('a program found but that will not start (removed since) is reported as the program, with its install page, and nothing is left open', async () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.installSettings.setDeveloperMode(true);
    const { port } = launchersPort();
    let detected = 0;
    const panes = createPanes({
      entities: core.entities,
      installSettings: core.installSettings,
      terminal: fakeTerminal({ openError: new Error('spawn ENOENT') }).port,
      launchers: { ...port, detect: async () => (detected++, []) },
      shell: () => ({ file: '/x', args: [] }),
      env: () => ({}),
    });
    const refused = await panes.open(workspace.id, SIZE, undefined, { launcherId: 'example' }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(LauncherUnavailableError);
    expect((refused as LauncherUnavailableError).message).toContain('Example CLI could not be started');
    expect(detected).toBe(1);
    expect(panes.count()).toBe(0);
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
