import {
  TOOLCHAIN_PATH,
  ToolchainInstallResponse,
  ToolchainResponse,
  UV_INSTALL_PATH,
  type ToolchainStatus,
} from '@ogden-agents/shared';

/** Reads the `error.message` of a failed reply, or falls back to `fallback`. */
async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // Not JSON: keep the plain message.
  }
  return fallback;
}

const UNREACHABLE = "Couldn't reach Ogden Agents. Check that it is still running, then try again.";

/** `GET /api/toolchain`: whether a usable uv exists (story 1.8). */
export async function fetchUvStatus(fetchImpl: typeof fetch = fetch): Promise<ToolchainStatus> {
  let response: Response;
  try {
    response = await fetchImpl(TOOLCHAIN_PATH, { credentials: 'same-origin' });
  } catch {
    throw new Error(UNREACHABLE);
  }
  if (!response.ok) throw new Error(await errorMessage(response, `Ogden Agents couldn't check for uv (error ${response.status}).`));
  return ToolchainResponse.parse(await response.json()).uv;
}

/**
 * `POST /api/toolchain/uv/install`: asks the server to install its private uv.
 * A same-origin POST, so the browser sends the `Origin` the gate checks.
 * Progress and the outcome arrive through the event log.
 */
export async function installUv(fetchImpl: typeof fetch = fetch): Promise<ToolchainStatus> {
  let response: Response;
  try {
    response = await fetchImpl(UV_INSTALL_PATH, { method: 'POST', credentials: 'same-origin' });
  } catch {
    throw new Error(UNREACHABLE);
  }
  if (response.status !== 202) throw new Error(await errorMessage(response, `uv couldn't be installed (error ${response.status}). Try again.`));
  return ToolchainInstallResponse.parse(await response.json()).uv;
}

/** `17001427` bytes as `17.0 MB`. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The download line under the progress bar. */
export function progressText(bytes: number, total: number | null): string {
  if (total === null) return `Downloaded ${formatMegabytes(bytes)}`;
  const mb = (n: number) => (n / 1_000_000).toFixed(1);
  return `Downloaded ${mb(bytes)} of ${formatMegabytes(total)}`;
}
