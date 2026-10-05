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
 * Claude Code's managed (policy-tier) settings for an unattended build
 * session (story 5.2, user decision 2026-10-04; review loop 1): only these
 * permission rules, hooks and MCP servers count, so no user, project or
 * local setting can widen what core's policy allows. Bash runs in Claude
 * Code's own sandbox, without asking, and never outside it
 * (`allowUnsandboxedCommands: false`; `failIfUnavailable`, so a sandbox that
 * can't start stops the session rather than running unsandboxed); only the
 * run's writable roots are writable and its denied paths never; Ogden Agents'
 * data folder (but the worktree) and the user's credential folders can't be
 * read; no network (an empty domain allowlist, managed only, strict). Web
 * tools and every MCP tool are denied. Everything else the agent asks goes to
 * core's build permission policy.
 */
export function claudeSandboxSettings(sandbox: AgentSandbox): Record<string, unknown> {
  return {
    allowManagedPermissionRulesOnly: true,
    allowManagedHooksOnly: true,
    allowManagedMcpServersOnly: true,
    permissions: { deny: ['WebFetch', 'WebSearch', 'mcp__*'] },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [], allowManagedDomainsOnly: true, strictAllowlist: true },
      filesystem: {
        allowWrite: [...sandbox.writableRoots],
        denyWrite: [...sandbox.deniedPaths],
        denyRead: [...sandbox.deniedReads],
        allowRead: [...sandbox.allowedReads],
      },
    },
  };
}

/**
 * What a session starts with in `_meta.claudeCode.options` (claude-agent-acp
 * 0.84 passes `settings`, `managedSettings`, `settingSources` and
 * `strictMcpConfig` through): the Auto guards as flag settings; for a build
 * session the managed lockdown, project settings only (its CLAUDE.md and
 * skills load; user and local settings don't) and no MCP config but Ogden's
 * (none). `undefined` for a session with neither.
 */
export function claudeSessionOptions(protectedPaths: ProtectedPaths | undefined, sandbox: AgentSandbox | undefined): Record<string, unknown> | undefined {
  if (protectedPaths === undefined && sandbox === undefined) return undefined;
  return {
    ...(protectedPaths === undefined ? {} : { settings: claudeGuardSettings(protectedPaths) }),
    ...(sandbox === undefined ? {} : { managedSettings: claudeSandboxSettings(sandbox), settingSources: ['project'], strictMcpConfig: true }),
  };
}
