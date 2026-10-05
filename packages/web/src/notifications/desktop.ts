import type { DesktopPermission } from './notifier';

/** The browser's notification permission, or `unsupported` when it has no Notifications API. */
export function desktopPermission(): DesktopPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

/**
 * Asks the browser for permission. Call it only from the user's own press
 * (Settings, Notifications): browsers ignore a request made without one.
 */
export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return desktopPermission();
  }
}
