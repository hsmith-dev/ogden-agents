/**
 * The Windows app shortcut (story 2.4): `Ogden Agents.lnk` in the user's
 * Start Menu `Programs` folder, made with Windows PowerShell and
 * `WScript.Shell` (no admin). It runs `node.exe "<bin>"` minimized
 * (`WindowStyle=7`): a console sits in the taskbar for about a second while
 * the launcher starts the server and opens the browser (AD-21). It holds no
 * URL, token or key (AD-15, AD-16).
 *
 * The scripts are fixed text fed on stdin; every path reaches them as an
 * environment variable, so no path can be read as code. A link is ours only
 * if its Description is {@link LINK_DESCRIPTION}: any other link of the same
 * name is never replaced or removed. A link that already points where it
 * should is not rewritten (the server re-points it at every start).
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ShortcutRefusal } from './refusal.js';
import type { ShortcutTarget, ShortcutWriter } from './types.js';

export const WINDOWS_LINK_NAME = 'Ogden Agents.lnk';
/** Written on every link Ogden Agents makes; how `add` and `remove` tell ours. */
export const LINK_DESCRIPTION = 'Open Ogden Agents';

/** Runs a PowerShell script with extra environment variables; resolves with its stdout. */
export type PowerShellRunner = (script: string, env: Readonly<Record<string, string>>) => Promise<string>;

/** How long PowerShell may take. */
const POWERSHELL_TIMEOUT_MS = 30_000;

/** The environment variables the scripts read. */
export const LINK_ENV = {
  path: 'OGDEN_AGENTS_LINK_PATH',
  node: 'OGDEN_AGENTS_LINK_NODE',
  bin: 'OGDEN_AGENTS_LINK_BIN',
  workDir: 'OGDEN_AGENTS_LINK_WORKDIR',
} as const;

/**
 * One line, so `-Command -` runs it as one statement; a failure exits 1 with
 * the reason on stderr (which is never shown or logged: the adapter replaces
 * it with plain words).
 */
const oneLine = (statements: readonly string[]) =>
  `try { $ErrorActionPreference = 'Stop'; ${statements.join('; ')} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }\n`;

/** Writes the link. Fixed text: every value comes from `$env:`. */
export const CREATE_LINK_SCRIPT = oneLine([
  '$shell = New-Object -ComObject WScript.Shell',
  `$link = $shell.CreateShortcut($env:${LINK_ENV.path})`,
  `$link.TargetPath = $env:${LINK_ENV.node}`,
  `$link.Arguments = '"' + $env:${LINK_ENV.bin} + '"'`,
  `$link.WorkingDirectory = $env:${LINK_ENV.workDir}`,
  '$link.WindowStyle = 7',
  `$link.Description = '${LINK_DESCRIPTION}'`,
  '$link.Save()',
]);

/**
 * Prints the link's fields as JSON in UTF-8, base64-encoded: plain ASCII on
 * stdout, so no console code page can garble a path.
 */
export const READ_LINK_SCRIPT = oneLine([
  `$link = (New-Object -ComObject WScript.Shell).CreateShortcut($env:${LINK_ENV.path})`,
  '$json = [pscustomobject]@{ targetPath = $link.TargetPath; arguments = $link.Arguments; workingDirectory = $link.WorkingDirectory; description = $link.Description } | ConvertTo-Json -Compress',
  '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))',
]);

/** What `READ_LINK_SCRIPT` prints. */
export interface LinkFields {
  targetPath: string;
  arguments: string;
  workingDirectory: string;
  description: string;
}

/** Windows PowerShell by absolute path (no `PATH` lookup), reading its script from stdin. */
export function powerShellInvocation(env: NodeJS.ProcessEnv = process.env): { file: string; args: string[] } {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
  return {
    file: `${systemRoot.replace(/[\\/]+$/, '')}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
  };
}

/** Runs the script on PowerShell's stdin, with no window and a timeout. */
export const runPowerShell: PowerShellRunner = (script, env) =>
  new Promise((resolve, reject) => {
    const { file, args } = powerShellInvocation();
    const child = execFile(file, args, { env: { ...process.env, ...env }, timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true }, (error, stdout) =>
      error === null ? resolve(String(stdout)) : reject(error),
    );
    // A failed start or early exit is reported through the callback; the pipe error adds nothing.
    child.stdin?.on('error', () => {});
    child.stdin?.end(script);
  });

/** The fields from `READ_LINK_SCRIPT`'s output (base64 of JSON), or throws. */
export function parseLinkFields(stdout: string): LinkFields {
  const line = stdout.trim().split(/\r?\n/).at(-1) ?? '';
  const value = JSON.parse(Buffer.from(line, 'base64').toString('utf8')) as Partial<Record<keyof LinkFields, unknown>>;
  const text = (field: unknown) => (typeof field === 'string' ? field : '');
  return { targetPath: text(value.targetPath), arguments: text(value.arguments), workingDirectory: text(value.workingDirectory), description: text(value.description) };
}

/** The user's Start Menu `Programs` folder: `%APPDATA%\Microsoft\Windows\Start Menu\Programs`. */
export function defaultProgramsDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const appData = env.APPDATA || join(home, 'AppData', 'Roaming');
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
}

const FOREIGN = 'There is already an Ogden Agents shortcut in the Start menu that Ogden Agents did not make, so it was left alone.';

export function createWindowsWriter(programsDir: string, run: PowerShellRunner, workDir: string): ShortcutWriter {
  const link = join(programsDir, WINDOWS_LINK_NAME);
  /** The link's fields, or `undefined` when there is none. */
  const read = async (): Promise<LinkFields | undefined> => {
    if (!existsSync(link)) return undefined;
    return parseLinkFields(await run(READ_LINK_SCRIPT, { [LINK_ENV.path]: link }));
  };
  return {
    isInstalled: async () => {
      try {
        return (await read())?.description === LINK_DESCRIPTION;
      } catch {
        return false;
      }
    },
    install: async (target: ShortcutTarget) => {
      const current = await read();
      if (current !== undefined) {
        if (current.description !== LINK_DESCRIPTION) throw new ShortcutRefusal(FOREIGN);
        // Already pointing here: nothing to write.
        if (current.targetPath === target.nodePath && current.arguments === `"${target.launcherEntry}"` && current.workingDirectory === workDir) return;
      }
      mkdirSync(programsDir, { recursive: true });
      await run(CREATE_LINK_SCRIPT, {
        [LINK_ENV.path]: link,
        [LINK_ENV.node]: target.nodePath,
        [LINK_ENV.bin]: target.launcherEntry,
        [LINK_ENV.workDir]: workDir,
      });
    },
    remove: async () => {
      const current = await read();
      if (current === undefined) return;
      if (current.description !== LINK_DESCRIPTION) throw new ShortcutRefusal('The Ogden Agents shortcut in the Start menu was not made by Ogden Agents, so it was left alone.');
      rmSync(link, { force: true });
    },
  };
}
