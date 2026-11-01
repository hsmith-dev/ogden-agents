/**
 * The one platform test behind every Cmd/Ctrl shortcut and its label (epic
 * 26 sweep): Apple devices (macOS, iPhone, iPad) use Cmd, everything else
 * Ctrl. `platform` defaults to this browser's user agent; tests pass one.
 */

const currentPlatform = (): string => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

/** Whether `platform` (a user agent) is an Apple device's. */
export const isApplePlatform = (platform: string = currentPlatform()): boolean => /Mac|iPhone|iPad/.test(platform);

/** A Cmd/Ctrl chord as this computer writes it: `⌘K` on Apple devices, `Ctrl+K` elsewhere (`separator` goes between, as in `⌘ Enter`). */
export const modifierShortcutLabel = (key: string, platform?: string, separator = ''): string =>
  isApplePlatform(platform) ? `⌘${separator}${key}` : `Ctrl+${key}`;
