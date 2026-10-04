/**
 * Minimal structured logger: one JSON object per line (Conventions), written
 * to stderr and, when the server runs, to a size-capped rotating file in the
 * data folder. There is no logging library. Secrets are never passed to the
 * logger on purpose (AD-16); as a backstop, {@link redact} scrubs every line:
 * credential headers (`Authorization`, `Sec-WebSocket-Protocol`, `Cookie`, the
 * launcher token header, API key fields) by name, and bearer or subprotocol
 * tokens, launch codes, token fragments and Anthropic API keys wherever they
 * appear in a value.
 */
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
// The subpath, not the index: the launcher bundle includes this file and must not load zod.
import { API_KEY_PATTERNS } from '@ogden-agents/shared/secret-patterns';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;
export type LogWriter = (line: string) => void;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/** What a redacted value is replaced with. */
export const REDACTED = '[redacted]';

/** Field names (any case) whose values are credentials and are never written. */
const SECRET_FIELDS = new Set([
  'authorization',
  'proxy-authorization',
  'sec-websocket-protocol',
  'cookie',
  'set-cookie',
  'x-ogden-launcher-token',
  // API keys (story 9.2): never logged on purpose; these catch a slip.
  'apikey',
  'api_key',
  'x-api-key',
  'anthropic_api_key',
  'gemini_api_key',
  'google_api_key',
]);

/** Field names whose value is a credential when it is a string (a boolean such as "was a token found" is not). */
const SECRET_STRING_FIELDS = new Set(['token']);

/** Values nested deeper than this are replaced, not walked: nothing unredacted gets through. */
const MAX_DEPTH = 8;
export const TOO_DEEP = '[too deep]';

/** Credentials that can appear inside any string: bearer tokens, the auth subprotocol, launch codes, token fragments, API keys. */
const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // Anthropic and Google keys, shared with the terminal import (story 3.3 review F4; epic 6 entry 5).
  ...API_KEY_PATTERNS.map((pattern): [RegExp, string] => [pattern, REDACTED]),
  [/(Bearer\s+)[^\s"',]+/gi, `$1${REDACTED}`],
  [/(ogden\.auth\.)[^\s"',]+/g, `$1${REDACTED}`],
  [/([?&]code=)[^\s"'&#]+/g, `$1${REDACTED}`],
  [/(#[ct]=)[^\s"'&]+/g, `$1${REDACTED}`],
];

/**
 * Returns `value` with every credential replaced by {@link REDACTED}: fields
 * named in SECRET_FIELDS (and string values of SECRET_STRING_FIELDS), the
 * SECRET_PATTERNS in strings, and anything nested too deep to check.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) return TOO_DEEP;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) return redact(value.stack ?? value.message, depth + 1);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const name = key.toLowerCase();
    const secret = SECRET_FIELDS.has(name) || (SECRET_STRING_FIELDS.has(name) && typeof item === 'string');
    out[key] = secret ? REDACTED : redact(item, depth + 1);
  }
  return out;
}

export function createLogger(write: LogWriter = (line) => process.stderr.write(line)): Logger {
  const log = (level: LogLevel, msg: string, fields?: LogFields) => {
    const safe = fields === undefined ? {} : (redact(fields) as LogFields);
    write(`${JSON.stringify({ level, at: new Date().toISOString(), msg: redact(msg), ...safe })}\n`);
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
