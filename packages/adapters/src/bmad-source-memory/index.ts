/**
 * `bmad-source-memory` (story 4.14): an in-memory `BmadSourcePort` for the
 * server and browser tests. It never touches the network or the disk: it
 * starts `ready` or `missing`, a download makes it `ready` (or rejects as
 * told) and is counted, and `file` answers a path only from the `files` it
 * was given (and only once ready).
 */
import { BmadDownloadError, type BmadDownloadFailure, type BmadSourcePort } from '@ogden-agents/core';
import type { BmadSourceStatus } from '@ogden-agents/shared';

/** A fixed pin the memory source reports. */
export const MEMORY_BMAD_SOURCE_VERSION = '6.13.0-memory';
export const MEMORY_BMAD_SOURCE_COMMIT = '0'.repeat(40);

export interface MemoryBmadSourceOptions {
  /** Whether it starts downloaded. Default `false`. */
  ready?: boolean;
  /** Each download rejects with this reason instead of succeeding. */
  failWith?: BmadDownloadFailure;
  /** How long a download takes, in milliseconds. Default 0. */
  delayMs?: number;
  /** `file` answers: relative path → absolute path. */
  files?: Readonly<Record<string, string>>;
}

export interface MemoryBmadSource extends BmadSourcePort {
  /** How many downloads ran (concurrent calls share one). */
  readonly downloads: number;
}

export function createMemoryBmadSource(options: MemoryBmadSourceOptions = {}): MemoryBmadSource {
  let ready = options.ready ?? false;
  let downloads = 0;
  let inFlight: Promise<BmadSourceStatus> | undefined;
  const status = (): BmadSourceStatus => ({
    state: inFlight !== undefined ? 'downloading' : ready ? 'ready' : 'missing',
    version: MEMORY_BMAD_SOURCE_VERSION,
    commit: MEMORY_BMAD_SOURCE_COMMIT,
  });
  return {
    get downloads() {
      return downloads;
    },
    status,
    download() {
      if (inFlight !== undefined) return inFlight;
      if (ready) return Promise.resolve(status());
      downloads++;
      const pending = new Promise<BmadSourceStatus>((resolve, reject) => {
        setTimeout(() => {
          inFlight = undefined;
          if (options.failWith !== undefined) {
            reject(new BmadDownloadError(options.failWith));
            return;
          }
          ready = true;
          resolve(status());
        }, options.delayMs ?? 0);
      });
      inFlight = pending;
      return pending;
    },
    file(relPath) {
      return ready ? options.files?.[relPath] : undefined;
    },
  };
}
