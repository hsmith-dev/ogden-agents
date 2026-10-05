/**
 * File-system helpers the adapters share (entry 4.12): the open flags that
 * read a file without following a link or waiting on a FIFO, and a
 * file-system error's code.
 */
import { constants as fsConstants } from 'node:fs';

/** Never follow a link swapped in after a `realpath` or `lstat` (not on Windows, which has no such flag). */
export const NO_FOLLOW = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
/** Opening a FIFO never waits for a writer (not on Windows, which has no such flag). */
export const NON_BLOCK = (fsConstants as { O_NONBLOCK?: number }).O_NONBLOCK ?? 0;

/** A file-system error's `code` (`ENOENT`, say), or `'unknown'` when it has no string one. */
export const codeOf = (error: unknown): string => (typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : 'unknown');
