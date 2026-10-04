/**
 * The port for the Ogden Agents app shortcut (E2-R10; story 2.3 contract,
 * filled by 2.4): an entry in the OS app menu that runs the launcher, which
 * starts or attaches to the server and opens a fresh launch link. Making one
 * is OS-specific, so it sits behind a core port (AD-1) and core names no OS.
 */
export interface AppShortcutState {
  /** The server's OS as Node names it (`process.platform`), for the UI's wording. */
  platform: string;
  /** Whether a shortcut can be added on this computer. */
  supported: boolean;
  /** Whether it is there now. */
  installed: boolean;
  /** Whether the user answered the first-run offer (Add or Not now); kept across restarts. */
  offerDismissed: boolean;
}

export interface AppShortcutPort {
  status(): Promise<AppShortcutState>;
  /** Adds the shortcut (replacing an old one). Rejects with plain words when it can't. */
  add(): Promise<void>;
  /** Removes it; removing a missing one is not an error. */
  remove(): Promise<void>;
  /** Records that the first-run offer was answered, so it is never shown again. */
  dismissOffer(): Promise<void>;
}
