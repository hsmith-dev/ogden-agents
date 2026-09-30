/**
 * Minimal structured logger: one JSON object per line (Conventions), written
 * to stderr and, when the server runs, to a size-capped rotating file in the
 * data folder. There is no logging library. Secrets are never passed to the
 * logger (AD-16); redaction arrives with the first secret-handling adapter.
 */
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;
export type LogWriter = (line: string) => void;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export function createLogger(write: LogWriter = (line) => process.stderr.write(line)): Logger {
  const log = (level: LogLevel, msg: string, fields?: LogFields) => {
    write(`${JSON.stringify({ level, at: new Date().toISOString(), msg, ...fields })}\n`);
  };
  return {
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
  };
}

/** Sends every line to each writer; a failing writer never stops the others. */
export function teeWriters(...writers: LogWriter[]): LogWriter {
  return (line) => {
    for (const write of writers) {
      try {
        write(line);
      } catch {
        // Logging must never take the server down.
      }
    }
  };
}

export interface RotatingFileOptions {
  /** Directory for the log files; created, readable only by the user, if missing. */
  dir: string;
  /** Base file name. Default `server.log`. */
  name?: string;
  /** Rotate before a write would take the current file past this size. Default 5 MiB. */
  maxBytes?: number;
  /** Rotated files kept beside the current one (`server.log.1` … `.N`). Default 3. */
  maxFiles?: number;
}

export const LOG_DIR = 'logs';
export const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_LOG_MAX_FILES = 3;

/**
 * A writer that appends lines to `<dir>/<name>`. When a line would take the
 * file past `maxBytes`, the file becomes `<name>.1` (older ones shift up, and
 * the one beyond `maxFiles` is deleted) and a new file is started.
 */
export function createRotatingFileWriter({
  dir,
  name = 'server.log',
  maxBytes = DEFAULT_LOG_MAX_BYTES,
  maxFiles = DEFAULT_LOG_MAX_FILES,
}: RotatingFileOptions): LogWriter {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, name);
  let size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;

  const rotate = () => {
    rmSync(`${file}.${maxFiles}`, { force: true });
    for (let n = maxFiles - 1; n >= 1; n--) {
      if (statSync(`${file}.${n}`, { throwIfNoEntry: false }) !== undefined) {
        renameSync(`${file}.${n}`, `${file}.${n + 1}`);
      }
    }
    if (maxFiles >= 1) renameSync(file, `${file}.1`);
    else rmSync(file, { force: true });
    size = 0;
  };

  return (line) => {
    const bytes = Buffer.byteLength(line);
    if (size > 0 && size + bytes > maxBytes) rotate();
    appendFileSync(file, line, { mode: 0o600 });
    size += bytes;
  };
}
