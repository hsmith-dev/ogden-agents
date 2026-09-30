/**
 * `shortcut-memory` (story 2.3): an in-memory `AppShortcutPort`, the default
 * until the OS shortcut adapters ship (story 2.4), and for tests. It creates
 * nothing on the computer; `add` and `remove` only flip a flag.
 */
import type { AppShortcutPort } from '@ogden-agents/core';

export interface MemoryAppShortcutOptions {
  /** Reported as the platform. Default `memory`. */
  platform?: string;
  /** Whether `add` succeeds. Default `true`. */
  supported?: boolean;
  installed?: boolean;
}

export function createMemoryAppShortcut(options: MemoryAppShortcutOptions = {}): AppShortcutPort {
  const platform = options.platform ?? 'memory';
  const supported = options.supported ?? true;
  let installed = options.installed ?? false;
  return {
    status: async () => ({ platform, supported, installed }),
    add: async () => {
      if (!supported) throw new Error("An app shortcut can't be added on this computer.");
      installed = true;
    },
    remove: async () => {
      installed = false;
    },
  };
}
