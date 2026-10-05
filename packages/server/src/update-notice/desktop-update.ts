/**
 * The desktop app's update service (story 13.3, E13-R6; AD-20): the shell
 * reports an update it downloaded and verified, the web UI shows it and asks to
 * restart, and the shell polls for the go-ahead. The server never downloads or
 * installs anything and the web UI never reaches Tauri: this is the one place
 * the two meet, behind AD-15's gate (the launcher token for the shell, the tab
 * token and Origin for the page).
 *
 * Restart never goes ahead while the busy rule says anything is working. The
 * poll answers `restart: true` only when the user asked and nothing is busy,
 * and only once per request.
 *
 * Kept: the update channel (`<dataDir>/desktop-update.json`). Everything else is
 * in memory, because an update is found again on the next start (no periodic
 * checks, user 2026-10-04).
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SETTINGS_STREAM, UpdateChannel, type DesktopUpdateReport, type DesktopUpdateView, type RestartForUpdateResponse } from '@ogden-agents/shared';
import type { Core } from '@ogden-agents/core';
import { z } from 'zod';
import type { Logger } from '../log.js';
import type { BusyRule } from './busy-rule.js';

export const DESKTOP_UPDATE_FILE = 'desktop-update.json';

const Stored = z.object({ channel: UpdateChannel.optional() });

export interface DesktopUpdateOptions {
  dataDir: string;
  /** The version the server runs; an update must be newer than it. */
  version: string;
  /** Whether `a` is newer than `b` (the one semver order). */
  isNewer(a: string, b: string): boolean;
  /** The channel when none is stored: the running version's own (a prerelease follows `next`). */
  defaultChannel: UpdateChannel;
  busy: BusyRule;
  events: Core['events'];
  log: Logger;
}

export interface DesktopUpdate {
  /** The update to show, or `null`. */
  view(): DesktopUpdateView | null;
  /** The shell reports an update. Refused (`false`) when it is not newer than the running version. */
  report(report: DesktopUpdateReport): boolean;
  /** The user's Restart. */
  requestRestart(whenIdle: boolean): RestartForUpdateResponse | 'no_update' | 'not_downloaded';
  /** The shell's poll: true once, when asked and idle. */
  pollRestart(): boolean;
  channel(): UpdateChannel;
  setChannel(channel: UpdateChannel): UpdateChannel;
}

export function createDesktopUpdate(options: DesktopUpdateOptions): DesktopUpdate {
  const { dataDir, version, busy, events, log } = options;
  const file = join(dataDir, DESKTOP_UPDATE_FILE);
  let update: DesktopUpdateReport | null = null;
  let requested: { whenIdle: boolean } | null = null;
  let handedOff = false;

  const stored = (): z.infer<typeof Stored> => {
    try {
      const parsed = Stored.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  };
  const channel = (): UpdateChannel => stored().channel ?? options.defaultChannel;
  const append = (event: Parameters<Core['events']['append']>[0]): void => {
    try {
      events.append(event);
    } catch {
      // The core may be closing; the page reads the notice again on its next load.
    }
  };

  return {
    view() {
      if (update === null) return null;
      const now = busy();
      return { update, blocked: now.busy, busy: now.total, restartRequested: requested !== null };
    },
    report(report) {
      // Never offer the running version or an older one (downgrades are refused).
      if (!options.isNewer(report.version, version)) {
        log.warn('an app update that is not newer was ignored', { offered: report.version });
        return false;
      }
      if (update !== null && update.version !== report.version) {
        requested = null;
        handedOff = false;
      }
      update = report;
      append({ type: 'app.update_available', workspaceId: null, streamId: SETTINGS_STREAM, payload: { version: report.version, channel: report.channel, downloaded: report.downloaded } });
      return true;
    },
    requestRestart(whenIdle) {
      if (update === null) return 'no_update';
      if (!update.downloaded) return 'not_downloaded';
      const now = busy();
      if (now.busy && !whenIdle) return { requested: false, blocked: true, busy: now.total };
      if (requested === null) {
        requested = { whenIdle };
        handedOff = false;
        append({ type: 'app.update_requested', workspaceId: null, streamId: SETTINGS_STREAM, payload: { version: update.version, whenIdle } });
      }
      return { requested: true, blocked: now.busy, busy: now.total };
    },
    pollRestart() {
      if (update === null || requested === null || handedOff) return false;
      if (busy().busy) return false;
      handedOff = true;
      return true;
    },
    channel,
    setChannel(next) {
      if (stored().channel !== next) {
        const temp = `${file}.${process.pid}.tmp`;
        try {
          writeFileSync(temp, `${JSON.stringify({ channel: next })}\n`, { mode: 0o600 });
          renameSync(temp, file);
        } catch (error) {
          rmSync(temp, { force: true });
          log.warn('update channel not saved', { code: (error as NodeJS.ErrnoException).code ?? 'unexpected' });
        }
      }
      return channel();
    },
  };
}
