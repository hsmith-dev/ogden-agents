import { z } from 'zod';

/**
 * The toolchain contract (story 1.8): the `uv` that BMad Method's scripts and
 * bmad-loop run through. The server finds a usable `uv` on this computer, or
 * installs a private copy into its data folder when the user clicks Install
 * (AD-21: no standard flow requires a terminal).
 */

/** The only tool this contract covers so far. */
export const TOOL_NAMES = ['uv'] as const;
export const ToolName = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof ToolName>;

/** Where a ready `uv` came from: found on this computer, or installed by Ogden Agents. */
export const TOOL_SOURCES = ['system', 'private'] as const;
export const ToolSource = z.enum(TOOL_SOURCES);
export type ToolSource = z.infer<typeof ToolSource>;

/** A usable `uv`, at least the pinned minimum version. */
export const ToolReady = z.object({
  state: z.literal('ready'),
  version: z.string().min(1),
  source: ToolSource,
});

/** No usable `uv`. `reason` says why in plain words when there is more to say (e.g. too old). */
export const ToolMissing = z.object({
  state: z.literal('missing'),
  reason: z.string().min(1).optional(),
});

/** A private copy is being downloaded; `total` is `null` when the server did not say. */
export const ToolInstalling = z.object({
  state: z.literal('installing'),
  bytes: z.number().int().nonnegative(),
  total: z.number().int().positive().nullable(),
});

/**
 * No usable `uv`, and the last install failed or can't run here. `canInstall`
 * is false when trying again can't help (an unsupported OS or CPU).
 */
export const ToolFailed = z.object({
  state: z.literal('failed'),
  reason: z.string().min(1),
  canInstall: z.boolean(),
});

export const ToolchainStatus = z.discriminatedUnion('state', [ToolReady, ToolMissing, ToolInstalling, ToolFailed]);
export type ToolchainStatus = z.infer<typeof ToolchainStatus>;

/** `GET /api/toolchain`. */
export const ToolchainResponse = z.object({ uv: ToolchainStatus });
export type ToolchainResponse = z.infer<typeof ToolchainResponse>;

/** `POST /api/toolchain/uv/install` answers 202 with whether it started a download, and the status now. */
export const ToolchainInstallResponse = z.object({ started: z.boolean(), uv: ToolchainStatus });
export type ToolchainInstallResponse = z.infer<typeof ToolchainInstallResponse>;

/** Why an install failed (API error codes, `packages/shared`). */
export const TOOLCHAIN_ERROR_CODES = [
  'unsupported_platform',
  'download_failed',
  'hash_mismatch',
  'extract_failed',
  'install_failed',
] as const;
export const ToolchainErrorCode = z.enum(TOOLCHAIN_ERROR_CODES);
export type ToolchainErrorCode = z.infer<typeof ToolchainErrorCode>;

/** The HTTP paths, shared by the server routes and the UI. */
export const TOOLCHAIN_PATH = '/api/toolchain';
export const UV_INSTALL_PATH = '/api/toolchain/uv/install';
