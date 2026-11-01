/**
 * Project commands and Problems (AD-38; epic 8 entry 2's contract, 8.9
 * implements both halves): the {@link ProjectCommandRunner} an adapter
 * provides (the server owns each process, AD-3: killed on Stop or server
 * stop; AD-16's allowlisted environment, never `process.env`) and the
 * {@link ProjectCommands} use-case the routes call.
 *
 * Every method first resolves the workspace and refuses an untrusted one
 * (`scripts_not_trusted`, the project trust flag of AD-22 4.2): nothing is
 * read, detected or run before. The declared commands live on the
 * workspace row; a `package.json` script is offered (its `test` and `lint`)
 * and runs as `<pm> run <script>` only while its text is the one the user
 * confirmed (`command_changed` otherwise, and the runner is never called).
 * A settings command runs as the argv `splitCommandLine` gives, only when
 * it needs no shell ({@link shellFreeCommand}).
 *
 * Output is cut to its last 1 MiB (a cut first line dropped), ANSI
 * stripped, masked with `redactSecrets` and only then parsed or answered;
 * a run's output and items are kept in memory per command until its next
 * run. Events carry ids, a state, an exit code and counts only; nothing
 * here logs a command, a path or output.
 */
import { createHash } from 'node:crypto';
import {
  MAX_PROJECT_COMMAND_CHARS,
  MAX_PROJECT_COMMANDS,
  PackageScriptName,
  PROBLEMS_DETECTED_LABELS,
  PROJECT_COMMAND_REFUSALS,
  ProjectCommandId,
  ProjectCommandRunId,
  redactSecrets,
  SetProjectCommandsRequest,
  stripTerminalEscapes,
  type ProjectCommand,
  type ProjectCommandRun,
  type ProjectCommandRunDetail,
  type ProjectCommandRunResponse,
  type ProjectCommandsResponse,
  type ProblemItem,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { BmadScriptTrust } from './bmad-script-trust.js';
import type { Orm } from './db/database.js';
import { workspaces } from './db/schema.js';
import type { Entities } from './entities.js';
import { CommandChangedError, InvalidOperationError, NotFoundError, ScriptsNotTrustedError, issuesOf, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import { newId } from './ids.js';
import { parseProblems } from './project-command-parsers.js';
import { shellFreeCommand } from './shell-free.js';
import { isWorkspacePathRefusal, type WorkspaceFilesPort } from './workspace-files-port.js';
import { resolveWorkspaceRoot } from './workspace-root.js';

/** How one started command ended. */
export interface ProjectCommandExit {
  /** `null` when it was killed, or never started. */
  exitCode: number | null;
  /** Stopped by the user or the server. */
  stopped: boolean;
  /** Why it never started or was cut off, in plain words ("npm wasn't found on this computer."), never raw output. */
  error?: string | undefined;
}

/** One running command. */
export interface ProjectCommandProcess {
  /** Settles once the process has exited (never rejects). */
  readonly done: Promise<ProjectCommandExit>;
  /** Kills its whole process tree; done settles with `stopped`. */
  stop(): void;
  /** Its output so far, raw (core masks it): the last `PROJECT_COMMAND_OUTPUT_MAX_BYTES`, `truncated` when cut. */
  output(): { text: string; truncated: boolean };
}

export interface ProjectCommandRunner {
  /**
   * Starts `argv` (a program, by name or absolute path, and its arguments;
   * never a shell) in `cwd` (the project's real path). A program that can't
   * be found or started settles `done` at once with its plain `error`.
   */
  start(input: { cwd: string; argv: readonly string[] }): ProjectCommandProcess;
  /** Kills every tree still running and refuses new starts; resolves once each has settled. Safe to call twice. */
  close(): Promise<void>;
  /** The same kill, synchronously and without waiting (a crashing server's `process.on('exit')`). */
  killAll?(): void;
}

/** What the Problems routes call (8.9). Every method refuses an untrusted project and a project of another install. */
export interface ProjectCommands {
  list(workspaceId: unknown): Promise<ProjectCommandsResponse>;
  set(workspaceId: unknown, body: unknown): Promise<ProjectCommandsResponse>;
  run(workspaceId: unknown, commandId: unknown): Promise<ProjectCommandRunResponse>;
  get(workspaceId: unknown, runId: unknown): Promise<ProjectCommandRunDetail>;
  stop(workspaceId: unknown, runId: unknown): Promise<ProjectCommandRunResponse>;
  /** Stops every run still going (their finish is recorded) and the runner. */
  close(): Promise<void>;
}

/** The package managers `<pm> run` is offered with, from the lockfile. */
const PackageManager = z.enum(['npm', 'pnpm', 'yarn', 'bun']);
type PackageManager = z.infer<typeof PackageManager>;

/**
 * A declared command as the workspace row keeps it. A script also keeps the
 * package manager it was confirmed with and its binding: a fingerprint of
 * everything that changes what `<pm> run <script>` runs (see `bindingOf`).
 * Neither is ever in a response.
 */
const StoredCommand = z.discriminatedUnion('source', [
  z.object({ id: ProjectCommandId, label: z.string().min(1).max(60), source: z.literal('settings'), command: z.string().min(1) }),
  z.object({
    id: ProjectCommandId,
    label: z.string().min(1).max(60),
    source: z.literal('package_json'),
    script: PackageScriptName,
    confirmedScript: z.string().min(1),
    pm: PackageManager.optional(),
    binding: z.string().optional(),
  }),
]);
type StoredCommand = z.infer<typeof StoredCommand>;

/** The stored commands, or none when the value is damaged. */
export function readProjectCommands(value: string): StoredCommand[] {
  try {
    const parsed = z.array(StoredCommand).max(MAX_PROJECT_COMMANDS).safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
];
/** The scripts detected and offered (never more: AD-38). */
const DETECTED = ['test', 'lint'] as const;

/**
 * The project files that change what `<pm> run <script>` runs (a script
 * shell, workspaces, a yarn binary, hooks): their contents are bound into a
 * confirmed script's fingerprint.
 */
const BINDING_FILES = ['.npmrc', '.yarnrc', '.yarnrc.yml', 'bunfig.toml', '.pnpmfile.cjs', 'pnpm-workspace.yaml'] as const;

/** `text` as Problems keeps it: a cut first line dropped (all of it when it has no line break), escapes stripped, masked. */
export function maskedOutput(text: string, truncated: boolean): string {
  const newline = text.indexOf('\n');
  const whole = !truncated ? text : newline === -1 ? '' : text.slice(newline + 1);
  return redactSecrets(stripTerminalEscapes(whole));
}

/** `package.json` as Problems reads it: every string script, and its `packageManager` field. */
interface PackageJson {
  scripts: Map<string, string>;
  packageManager: string | null;
}

/** One run as core keeps it until the command's next run. */
interface RunRecord {
  run: ProjectCommandRun;
  workspaceId: WorkspaceId;
  process: ProjectCommandProcess | undefined;
  /** Settles once the run's finish is recorded. */
  finished: Promise<void>;
  /** The masked output and parsed items, once finished. */
  result?: { output: string; truncated: boolean; items: ProblemItem[]; parsed: boolean };
  /** While running: the last masked and parsed output, by the raw text it came from, so each poll masks and parses only new output. */
  partial?: { raw: string; truncated: boolean; output: string; items: ProblemItem[]; parsed: boolean };
}

export interface ProjectCommandsDeps {
  orm: Orm;
  events: EventLog;
  entities: Pick<Entities, 'getWorkspace' | 'getSession'>;
  trust: Pick<BmadScriptTrust, 'scriptsTrusted'>;
  /** `package.json` and the lockfiles are read through it (confined to the project, AD-36). */
  files: Pick<WorkspaceFilesPort, 'read' | 'list'>;
  runner: ProjectCommandRunner;
  /**
   * The fingerprint of `files` below a repo (adapters' `projectFilesFingerprint`; `undefined` when unreadable),
   * for the package manager's config files: `.npmrc` is a credential file the files port never reads. Absent:
   * they are read through the files port, and one that exists but can't be read counts as changed.
   */
  filesFingerprint?: ((repoPath: string, files: readonly string[]) => Promise<string | undefined>) | undefined;
  /** The time, for a run's timestamps (a test's clock). */
  now?: () => Date;
}

/** The plain refusal of a command that needs a shell, as a 400. */
const needsShell = (reason: string): ValidationError => new ValidationError(reason, [{ path: ['commands'], message: reason }]);

export function createProjectCommands({ orm, events, entities, trust, files, runner, filesFingerprint, now = () => new Date() }: ProjectCommandsDeps): ProjectCommands {
  /** Every run kept, by id; one per command (the latest). */
  const runs = new Map<string, RunRecord>();
  /** The latest run of each command, by `<workspaceId>\0<commandId>`. */
  const latest = new Map<string, string>();
  const keyOf = (workspaceId: string, commandId: string) => `${workspaceId}\0${commandId}`;

  /** The workspace and its real path, refused before anything else when it isn't trusted. */
  const trusted = (workspaceId: unknown): { id: WorkspaceId; root: string } => {
    const { workspace, root } = resolveWorkspaceRoot(entities, workspaceId);
    if (!trust.scriptsTrusted(workspace.id)) throw new ScriptsNotTrustedError();
    return { id: workspace.id, root: root.path };
  };

  const stored = (workspaceId: WorkspaceId): StoredCommand[] => {
    const row = orm.select({ value: workspaces.projectCommands }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
    if (row === undefined) throw new NotFoundError('workspace', 'requested');
    return readProjectCommands(row.value);
  };

  /** `package.json`'s scripts (only string values) and `packageManager`, or none when it is missing, unreadable or not JSON. */
  const packageJsonOf = async (root: string): Promise<PackageJson> => {
    const scripts = new Map<string, string>();
    let packageManager: string | null = null;
    try {
      const read = await files.read(root, 'package.json');
      if (isWorkspacePathRefusal(read) || read.kind !== 'text') return { scripts, packageManager };
      const json = JSON.parse(read.content) as { scripts?: unknown; packageManager?: unknown };
      if (json === null || typeof json !== 'object') return { scripts, packageManager };
      if (typeof json.packageManager === 'string') packageManager = json.packageManager;
      if (json.scripts === null || typeof json.scripts !== 'object') return { scripts, packageManager };
      for (const [name, text] of Object.entries(json.scripts as Record<string, unknown>)) {
        if (typeof text === 'string' && text !== '' && PackageScriptName.safeParse(name).success) scripts.set(name, text);
      }
    } catch {
      // Not JSON, or unreadable: no scripts.
    }
    return { scripts, packageManager };
  };

  /** A script's text as it may be shown and confirmed: none past the cap. */
  const shownText = (pkg: PackageJson, script: string): string | undefined => {
    const text = pkg.scripts.get(script);
    return text === undefined || text.length > MAX_PROJECT_COMMAND_CHARS ? undefined : text;
  };

  /**
   * The fingerprint of what `<pm> run <script>` runs now: the package
   * manager, the `pre`, main and `post` script texts, the `packageManager`
   * field and the contents (or absence) of {@link BINDING_FILES}.
   * `undefined` when one of those files can't be read as plain text (counts as changed).
   */
  const configsOf = async (root: string): Promise<Record<string, string | null> | string | undefined> => {
    if (filesFingerprint !== undefined) return filesFingerprint(root, BINDING_FILES);
    const configs: Record<string, string | null> = {};
    try {
      const folder = await files.list(root, '');
      if (isWorkspacePathRefusal(folder)) return undefined;
      const present = new Set(folder.entries.map((entry) => entry.name));
      for (const file of BINDING_FILES) {
        if (!present.has(file)) {
          configs[file] = null;
          continue;
        }
        const read = await files.read(root, file);
        if (isWorkspacePathRefusal(read) || read.kind !== 'text' || read.masked) return undefined;
        configs[file] = read.content;
      }
    } catch {
      return undefined;
    }
    return configs;
  };

  const bindingOf = async (root: string, pkg: PackageJson, pm: PackageManager, script: string): Promise<string | undefined> => {
    const configs = await configsOf(root);
    if (configs === undefined) return undefined;
    const scripts = { pre: pkg.scripts.get(`pre${script}`) ?? null, main: pkg.scripts.get(script) ?? null, post: pkg.scripts.get(`post${script}`) ?? null };
    return createHash('sha256').update(JSON.stringify({ pm, scripts, packageManager: pkg.packageManager, configs })).digest('hex');
  };

  /** Whether a stored script is still exactly what the user confirmed: its text, its package manager and its binding. */
  const stillConfirmed = async (root: string, pkg: PackageJson, pm: PackageManager, command: Extract<StoredCommand, { source: 'package_json' }>): Promise<boolean> => {
    const text = shownText(pkg, command.script);
    if (text === undefined || text !== command.confirmedScript || command.pm !== pm || command.binding === undefined) return false;
    return (await bindingOf(root, pkg, pm, command.script)) === command.binding;
  };

  /** The package manager its lockfile names; npm without one. */
  const packageManagerOf = async (root: string): Promise<PackageManager> => {
    try {
      const folder = await files.list(root, '');
      if (isWorkspacePathRefusal(folder)) return 'npm';
      const names = new Set(folder.entries.filter((entry) => entry.kind === 'file').map((entry) => entry.name));
      return LOCKFILES.find(([file]) => names.has(file))?.[1] ?? 'npm';
    } catch {
      return 'npm';
    }
  };

  const lastRunOf = (workspaceId: string, commandId: string): ProjectCommandRun | null => {
    const runId = latest.get(keyOf(workspaceId, commandId));
    const record = runId === undefined ? undefined : runs.get(runId);
    return record === undefined ? null : { ...record.run };
  };

  /** What the project's commands look like now, and the scripts offered. */
  const view = async (workspaceId: WorkspaceId, root: string): Promise<ProjectCommandsResponse & { pm: PackageManager; pkg: PackageJson; stored: StoredCommand[] }> => {
    const commands = stored(workspaceId);
    const [pkg, pm] = await Promise.all([packageJsonOf(root), packageManagerOf(root)]);
    const declared: ProjectCommand[] = [];
    for (const command of commands) {
      if (command.source === 'settings') {
        declared.push({ id: command.id, label: command.label, command: command.command, source: 'settings', confirmed: true, lastRun: lastRunOf(workspaceId, command.id) });
        continue;
      }
      const scriptText = shownText(pkg, command.script);
      declared.push({
        id: command.id,
        label: command.label,
        command: `${pm} run ${command.script}`,
        source: 'package_json',
        confirmed: await stillConfirmed(root, pkg, pm, command),
        script: command.script,
        ...(scriptText === undefined ? {} : { scriptText }),
        lastRun: lastRunOf(workspaceId, command.id),
      });
    }
    const ids = new Set(commands.map((command) => command.id));
    const declaredScripts = new Set(commands.flatMap((command) => (command.source === 'package_json' ? [command.script] : [])));
    const offered: ProjectCommand[] = DETECTED.flatMap((name) => {
      const scriptText = shownText(pkg, name);
      if (scriptText === undefined || declaredScripts.has(name) || ids.has(name)) return [];
      return [{ id: name, label: PROBLEMS_DETECTED_LABELS[name], command: `${pm} run ${name}`, source: 'package_json' as const, confirmed: false, script: name, scriptText, lastRun: null }];
    });
    return { declared, offered, pm, pkg, stored: commands };
  };

  const answer = ({ declared, offered }: ProjectCommandsResponse): ProjectCommandsResponse => ({ declared, offered });

  /** Records a finished run: its masked output, its items, and one finished event. */
  const finish = (record: RunRecord, exit: { exitCode: number | null; stopped: boolean; error?: string | undefined }, raw: { text: string; truncated: boolean }, root: string): void => {
    const output = maskedOutput(raw.text, raw.truncated);
    const error = exit.error === undefined ? undefined : redactSecrets(exit.error);
    const shown = error === undefined ? output : output === '' ? error : `${output}${output.endsWith('\n') ? '' : '\n'}${error}`;
    const { items, parsed } = parseProblems(output, root);
    const state: ProjectCommandRun['state'] = exit.stopped ? 'stopped' : exit.error !== undefined ? 'error' : exit.exitCode === 0 ? 'passed' : 'failed';
    record.run = { ...record.run, state, exitCode: exit.stopped ? null : exit.exitCode, itemCount: items.length, finishedAt: now().toISOString() };
    record.result = { output: shown, truncated: raw.truncated, items, parsed };
    record.process = undefined;
    try {
      events.append({
        type: 'workspace.project_command_finished',
        workspaceId: record.workspaceId,
        streamId: record.workspaceId,
        payload: { runId: record.run.id, commandId: record.run.commandId, state, exitCode: record.run.exitCode, itemCount: items.length },
      });
    } catch {
      // The database closed under a stopping server: the run is still recorded in memory.
    }
  };

  const recordOf = (workspaceId: WorkspaceId, runId: unknown): RunRecord => {
    const id = ProjectCommandRunId.safeParse(runId);
    const record = id.success ? runs.get(id.data) : undefined;
    if (record === undefined || record.workspaceId !== workspaceId) throw new NotFoundError('run', 'requested');
    return record;
  };

  let closed = false;
  return {
    async list(workspaceId) {
      const { id, root } = trusted(workspaceId);
      return answer(await view(id, root));
    },

    async set(workspaceId, body) {
      const { id, root } = trusted(workspaceId);
      const parsed = SetProjectCommandsRequest.safeParse(body);
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? 'Those are not commands Ogden can save.';
        throw new ValidationError(message, issuesOf(parsed.error));
      }
      const current = await view(id, root);
      const before = new Map(current.stored.map((command) => [command.id, command]));
      const next: StoredCommand[] = [];
      for (const input of parsed.data.commands) next.push(await (async (): Promise<StoredCommand> => {
        if (input.source === 'settings') {
          const checked = shellFreeCommand(input.command);
          if (!checked.ok) throw needsShell(PROJECT_COMMAND_REFUSALS[checked.refusal]);
          return { id: input.id, label: input.label, source: 'settings', command: input.command };
        }
        const script = input.script!;
        const text = shownText(current.pkg, script);
        // What runs is `<pm> run <script>`: the text the user saw must still be that.
        if (input.command !== `${current.pm} run ${script}`) throw new CommandChangedError();
        if (input.confirmedScript === undefined) {
          const kept = before.get(input.id);
          if (kept === undefined || kept.source !== 'package_json' || kept.script !== script) {
            const message = "Confirm the script's text.";
            throw new ValidationError(message, [{ path: ['commands', 'confirmedScript'], message }]);
          }
          return { ...kept, label: input.label };
        }
        if (text === undefined || text !== input.confirmedScript) throw new CommandChangedError();
        // Confirmed again: the package manager and the binding as they are now.
        const binding = await bindingOf(root, current.pkg, current.pm, script);
        if (binding === undefined) throw new CommandChangedError();
        return { id: input.id, label: input.label, source: 'package_json', script, confirmedScript: input.confirmedScript, pm: current.pm, binding };
      })());
      events.transaction(() => {
        orm.update(workspaces).set({ projectCommands: JSON.stringify(next) }).where(eq(workspaces.id, id)).run();
        events.append({ type: 'workspace.project_commands_changed', workspaceId: id, streamId: id, payload: { count: next.length } });
      });
      return answer(await view(id, root));
    },

    async run(workspaceId, commandId) {
      const { id, root } = trusted(workspaceId);
      const commandKey = ProjectCommandId.safeParse(commandId);
      const command = commandKey.success ? stored(id).find((one) => one.id === commandKey.data) : undefined;
      if (command === undefined) throw new NotFoundError('command', 'requested');
      if (closed) throw new InvalidOperationError('Ogden is stopping, so nothing new runs.');
      let argv: string[];
      if (command.source === 'settings') {
        const checked = shellFreeCommand(command.command);
        if (!checked.ok) throw needsShell(PROJECT_COMMAND_REFUSALS[checked.refusal]);
        argv = checked.argv;
      } else {
        const [pkg, pm] = await Promise.all([packageJsonOf(root), packageManagerOf(root)]);
        if (!(await stillConfirmed(root, pkg, pm, command))) throw new CommandChangedError();
        argv = [pm, 'run', command.script];
      }
      // Read again after the reads above: one run per command at a time, still trusted, and not stopping.
      if (!trust.scriptsTrusted(id)) throw new ScriptsNotTrustedError();
      if (closed) throw new InvalidOperationError('Ogden is stopping, so nothing new runs.');
      const previous = latest.get(keyOf(id, command.id));
      const previousRecord = previous === undefined ? undefined : runs.get(previous);
      if (previousRecord?.run.state === 'running') throw new InvalidOperationError('This command is already running. Stop it first, or wait for it to finish.');

      const run: ProjectCommandRun = { id: newId('pcr'), commandId: command.id, state: 'running', exitCode: null, itemCount: 0, startedAt: now().toISOString(), finishedAt: null };
      events.append({ type: 'workspace.project_command_started', workspaceId: id, streamId: id, payload: { runId: run.id, commandId: command.id } });
      const child = runner.start({ cwd: root, argv });
      const record: RunRecord = { run, workspaceId: id, process: child, finished: Promise.resolve() };
      record.finished = child.done.then(
        (exit) => finish(record, exit, child.output(), root),
        () => finish(record, { exitCode: null, stopped: false, error: "Ogden couldn't run this command." }, child.output(), root),
      );
      if (previous !== undefined) runs.delete(previous);
      runs.set(run.id, record);
      latest.set(keyOf(id, command.id), run.id);
      return { run: { ...record.run } };
    },

    async get(workspaceId, runId) {
      const { id, root } = trusted(workspaceId);
      const record = recordOf(id, runId);
      if (record.result !== undefined) return { run: { ...record.run }, ...record.result };
      // Still running: the output so far, masked, and what it shows yet.
      const raw = record.process?.output() ?? { text: '', truncated: false };
      // A string compare (the length first) is far cheaper than masking and parsing up to 1 MiB again.
      if (record.partial === undefined || record.partial.truncated !== raw.truncated || record.partial.raw.length !== raw.text.length || record.partial.raw !== raw.text) {
        const output = maskedOutput(raw.text, raw.truncated);
        record.partial = { raw: raw.text, truncated: raw.truncated, output, ...parseProblems(output, root) };
      }
      const { output, items, parsed } = record.partial;
      return { run: { ...record.run }, output, truncated: raw.truncated, items, parsed };
    },

    async stop(workspaceId, runId) {
      const { id } = trusted(workspaceId);
      const record = recordOf(id, runId);
      if (record.run.state === 'running') {
        record.process?.stop();
        await record.finished;
      }
      return { run: { ...record.run } };
    },

    async close() {
      closed = true;
      const going = [...runs.values()].filter((record) => record.run.state === 'running');
      for (const record of going) record.process?.stop();
      await Promise.all(going.map((record) => record.finished));
      await runner.close();
    },
  };
}
