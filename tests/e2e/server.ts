/**
 * Starts the built server (`dist/server.js`, as `pnpm build` writes it) in
 * this process, on a temp data folder, for the browser tests.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type ServerModule = typeof import('@ogden-agents/server');
/** A started server with its launch link (the tests start it with `launch: true`). */
export type RunningServer = Awaited<ReturnType<ServerModule['start']>> & { launchUrl: string };

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const WEB_ROOT = join(ROOT, 'dist', 'web');

async function load(): Promise<ServerModule> {
  return (await import(pathToFileURL(join(ROOT, 'dist', 'server.js')).href)) as ServerModule;
}

/** A fresh temp data folder; the caller removes it with `removeDataDir`. */
export function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-'));
}

export function removeDataDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export type StartOptions = Parameters<ServerModule['start']>[0];

/** Starts the server on `port` (0: any free port) with `dataDir`, logging nowhere. `extra` adds options (a stub toolchain, say). */
export async function startServer(dataDir: string, port = 0, extra: StartOptions = {}): Promise<RunningServer> {
  const { start, createLogger } = await load();
  return start({ port, open: false, dataDir, webRoot: WEB_ROOT, log: createLogger(() => {}), ...extra, launch: true });
}

/** The built server module, for its exports (such as `ToolchainError`). */
export const serverModule = load;
