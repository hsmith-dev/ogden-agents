/**
 * `shortcut-os` (story 2.4, E2-R10): the `AppShortcutPort` that puts Ogden
 * Agents in the OS app menu, per user and with no admin. The shortcut runs
 * only `node <install>/bin/ogden.js`, pinned to this install's Node, and that
 * launcher starts or finds the server and opens a fresh launch link: the
 * shortcut holds no URL, token, code, key or environment value (AD-15, AD-16),
 * and no terminal stays open (AD-21).
 *
 * - macOS: `~/Applications/Ogden Agents.app` (`macos.ts`).
 * - Windows: `Ogden Agents.lnk` in the Start Menu `Programs` (`windows.ts`).
 * - Linux: `ogden-agents.desktop` under `$XDG_DATA_HOME/applications` (`linux.ts`).
 *
 * Whether the first-run offer was answered is kept in
 * `<stateDir>/app-shortcut.json`. Every folder can be injected, so tests
 * write only into temp folders.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppShortcutPort } from '@ogden-agents/core';
import { createLinuxWriter, defaultXdgDataHome } from './linux.js';
import { createMacosWriter } from './macos.js';
import { ShortcutRefusal } from './refusal.js';
import type { ShortcutWriter } from './types.js';
import { createWindowsWriter, defaultProgramsDir, runPowerShell as defaultRunPowerShell, type PowerShellRunner } from './windows.js';

export { desktopExecArg, shQuote, xmlEscape } from './escape.js';
export { DESKTOP_FILE_NAME, DESKTOP_MARKER, desktopEntry } from './linux.js';
export { createMacosWriter, infoPlist, launcherScript, MACOS_APP_NAME, MACOS_BUNDLE_ID, MACOS_EXECUTABLE, type MacosFs } from './macos.js';
export { ShortcutRefusal } from './refusal.js';
export type { ShortcutTarget } from './types.js';
export {
  CREATE_LINK_SCRIPT,
  LINK_DESCRIPTION,
  LINK_ENV,
  parseLinkFields,
  powerShellInvocation,
  READ_LINK_SCRIPT,
  WINDOWS_LINK_NAME,
  type LinkFields,
  type PowerShellRunner,
} from './windows.js';

/** `<stateDir>/<this>`: `{ "offerDismissed": true }` once the first-run offer is answered. */
export const APP_SHORTCUT_STATE_FILE = 'app-shortcut.json';

export interface OsAppShortcutOptions {
  /** `process.platform`: `darwin`, `win32` and `linux` are supported. */
  platform: string;
  /** This install's `bin/ogden.js`; without it no shortcut can be added. */
  launcherEntry: string | undefined;
  /** The Node that runs the launcher (`process.execPath`). */
  nodePath: string;
  /** The Ogden Agents data folder: the offer state, and (macOS) `logs/launcher.log`. */
  stateDir: string;
  /** Default `os.homedir()`. macOS writes to `<homeDir>/Applications`. */
  homeDir?: string;
  /** Windows: the Start Menu `Programs` folder. Default `%APPDATA%\Microsoft\Windows\Start Menu\Programs`. */
  programsDir?: string;
  /** Linux: default `$XDG_DATA_HOME`, else `<homeDir>/.local/share`. */
  xdgDataHome?: string;
  /** Windows: how PowerShell runs (tests). Default `powershell.exe -EncodedCommand`. */
  runPowerShell?: PowerShellRunner;
}

const UNSUPPORTED = "An app shortcut can't be added on this computer. Run npx ogden-agents in a terminal to open Ogden Agents.";

function writerFor(options: OsAppShortcutOptions): ShortcutWriter | undefined {
  const home = options.homeDir ?? homedir();
  switch (options.platform) {
    case 'darwin':
      return createMacosWriter(join(home, 'Applications'));
    case 'win32':
      return createWindowsWriter(options.programsDir ?? defaultProgramsDir(process.env, home), options.runPowerShell ?? defaultRunPowerShell, home);
    case 'linux':
      return createLinuxWriter(options.xdgDataHome ?? defaultXdgDataHome(process.env, home));
    default:
      return undefined;
  }
}

/** A refusal as it is; anything else in plain words, the original kept as `cause`. */
function plain(error: unknown, what: string): ShortcutRefusal {
  return error instanceof ShortcutRefusal ? error : new ShortcutRefusal(what, { cause: error });
}

export function createOsAppShortcut(options: OsAppShortcutOptions): AppShortcutPort {
  const writer = options.launcherEntry === undefined ? undefined : writerFor(options);
  const stateFile = join(options.stateDir, APP_SHORTCUT_STATE_FILE);

  const offerDismissed = (): boolean => {
    try {
      return (JSON.parse(readFileSync(stateFile, 'utf8')) as { offerDismissed?: unknown }).offerDismissed === true;
    } catch {
      return false;
    }
  };

  return {
    status: async () => ({
      platform: options.platform,
      supported: writer !== undefined,
      installed: (await writer?.isInstalled()) ?? false,
      offerDismissed: offerDismissed(),
    }),
    add: async () => {
      if (writer === undefined || options.launcherEntry === undefined) throw new ShortcutRefusal(UNSUPPORTED);
      try {
        await writer.install({ nodePath: options.nodePath, launcherEntry: options.launcherEntry, logDir: join(options.stateDir, 'logs') });
      } catch (error) {
        throw plain(error, "Ogden Agents couldn't add the app shortcut.");
      }
    },
    remove: async () => {
      if (writer === undefined) return;
      try {
        await writer.remove();
      } catch (error) {
        throw plain(error, "Ogden Agents couldn't remove the app shortcut.");
      }
    },
    dismissOffer: async () => {
      try {
        mkdirSync(options.stateDir, { recursive: true });
        const temp = `${stateFile}.${process.pid}.tmp`;
        writeFileSync(temp, `${JSON.stringify({ offerDismissed: true })}\n`);
        renameSync(temp, stateFile);
      } catch (error) {
        throw plain(error, "Ogden Agents couldn't save your answer. Try again.");
      }
    },
  };
}
