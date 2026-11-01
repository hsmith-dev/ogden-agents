/**
 * `editor-launcher-node` (AD-39, E8-R9; story 8.10): the real
 * `EditorLauncherPort`. A fixed list of editors ({@link EDITORS}), each found
 * as a bare name on the absolute folders of `PATH` or at its known install
 * places (which cover a server started from the desktop, whose `PATH` is
 * short). The program is only ever one of this list, resolved afresh at each
 * open (never a path from the client, never kept from an earlier list); the
 * file is the absolute real path the files port located.
 *
 * Started with argv only: no shell, no URL scheme, no `open -a`, no
 * `xdg-open`. A Windows `.cmd` or `.bat` goes through `cmd.exe /d /s /v:off
 * /c` with every argument quoted, verbatim; a shim path or an argument
 * holding a character cmd reads as its own is refused, nothing started. The
 * environment is AD-16's allowlist with the desktop session's variables (PATH
 * kept to absolute folders), the working folder the user's home (the
 * filesystem's root without one; `program-launch.ts`), detached and unreferenced: Ogden never
 * waits on an editor. An editor is never probed with `--version` (a
 * JetBrains launcher would start the IDE). Nothing is logged here.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { posix, win32 } from 'node:path';
import type { EditorLauncherPort } from '@ogden-agents/core';
import type { EditorId, EditorInfo } from '@ogden-agents/shared';
import { DESKTOP_SESSION } from '../child-env.js';
import { launchEnvironment, safeWorkingFolder, windowsCmd } from '../program-launch.js';
import { candidatesFor, nodeDetectSystem, type DetectSystem } from '../pane-launchers/detect.js';

/** How an editor takes a line: `goto` = `-g path:l:c`, `colon` = `path:l:c`, `jetbrains` = `--line l --column c path`. */
export type EditorSyntax = 'goto' | 'colon' | 'jetbrains';

/** One editor of the fixed list. */
export interface EditorDefinition {
  id: EditorId;
  name: string;
  syntax: EditorSyntax;
  /** Per OS, in order: bare names (searched on `PATH`) and absolute install places (`~`, `%VAR%`). */
  executables: { darwin: readonly string[]; linux: readonly string[]; win32: readonly string[] };
}

const jetbrains = (id: EditorId, name: string): EditorDefinition => ({
  id,
  name,
  syntax: 'jetbrains',
  executables: {
    darwin: [id, `~/Library/Application Support/JetBrains/Toolbox/scripts/${id}`],
    linux: [id, `${id}.sh`, `~/.local/share/JetBrains/Toolbox/scripts/${id}`],
    win32: [`${id}64`, id, `%LOCALAPPDATA%\\JetBrains\\Toolbox\\scripts\\${id}.cmd`],
  },
});

/** The editors Ogden looks for; the order is the default order. */
export const EDITORS: readonly EditorDefinition[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    syntax: 'goto',
    executables: {
      darwin: ['code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', '~/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', '/usr/local/bin/code', '/opt/homebrew/bin/code'],
      linux: ['code', '/usr/bin/code', '/snap/bin/code', '/usr/share/code/bin/code'],
      win32: ['code', '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\bin\\code.cmd', '%ProgramFiles%\\Microsoft VS Code\\bin\\code.cmd'],
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    syntax: 'goto',
    executables: {
      darwin: ['cursor', '/Applications/Cursor.app/Contents/Resources/app/bin/cursor', '~/Applications/Cursor.app/Contents/Resources/app/bin/cursor'],
      linux: ['cursor', '/usr/bin/cursor'],
      win32: ['cursor', '%LOCALAPPDATA%\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd'],
    },
  },
  {
    id: 'zed',
    name: 'Zed',
    syntax: 'colon',
    executables: {
      darwin: ['zed', '/Applications/Zed.app/Contents/MacOS/cli', '/usr/local/bin/zed', '~/.local/bin/zed'],
      linux: ['zed', 'zeditor', '~/.local/bin/zed'],
      win32: ['zed', '%LOCALAPPDATA%\\Programs\\Zed\\bin\\zed.exe'],
    },
  },
  jetbrains('idea', 'IntelliJ IDEA'),
  jetbrains('webstorm', 'WebStorm'),
  jetbrains('pycharm', 'PyCharm'),
  jetbrains('goland', 'GoLand'),
  jetbrains('clion', 'CLion'),
  jetbrains('phpstorm', 'PhpStorm'),
  jetbrains('rubymine', 'RubyMine'),
  jetbrains('rider', 'Rider'),
  jetbrains('rustrover', 'RustRover'),
];

/** What the launcher needs of the computer; replaced in tests (and, in a test run, confined to the test's folder). */
export interface EditorSystem extends Pick<DetectSystem, 'platform' | 'env' | 'runnable'> {
  /** Starts `file` with `args` (never a shell). */
  start(file: string, args: readonly string[], options: SpawnOptions): Pick<ChildProcess, 'once' | 'on' | 'unref'>;
}

export const nodeEditorSystem: EditorSystem = {
  get platform() {
    return nodeDetectSystem.platform;
  },
  get env() {
    return nodeDetectSystem.env;
  },
  runnable: (path) => nodeDetectSystem.runnable(path),
  start: (file, args, options) => spawn(file, [...args], { ...options, env: options.env ?? {}, shell: false }),
};

/** Only these start on Windows without a shell (as `linked-command.ts`). */
const WINDOWS_STARTABLE = /\.(?:exe|com)$/i;
const WINDOWS_SHIM = /\.(?:cmd|bat)$/i;
/** A character cmd.exe reads as its own (or a control character): never passed through a shim. */
const CMD_UNSAFE = /["%^!&|<>()\u0000-\u001f\u007f]/;

const platformKey = (platform: NodeJS.Platform): 'darwin' | 'linux' | 'win32' => (platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux');

const positive = (value: number | undefined): value is number => value !== undefined && Number.isSafeInteger(value) && value >= 1;

export interface EditorLauncherNodeOptions {
  system?: EditorSystem;
}

/** The first runnable candidate of `editor` on this computer, or `undefined`. */
function resolve(editor: EditorDefinition, system: EditorSystem): string | undefined {
  const win = system.platform === 'win32';
  for (const entry of editor.executables[platformKey(system.platform)]) {
    for (const candidate of candidatesFor(entry, system)) {
      // On Windows only an `.exe`, `.com` or a shim (through cmd.exe) starts; anything else PATHEXT names is passed over.
      if (win && !WINDOWS_STARTABLE.test(candidate) && !WINDOWS_SHIM.test(candidate)) continue;
      if (system.runnable(candidate)) return candidate;
    }
  }
  return undefined;
}

/** The editor's own arguments for `path` at `line` and `column` (`:1:1` when absent for the `path:l:c` editors), or `undefined` when the path can't be passed so. */
export function editorArguments(syntax: EditorSyntax, path: string, line: number | undefined, column: number | undefined, platform: NodeJS.Platform): string[] | undefined {
  const l = positive(line) ? line : 1;
  const c = positive(column) ? column : 1;
  if (syntax === 'jetbrains') return positive(line) ? ['--line', String(l), '--column', String(c), path] : [path];
  // `path:l:c`: a colon in the path itself (beyond a Windows drive's) would be read as the line.
  const rest = platform === 'win32' ? path.replace(/^[A-Za-z]:/, '') : path;
  if (rest.includes(':')) return undefined;
  const target = `${path}:${l}:${c}`;
  return syntax === 'goto' ? ['-g', target] : [target];
}

/** What to start: the program and its argv (a shim through cmd.exe), or `undefined` when it is refused. */
export function editorCommand(program: string, args: readonly string[], env: Readonly<Record<string, string>>, platform: NodeJS.Platform): { file: string; args: string[]; verbatim: boolean } | undefined {
  if (platform !== 'win32') return { file: program, args: [...args], verbatim: false };
  if (WINDOWS_STARTABLE.test(program)) return { file: program, args: [...args], verbatim: false };
  if (!WINDOWS_SHIM.test(program)) return undefined;
  // Node won't start a batch file without a shell: cmd.exe, no AutoRun, delayed expansion off, the whole command in one more pair of quotes.
  if (CMD_UNSAFE.test(program) || args.some((arg) => CMD_UNSAFE.test(arg))) return undefined;
  // Only a drive-letter path (no share, no path relative to the current drive's root) for either.
  return { file: windowsCmd(env), args: ['/d', '/s', '/v:off', '/c', `""${program}" ${args.map((arg) => `"${arg}"`).join(' ')}"`], verbatim: true };
}

/**
 * The editor's environment: AD-16's allowlist with the desktop session, its
 * PATH kept to absolute folders only (an empty entry, `.` or a relative one
 * would let a launcher script's bare `dirname` run a program from its folder).
 */
export function editorEnvironment(system: Pick<EditorSystem, 'platform' | 'env'>): Record<string, string> {
  return launchEnvironment(DESKTOP_SESSION, system.env, system.platform);
}

export function createEditorLauncherNode({ system = nodeEditorSystem }: EditorLauncherNodeOptions = {}): EditorLauncherPort {
  return {
    async list(): Promise<EditorInfo[]> {
      return EDITORS.flatMap((editor) => (resolve(editor, system) === undefined ? [] : [{ id: editor.id, name: editor.name }]));
    },
    async open(editorId, absolutePath, line, column) {
      const editor = EDITORS.find((one) => one.id === editorId);
      if (editor === undefined) return 'unavailable';
      const paths = system.platform === 'win32' ? win32 : posix;
      // The located real path, checked again: absolute, one line, and never something an editor reads as a flag.
      if (typeof absolutePath !== 'string' || !paths.isAbsolute(absolutePath) || /[\u0000-\u001f\u007f]/.test(absolutePath) || absolutePath.startsWith('-')) return 'unavailable';
      if ((line !== undefined && !positive(line)) || (column !== undefined && !positive(column))) return 'unavailable';
      // Resolved now, from the fixed list: an editor removed since the list was read is not started.
      const program = resolve(editor, system);
      if (program === undefined) return 'unavailable';
      const args = editorArguments(editor.syntax, absolutePath, line, column, system.platform);
      if (args === undefined) return 'unavailable';
      const env = editorEnvironment(system);
      const command = editorCommand(program, args, env, system.platform);
      if (command === undefined) return 'unavailable';
      return new Promise((done) => {
        let settled = false;
        const settle = (answer: 'opened' | 'unavailable') => {
          if (settled) return;
          settled = true;
          done(answer);
        };
        try {
          const child = system.start(command.file, command.args, {
            env,
            cwd: safeWorkingFolder(env, system.platform),
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            windowsVerbatimArguments: command.verbatim,
            shell: false,
          });
          // Kept for the child's life: a later error must never go unhandled.
          child.on('error', () => settle('unavailable'));
          child.once('spawn', () => settle('opened'));
          child.unref();
        } catch {
          settle('unavailable');
        }
      });
    },
  };
}
