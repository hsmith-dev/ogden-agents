/**
 * The Linux app shortcut (story 2.4):
 * `${XDG_DATA_HOME:-~/.local/share}/applications/ogden-agents.desktop`, which
 * runs the launcher with this install's Node and no terminal (AD-21). It holds
 * no URL, token or key (AD-15, AD-16). A marker key tells ours from a file of
 * the same name someone else wrote, which is never replaced or removed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { desktopExecArg } from './escape.js';
import { ShortcutRefusal } from './refusal.js';
import type { ShortcutTarget, ShortcutWriter } from './types.js';

export const DESKTOP_FILE_NAME = 'ogden-agents.desktop';
/** In every file Ogden Agents writes, so `add` and `remove` touch only ours. */
export const DESKTOP_MARKER = 'X-Ogden-Agents-Launcher=true';

export function desktopEntry(target: ShortcutTarget): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=Ogden Agents',
    'Comment=Open Ogden Agents in your browser',
    `Exec=${desktopExecArg(target.nodePath)} ${desktopExecArg(target.launcherEntry)}`,
    'Terminal=false',
    'Categories=Development;',
    DESKTOP_MARKER,
    '',
  ].join('\n');
}

/** `${XDG_DATA_HOME:-~/.local/share}` (an empty or relative value is ignored, as the spec says). */
export function defaultXdgDataHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const value = env.XDG_DATA_HOME;
  return value !== undefined && value.startsWith('/') ? value : join(home, '.local', 'share');
}

const isOurs = (file: string): boolean => {
  try {
    return readFileSync(file, 'utf8').split('\n').includes(DESKTOP_MARKER);
  } catch {
    return false;
  }
};

export function createLinuxWriter(xdgDataHome: string): ShortcutWriter {
  const dir = join(xdgDataHome, 'applications');
  const file = join(dir, DESKTOP_FILE_NAME);
  return {
    isInstalled: async () => existsSync(file) && isOurs(file),
    install: async (target) => {
      const text = desktopEntry(target);
      if (existsSync(file) && !isOurs(file)) {
        throw new ShortcutRefusal('There is already an Ogden Agents app menu entry that Ogden Agents did not make, so it was left alone.');
      }
      mkdirSync(dir, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      try {
        writeFileSync(temp, text);
        renameSync(temp, file);
      } finally {
        rmSync(temp, { force: true });
      }
    },
    remove: async () => {
      if (!existsSync(file)) return;
      if (!isOurs(file)) throw new ShortcutRefusal('The Ogden Agents app menu entry was not made by Ogden Agents, so it was left alone.');
      rmSync(file, { force: true });
    },
  };
}
