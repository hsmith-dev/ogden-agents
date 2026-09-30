/**
 * The macOS app shortcut (story 2.4): `~/Applications/Ogden Agents.app`, a
 * bundle whose executable is an sh script that runs the launcher with this
 * install's Node and discards nothing: its output goes to the launcher log.
 * `LSUIElement` keeps it out of the Dock while it runs (it exits within
 * seconds), and no terminal opens (AD-21). It holds no URL, token or key
 * (AD-15, AD-16). No Dock preference is edited; the UI hints to drag it there.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shQuote, xmlEscape } from './escape.js';
import { ShortcutRefusal } from './refusal.js';
import type { ShortcutTarget, ShortcutWriter } from './types.js';

/** The bundle's identifier: `remove` and `add` touch only a bundle that has it. */
export const MACOS_BUNDLE_ID = 'dev.ogden-agents.launcher';
export const MACOS_APP_NAME = 'Ogden Agents.app';
/** `Contents/MacOS/<this>`. */
export const MACOS_EXECUTABLE = 'ogden-agents';

const FOREIGN = 'There is already an app called Ogden Agents in your Applications folder that Ogden Agents did not make. Move or rename it, then try again.';

export function infoPlist(): string {
  const entries: Array<[string, string]> = [
    ['CFBundleDevelopmentRegion', '<string>en</string>'],
    ['CFBundleDisplayName', `<string>${xmlEscape('Ogden Agents')}</string>`],
    ['CFBundleExecutable', `<string>${xmlEscape(MACOS_EXECUTABLE)}</string>`],
    ['CFBundleIdentifier', `<string>${xmlEscape(MACOS_BUNDLE_ID)}</string>`],
    ['CFBundleInfoDictionaryVersion', '<string>6.0</string>'],
    ['CFBundleName', `<string>${xmlEscape('Ogden Agents')}</string>`],
    ['CFBundlePackageType', '<string>APPL</string>'],
    ['CFBundleShortVersionString', '<string>1.0</string>'],
    ['CFBundleVersion', '<string>1</string>'],
    ['LSUIElement', '<true/>'],
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    ...entries.map(([key, value]) => `\t<key>${key}</key>\n\t${value}`),
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** The bundle's executable: runs the launcher, its output appended to `<logDir>/launcher.log`. */
export function launcherScript(target: ShortcutTarget): string {
  return [
    '#!/bin/sh',
    '# Opens Ogden Agents (written by Ogden Agents; it re-points this file at each start).',
    `mkdir -p ${shQuote(target.logDir)} 2>/dev/null`,
    `exec ${shQuote(target.nodePath)} ${shQuote(target.launcherEntry)} >>${shQuote(join(target.logDir, 'launcher.log'))} 2>&1`,
    '',
  ].join('\n');
}

/** Whether the bundle at `app` is the one Ogden Agents writes. */
function isOurs(app: string): boolean {
  try {
    const plist = readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8');
    const match = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/.exec(plist);
    return match?.[1] === MACOS_BUNDLE_ID;
  } catch {
    return false;
  }
}

function readOr(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** The one file operation the swap depends on, injectable so tests can make it fail. */
export interface MacosFs {
  rename(from: string, to: string): void;
}

export function createMacosWriter(applicationsDir: string, fs: MacosFs = { rename: renameSync }): ShortcutWriter {
  const app = join(applicationsDir, MACOS_APP_NAME);
  return {
    isInstalled: async () => existsSync(app) && isOurs(app),
    install: async (target) => {
      const plist = infoPlist();
      const script = launcherScript(target);
      if (existsSync(app)) {
        if (!isOurs(app)) throw new ShortcutRefusal(FOREIGN);
        // Already pointing here: nothing to write.
        if (readOr(join(app, 'Contents', 'Info.plist')) === plist && readOr(join(app, 'Contents', 'MacOS', MACOS_EXECUTABLE)) === script) return;
      }
      // Built beside the old one, then swapped in by renames: the old bundle is
      // moved aside, the new one moved in, and only then the old one deleted.
      // If the new one can't be moved in, the old one is moved back.
      mkdirSync(applicationsDir, { recursive: true });
      const stamp = `${process.pid}.${Date.now()}`;
      const staging = join(applicationsDir, `.${MACOS_APP_NAME}.${stamp}.tmp`);
      const aside = join(applicationsDir, `.${MACOS_APP_NAME}.${stamp}.old`);
      try {
        mkdirSync(join(staging, 'Contents', 'MacOS'), { recursive: true });
        writeFileSync(join(staging, 'Contents', 'Info.plist'), plist);
        const executable = join(staging, 'Contents', 'MacOS', MACOS_EXECUTABLE);
        writeFileSync(executable, script);
        chmodSync(executable, 0o755);
        const hadOld = existsSync(app);
        if (hadOld) fs.rename(app, aside);
        try {
          fs.rename(staging, app);
        } catch (error) {
          if (hadOld) fs.rename(aside, app);
          throw error;
        }
      } finally {
        rmSync(staging, { recursive: true, force: true });
        // Kept if the roll-back failed too, so the old bundle is never lost.
        if (existsSync(app)) rmSync(aside, { recursive: true, force: true });
      }
    },
    remove: async () => {
      if (!existsSync(app)) return;
      if (!isOurs(app)) throw new ShortcutRefusal('The Ogden Agents app in your Applications folder was not made by Ogden Agents, so it was left alone.');
      rmSync(app, { recursive: true, force: true });
    },
  };
}
