/**
 * The pinned upstream BMad Method (story 4.14, AD-13): the port that gets
 * it, and the install-level use-case over it.
 *
 * Each Ogden Agents release pins upstream BMad Method to one commit and a
 * content hash. The adapter (`bmad-source`) downloads the
 * pinned tarball only when the user asks, verifies it in memory, and writes
 * only the verified files into a fresh folder in the data folder; BMad
 * Method's scripts that Ogden Agents runs itself run only from there. Core
 * names no repo, URL or file here.
 *
 * Nothing downloads on startup, a page load or any read: {@link BmadSourcePort.status}
 * reads the data folder only. The callers of {@link BmadSourcePort.download}
 * are the user's own actions: Download BMad Method (`POST /api/v1/bmad/source`),
 * and later Set up and Update (entry 4.3) and the Build action (epic 5).
 */
import type { BmadSourceStatus } from '@ogden-agents/shared';
import { BmadNotDownloadedError } from './errors.js';

export interface BmadSourcePort {
  /** Whether the exact pinned commit is downloaded and verified (or downloading). Reads the data folder only; never the network. */
  status(): BmadSourceStatus;
  /**
   * Downloads, verifies and extracts the pinned BMad Method unless it is
   * already ready; concurrent calls share one download. Resolves with the
   * `ready` status, or rejects with core's `BmadDownloadError` (`offline` or
   * `integrity`), having saved nothing.
   */
  download(): Promise<BmadSourceStatus>;
  /**
   * The absolute path of `relPath` (`/`-separated, relative to the pinned
   * tree's used folder: for BMad Method its `skills/`) inside the verified
   * copy, or `undefined` when it isn't ready or has no such file.
   */
  file(relPath: string): string | undefined;
}

/** The install-level use-case: what the routes and the guarded use-cases call. */
export interface BmadSourceUseCases {
  /** As {@link BmadSourcePort.status}. */
  status(): BmadSourceStatus;
  /** As {@link BmadSourcePort.download}. */
  download(): Promise<BmadSourceStatus>;
  /** Returns when the pinned BMad Method is ready; {@link BmadNotDownloadedError} otherwise. Read at each call; never downloads. */
  requireReady(): void;
}

export function createBmadSource(port: BmadSourcePort): BmadSourceUseCases {
  return {
    status: () => port.status(),
    download: () => port.download(),
    requireReady() {
      if (port.status().state !== 'ready') throw new BmadNotDownloadedError();
    },
  };
}
