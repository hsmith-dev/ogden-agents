/**
 * Keeping the protected paths guarded in Auto (permission modes, user
 * decision 2026-10-02: "Keep protected files guarded"): core names the
 * folders and files; Claude Code gets them as ask rules in its flag settings
 * (`_meta.claudeCode.options.settings` for the chat, `--settings` for the
 * terminal), so writing one asks, and reaches Ogden as a card, even in auto.
 */
import type { ProtectedPaths } from '@ogden-agents/core';

/**
 * Claude Code permission rules that make it ask before writing the protected
 * paths whatever its mode, `bypassPermissions` included (ask rules are
 * bypass-immune, which is why a Skip-all session is started without them).
 * An `Edit` rule covers Write, MultiEdit and NotebookEdit.
 */
export function claudeAskRules(paths: ProtectedPaths): string[] {
  return [...paths.folders.map((folder) => `Edit(**/${folder}/**)`), ...paths.files.map((file) => `Edit(**/${file})`)];
}

/** Claude Code settings (its flag-settings tier) keeping the protected paths guarded. */
export function claudeGuardSettings(paths: ProtectedPaths): { permissions: { ask: string[] } } {
  return { permissions: { ask: claudeAskRules(paths) } };
}
