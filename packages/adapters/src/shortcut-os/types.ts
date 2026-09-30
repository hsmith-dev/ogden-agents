/** What every app shortcut runs (story 2.4): this install's Node and launcher, never a URL (AD-15). */
export interface ShortcutTarget {
  /** Absolute path of the Node that runs the launcher (`process.execPath`). */
  nodePath: string;
  /** Absolute path of `bin/ogden.js`. */
  launcherEntry: string;
  /** Where the launcher's output goes, where the OS keeps it at all (macOS). */
  logDir: string;
}

/** One OS's shortcut file: whether it is there, writing it (in place) and removing it. */
export interface ShortcutWriter {
  /** Whether our shortcut is there (a file of the same name someone else made is not). */
  isInstalled(): Promise<boolean>;
  install(target: ShortcutTarget): Promise<void>;
  remove(): Promise<void>;
}
