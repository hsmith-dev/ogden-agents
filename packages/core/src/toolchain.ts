/**
 * The toolchain use-case (story 1.8): whether a usable `uv` exists, and a
 * user-initiated install of a private copy, with progress, completion and
 * failure appended to the event log (AD-5).
 *
 * Core only holds the port and the install's lifecycle. Finding `uv`,
 * choosing the release for this OS and CPU, downloading, verifying and
 * unpacking are the adapter's (AD-1): core names no OS, path or binary.
 */
import {
  TOOLCHAIN_STREAM,
  type ToolchainErrorCode,
  type ToolchainStatus,
} from '@ogden-agents/shared';
import { CoreError } from './errors.js';
import type { EventLog } from './event-log.js';

/** Download progress: bytes so far and the expected total, `null` if unknown. */
export interface ToolProgress {
  bytes: number;
  total: number | null;
}

/** What detection can say: everything but `installing`, which only core knows. */
export type DetectedToolStatus = Exclude<ToolchainStatus, { state: 'installing' }>;

/**
 * The port an adapter implements (`toolchain-uv`). Neither method touches the
 * database or the event log (AD-11); core does that.
 */
export interface ToolchainPort {
  /** The version a private install puts in place. */
  readonly uvVersion: string;
  /** Looks for a usable `uv`: on this computer first, then the private copy. Never downloads. */
  status(): Promise<DetectedToolStatus>;
  /**
   * Downloads, verifies and unpacks the private copy, calling `onProgress` as
   * bytes arrive. Resolves with the installed version, or throws a
   * {@link ToolchainError} having left nothing half-installed.
   */
  installUv(onProgress: (progress: ToolProgress) => void): Promise<{ version: string }>;
}

/**
 * An install failure with a plain-language message for the UI. `details`
 * (such as the target and both hashes of a mismatch) are for the log only.
 */
export class ToolchainError extends CoreError {
  override readonly name = 'ToolchainError';
  override readonly code: ToolchainErrorCode;
  readonly canInstall: boolean;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(
    code: ToolchainErrorCode,
    message: string,
    options: { canInstall?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(code, message);
    this.code = code;
    this.canInstall = options.canInstall ?? true;
    this.details = options.details ?? {};
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface Toolchain {
  /** The status the UI shows: `installing` while a download runs, else what the port finds, or the last failure. */
  status(): Promise<ToolchainStatus>;
  /**
   * Starts installing the private `uv` unless one is already usable or an
   * install is running. Returns at once; the install carries on and reports
   * through the event log.
   */
  installUv(): Promise<{ started: boolean; uv: ToolchainStatus }>;
  /** Resolves once no install is running (tests, shutdown). */
  settled(): Promise<void>;
}

export interface ToolchainOptions {
  /** Called with every install failure, for the log (it may hold details the event leaves out). */
  onFailure?: (error: ToolchainError) => void;
  /** Minimum time between two progress events. Default {@link PROGRESS_INTERVAL_MS}. */
  progressIntervalMs?: number;
  /** Clock for progress throttling (tests). Default `Date.now`. */
  now?: () => number;
}

/** Progress events are throttled so a download adds a few dozen events, not thousands. */
export const PROGRESS_INTERVAL_MS = 500;

const UNKNOWN_FAILURE = "uv couldn't be installed. Try again.";

export function createToolchain(events: EventLog, port: ToolchainPort, options: ToolchainOptions = {}): Toolchain {
  const interval = options.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let installing: { progress: ToolProgress; done: Promise<void> } | undefined;
  /** The last failure, shown until detection finds a usable `uv` or another install starts. */
  let lastFailure: Extract<ToolchainStatus, { state: 'failed' }> | undefined;

  const installingStatus = (): ToolchainStatus | undefined =>
    installing === undefined ? undefined : { state: 'installing', ...installing.progress };

  const status = async (): Promise<ToolchainStatus> => {
    const before = installingStatus();
    if (before !== undefined) return before;
    const detected = await port.status();
    // An install that started while detection ran is newer than what it found.
    const during = installingStatus();
    if (during !== undefined) return during;
    if (detected.state === 'ready' || lastFailure === undefined) return detected;
    return lastFailure;
  };

  const run = async (progress: ToolProgress): Promise<void> => {
    let lastEmitted = Number.NEGATIVE_INFINITY;
    /** Bytes in the last progress event; an unchanged count is never sent twice. */
    let emittedBytes = -1;
    const emit = () => {
      lastEmitted = now();
      emittedBytes = progress.bytes;
      events.append({
        type: 'toolchain.install_progress',
        workspaceId: null,
        streamId: TOOLCHAIN_STREAM,
        payload: { tool: 'uv', bytes: progress.bytes, total: progress.total },
      });
    };
    try {
      const { version } = await port.installUv((next) => {
        progress.bytes = next.bytes;
        progress.total = next.total !== null && next.total > 0 ? next.total : null;
        if (progress.bytes === emittedBytes) return;
        const finished = progress.total !== null && progress.bytes >= progress.total;
        if (finished || now() - lastEmitted >= interval) emit();
      });
      // The final count always goes out, even when the total was unknown or the last report was throttled.
      if (progress.bytes !== emittedBytes) emit();
      events.append({
        type: 'toolchain.install_completed',
        workspaceId: null,
        streamId: TOOLCHAIN_STREAM,
        payload: { tool: 'uv', version, source: 'private' },
      });
    } catch (caught) {
      const error =
        caught instanceof ToolchainError
          ? caught
          : new ToolchainError('install_failed', UNKNOWN_FAILURE, { details: { reason: String(caught) }, cause: caught });
      lastFailure = { state: 'failed', reason: error.message, canInstall: error.canInstall };
      try {
        options.onFailure?.(error);
      } catch {
        // Logging must never hide the failure from the UI.
      }
      events.append({
        type: 'toolchain.install_failed',
        workspaceId: null,
        streamId: TOOLCHAIN_STREAM,
        payload: { tool: 'uv', code: error.code, reason: error.message, canInstall: error.canInstall },
      });
    }
  };

  return {
    status,

    async installUv() {
      if (installing !== undefined) return { started: false, uv: await status() };
      // Claim the slot before awaiting, so two clicks start one download.
      let release!: () => void;
      const progress: ToolProgress = { bytes: 0, total: null };
      installing = { progress, done: new Promise<void>((resolve) => (release = resolve)) };
      let detected: DetectedToolStatus;
      try {
        detected = await port.status();
      } catch (error) {
        installing = undefined;
        release();
        throw error;
      }
      if (detected.state === 'ready') {
        installing = undefined;
        release();
        lastFailure = undefined;
        return { started: false, uv: detected };
      }
      lastFailure = undefined;
      events.append({
        type: 'toolchain.install_started',
        workspaceId: null,
        streamId: TOOLCHAIN_STREAM,
        payload: { tool: 'uv', version: port.uvVersion },
      });
      void run(progress)
        .catch(() => {
          // Only appending to a closed log can land here (the server is stopping); nothing is left to tell.
        })
        .finally(() => {
          installing = undefined;
          release();
        });
      return { started: true, uv: { state: 'installing', ...progress } };
    },

    async settled() {
      while (installing !== undefined) await installing.done;
    },
  };
}
