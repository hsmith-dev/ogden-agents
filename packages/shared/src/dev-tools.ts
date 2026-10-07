/**
 * Generic developer CLI tools (CAP-25, story: generic developer CLI tools
 * detect, install, and sandbox-gate): the wire contract for the install-wide
 * catalog (a seed list Ogden ships plus any tool the user names) and a
 * project's per-tool unattended-build allowance. Ogden names no tool here;
 * `DevToolStatus.label`/`id` for a seed entry come from the adapter's
 * catalog (AD-1).
 */
import { z } from 'zod';

/** A tool's stable id, kebab-case (`gcloud`, `terraform`). Not an Ogden Agents key (AD-9). */
export const DevToolId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected a kebab-case tool id');
export type DevToolId = z.infer<typeof DevToolId>;

/** Where a catalog entry came from: Ogden's own small seed list, or one the user named. */
export const DevToolSource = z.enum(['seed', 'custom']);
export type DevToolSource = z.infer<typeof DevToolSource>;

/** One tool's state, resolved for this computer and this moment. */
export const DevToolStatus = z.object({
  id: DevToolId,
  label: z.string().min(1).max(80),
  source: DevToolSource,
  /** Found on PATH, or at one of its known default install locations for this OS. Never run to check. */
  installed: z.boolean(),
  /** The exact command Ogden would run to install it, or `null` when there is none for this OS (Install is not offered). */
  installCommand: z.string().min(1).max(2000).nullable(),
});
export type DevToolStatus = z.infer<typeof DevToolStatus>;

/** `GET /api/v1/dev-tools`. */
export const DevToolsResponse = z.object({ tools: z.array(DevToolStatus) });
export type DevToolsResponse = z.infer<typeof DevToolsResponse>;

/**
 * `POST /api/v1/dev-tools/:toolId/install`: the user's confirmation only — never
 * the command itself. Ogden always runs its own stored command for `toolId`,
 * so nothing a client sends can change what actually runs.
 */
export const InstallDevToolRequest = z.object({ confirm: z.literal(true) });
export type InstallDevToolRequest = z.infer<typeof InstallDevToolRequest>;

/** `POST /api/v1/dev-tools`: the user names a tool Ogden doesn't ship (the generic, extensible path). */
export const AddDevToolRequest = z.object({
  id: DevToolId,
  label: z.string().min(1).max(80),
  /** A bare program name (PATH lookup) or an absolute path, for this OS only. */
  executable: z.string().min(1).max(260),
  /** The exact command the user wants Ogden to run to install it, shown back to them before it ever runs. */
  installCommand: z.string().min(1).max(2000),
});
export type AddDevToolRequest = z.infer<typeof AddDevToolRequest>;

/** One tool's unattended-build allowance in a project (deny-by-default: absent/`false` is the default). */
export const DevToolUnattendedAllowance = z.object({
  id: DevToolId,
  label: z.string().min(1).max(80),
  installed: z.boolean(),
  allowed: z.boolean(),
});
export type DevToolUnattendedAllowance = z.infer<typeof DevToolUnattendedAllowance>;

/** `GET /api/v1/workspaces/:wsId/dev-tools-allowlist`. */
export const DevToolsAllowlistResponse = z.object({ tools: z.array(DevToolUnattendedAllowance) });
export type DevToolsAllowlistResponse = z.infer<typeof DevToolsAllowlistResponse>;

/** `PUT /api/v1/workspaces/:wsId/dev-tools-allowlist/:toolId`: grant or revoke, explicit either way. */
export const SetDevToolAllowedRequest = z.object({ allowed: z.boolean() });
export type SetDevToolAllowedRequest = z.infer<typeof SetDevToolAllowedRequest>;
