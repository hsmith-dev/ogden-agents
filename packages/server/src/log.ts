/**
 * Minimal structured logger: one JSON object per line on stderr.
 * The data-directory log file and redaction (Conventions, AD-16) come later.
 */
export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export function createLogger(write: (line: string) => void = (line) => process.stderr.write(line)): Logger {
  const log = (level: LogLevel, msg: string, fields?: LogFields) => {
    write(`${JSON.stringify({ level, at: new Date().toISOString(), msg, ...fields })}\n`);
  };
  return {
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
  };
}
