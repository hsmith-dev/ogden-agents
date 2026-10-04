/**
 * The server's BMad Method wiring (moved from `start.ts` in entry 4.12,
 * which re-exports its public names): the one pinned BMad Method source and
 * the catalog over it (with setup's script runner, set once the server
 * builds it), document cards, and Plan and Board (planning sessions, the
 * script runner, the ticket store, the board and the ticket watch).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBmadCatalog, createTicketsV7, createUpstreamBmadSource, createUvScriptRunner, createUvToolchain, errorCode, ScriptRunError, type UvScriptRunner } from '@ogden-agents/adapters';
import {
  CoreError,
  createBmadSource,
  createBoard,
  createPlanning,
  createPlanningDocuments,
  createTicketWatcher,
  type AgentPort,
  type BmadCatalogPort,
  type BmadSourcePort,
  type Core,
} from '@ogden-agents/core';
import type { Logger } from './log.js';
import type { StartOptions } from './start-types.js';
import type { TestBmadSource } from './test-hooks.js';

/** The verified pinned BMad Method's `tickets.py`, relative to its `skills/` (story 4.14, AD-13). */
export const TICKETS_SCRIPT = 'bmad-ticket/scripts/tickets.py';

/** How long a stopping server waits for a BMad Method setup to finish before it kills the run. */
export const SETUP_STOP_MS = 30_000;

/**
 * The working folder of every BMad Method script run (story 4.2 review): an
 * empty folder of Ogden Agents' own, never a project's, so `uv run` finds no
 * project `.venv` to run. Created readable only by the user if missing.
 */
export function uvWorkDir(dataDir: string): string {
  const dir = join(dataDir, 'tools', 'uv-work');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** What {@link createBmadSourceAndCatalog} builds. */
export interface BmadWiring {
  /** Where setup finds the script runner, once the server builds it (story 4.3). */
  readonly setupRunner: { current?: UvScriptRunner };
  /** The server's one pinned BMad Method source (story 4.14); setup uses the same one (story 4.3). */
  readonly bmadSourcePort: BmadSourcePort;
  /** The catalog the Plan page reads (story 4.1). */
  readonly bmadCatalog: BmadCatalogPort;
}

/**
 * The pinned BMad Method source, the catalog over it, and where setup finds
 * the script runner once it is built. `testSource` is the
 * `OGDEN_AGENTS_TEST_BMAD_SOURCE` hook's fixture (story 4.13; only when
 * `testHooksAllowed`): its lock and a local tarball read from disk instead of
 * GitHub's, still checked against the lock's hash.
 */
export function createBmadSourceAndCatalog(options: StartOptions, dataDir: string, log: Logger, testSource?: TestBmadSource): BmadWiring {
  // The script runner is built with the server (below); setup reaches it through this holder (story 4.3).
  const setupRunner: { current?: UvScriptRunner } = {};
  // The pinned upstream BMad Method (story 4.14, AD-13): the server's one source, downloaded only when the user
  // asks (Download, or Set up: story 4.3), never here.
  const bmadSourcePort: BmadSourcePort =
    options.bmadSource ??
    createUpstreamBmadSource({
      dataDir,
      ...(options.bmadFetch === undefined ? {} : { fetch: options.bmadFetch }),
      ...(testSource === undefined ? {} : { lock: testSource.lock, fetch: async () => new Response(readFileSync(testSource.tarball)) }),
      onCleanupError: (error) => log.warn('could not remove BMad Method download temp files', { code: (error as NodeJS.ErrnoException).code ?? 'unknown' }),
    });
  // The read-only detection of a repo's `_bmad/` (story 10.3), its installed skills (story 4.1) and BMad Method's
  // setup (story 4.3: the verified `setup.py` of that one source, run in Ogden Agents' own work folder); the
  // catalog labels only skills that are that source's verified copy's (entry 4.12). A test may pass its own.
  const bmadCatalog: BmadCatalogPort =
    options.bmadCatalog ??
    createBmadCatalog({
      runner: { run: (input) => (setupRunner.current === undefined ? Promise.reject(new ScriptRunError('closed')) : setupRunner.current.run(input)) },
      workDir: uvWorkDir(dataDir),
      source: bmadSourcePort,
    });
  return { setupRunner, bmadSourcePort, bmadCatalog };
}

/**
 * Document cards (story 4.7): a planning session's completed write into the
 * output folder appends `session.document_written` with the next suggested
 * step. Codes only in the log: never a path.
 */
export function createDocumentCards({ core, catalog, agent, log }: { core: Core; catalog: BmadCatalogPort; agent: AgentPort; log: Logger }) {
  return createPlanningDocuments({
    bmad: core.bmad,
    entities: core.entities,
    catalog,
    agent,
    sessionEvents: core.sessionEvents,
    onError: (sessionId, step, error) =>
      log.info('no document card for a planning write', { sessionId, step, ...(error === undefined ? {} : { code: errorCode(error, 'unexpected') }) }),
  });
}

/** Plan and Board (story 4.1): the catalog, planning sessions and the tickets, each behind core's guard (AD-22). */
export function createPlanAndBoard({
  options,
  core,
  dataDir,
  log,
  bmadCatalog,
  bmadSourcePort,
  setupRunner,
  chat,
  agent,
  uvToolchain,
  uvChildEnv,
}: {
  options: StartOptions;
  core: Core;
  dataDir: string;
  log: Logger;
  bmadCatalog: BmadCatalogPort;
  bmadSourcePort: BmadSourcePort;
  setupRunner: { current?: UvScriptRunner };
  chat: Parameters<typeof createPlanning>[0]['chat'];
  agent: AgentPort;
  uvToolchain: Pick<ReturnType<typeof createUvToolchain>, 'locate'>;
  uvChildEnv: () => Record<string, string>;
}) {
  const planning = createPlanning({ bmad: core.bmad, entities: core.entities, catalog: bmadCatalog, chat, agent, modulesSeen: core.bmadModulesSeen });
  // The one runner of BMad Method's scripts (story 4.1); closed with the server, which kills any tree still running (story 4.2).
  const scriptRunner = createUvScriptRunner({
    uvCommand: async () => {
      const file = await uvToolchain.locate();
      return file === undefined ? undefined : { file };
    },
    env: uvChildEnv,
  });
  const bmadSource = createBmadSource(bmadSourcePort);
  setupRunner.current = scriptRunner;
  const ticketStore =
    options.ticketStore ??
    createTicketsV7({
      runner: scriptRunner,
      // Only the verified copy, read at each run; never the project's own `tickets.py`.
      script: () => bmadSourcePort.file(TICKETS_SCRIPT),
      // Never the repo: uv would run a `.venv` the project ships (story 4.2 review).
      workDir: uvWorkDir(dataDir),
      // Codes only: the script's own error text can name the user's paths.
      onFailure: (error) => log.warn('tickets.py run failed', { code: error instanceof ScriptRunError ? error.code : error.reason }),
      onWatchFallback: (reason) => log.info('ticket watch polls instead of watching', { code: reason }),
    });
  // Every board use-case checks the piece, then the project's script trust (story 4.2), then the pinned BMad
  // Method (story 4.14), before the store runs anything.
  const board = createBoard({ bmad: core.bmad, trust: core.bmadScriptTrust, source: bmadSource, entities: core.entities, catalog: bmadCatalog, tickets: ticketStore });
  // One watch per project with Board on, trusted and BMad Method set up (story 4.8; the setup status is entry 4.3's):
  // an agent's ticket write reaches the board as `ticket.changed`.
  const ticketWatcher = createTicketWatcher({
    events: core.events,
    entities: core.entities,
    bmad: core.bmad,
    trust: core.bmadScriptTrust,
    catalog: bmadCatalog,
    tickets: ticketStore,
    // Codes only: never a path or the script's output.
    onError: (workspaceId, step, error) => log.warn('ticket watch failed', { workspaceId, step, code: errorCode(error, 'unexpected') }),
  });
  return { planning, scriptRunner, bmadSource, board, ticketWatcher };
}

/** How core's failed BMad Method setup is logged: codes only, since a setup's own error can name the user's paths. */
export function bmadSetupFailureLogger(log: Logger) {
  return (workspaceId: string, error: unknown) =>
    log.warn('BMad Method setup failed', {
      workspaceId,
      code: error instanceof CoreError ? error.code : 'unknown',
      ...(error instanceof CoreError && 'reason' in error ? { reason: String(error.reason) } : {}),
      ...(typeof (error as { cause?: unknown })?.cause === 'string' ? { cause: (error as { cause: string }).cause } : {}),
    });
}

/** Resolves after {@link SETUP_STOP_MS}, never holding the process open. */
const stopBound = () => new Promise((resolve) => setTimeout(resolve, SETUP_STOP_MS).unref());

/**
 * The server's BMad Method work ends on stop, in order, each step run even
 * when the one before failed: a document detection under way (story 4.7,
 * files only) ends before core closes, bounded; a setup in progress
 * finishes, so no staging folder is left in a project (story 4.3), bounded;
 * then no BMad Method script outlives the server (story 4.2). The ticket
 * watches stop first (story 4.8): closing the runner kills a run a watch is
 * waiting on, so their close never waits on a script.
 */
export async function stopBmadWork({
  planningDocuments,
  bmadSetup,
  ticketWatcher,
  scriptRunner,
  log,
}: {
  planningDocuments: { settled(): Promise<unknown> };
  bmadSetup: { settled(): Promise<unknown> } | undefined;
  ticketWatcher: { close(): Promise<unknown> };
  scriptRunner: { close(): Promise<unknown> };
  log: Logger;
}): Promise<void> {
  try {
    await Promise.race([planningDocuments.settled(), stopBound()]);
  } finally {
    try {
      await Promise.race([bmadSetup?.settled().catch(() => undefined), stopBound()]);
    } finally {
      const watching = ticketWatcher.close().catch((error: unknown) => log.warn('stopping ticket watches failed', { reason: String(error) }));
      await scriptRunner.close().catch((error: unknown) => log.warn('stopping scripts failed', { reason: String(error) }));
      await watching;
    }
  }
}
