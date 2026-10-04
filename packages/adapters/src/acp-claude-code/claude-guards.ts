/**
 * Keeping the protected paths guarded in Auto (permission modes, user
 * decision 2026-10-02: "Keep protected files guarded"): core names the
 * folders and files; Claude Code gets them as ask rules in its flag settings
 * (`_meta.claudeCode.options.settings` for the chat, `--settings` for the
 * terminal), so writing one asks, and reaches Ogden as a card, even in auto.
 */
import type { AgentSandbox, ProtectedPaths } from '@ogden-agents/core';

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

/**
 * Claude Code settings (its flag-settings tier, fixed for the session) for an
 * unattended build session (story 5.2, user decision 2026-10-04): Bash runs
 * in Claude Code's own sandbox, without asking, and never outside it
 * (`allowUnsandboxedCommands: false`; `failIfUnavailable`, so a sandbox that
 * can't start stops the session rather than running unsandboxed); only the
 * run's writable roots are writable, its denied paths never; no network
 * (an empty domain allowlist, enforced strictly). Web tools are denied and
 * no Claude Code hook runs. Everything else the agent asks goes to core's
 * build permission policy.
 */
export function claudeSandboxSettings(sandbox: AgentSandbox): Record<string, unknown> {
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [], strictAllowlist: true },
      filesystem: { allowWrite: [...sandbox.writableRoots], denyWrite: [...sandbox.deniedPaths] },
    },
    permissions: { deny: ['WebFetch', 'WebSearch'] },
    disableAllHooks: true,
  };
}

/** The flag settings a session starts with: the Auto guards, the build sandbox, both, or none (`undefined`). */
export function claudeSessionSettings(protectedPaths: ProtectedPaths | undefined, sandbox: AgentSandbox | undefined): Record<string, unknown> | undefined {
  if (protectedPaths === undefined && sandbox === undefined) return undefined;
  const guards = protectedPaths === undefined ? undefined : claudeGuardSettings(protectedPaths);
  const contained = sandbox === undefined ? undefined : claudeSandboxSettings(sandbox);
  if (guards === undefined) return contained;
  if (contained === undefined) return guards;
  const permissions = { ...(contained.permissions as Record<string, unknown>), ...guards.permissions };
  return { ...contained, permissions };
}
