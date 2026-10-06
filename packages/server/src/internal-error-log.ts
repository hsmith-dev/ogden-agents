/**
 * How the server logs what core calls an internal error of a session (`onInternalError`): a handoff or
 * import bound that was hit is a note with its own message and its code, never "applying an agent event
 * failed"; anything else is the failure it always was (3.9 sweep).
 */
import { TerminalHandoffError, TerminalImportError } from '@ogden-agents/core';
import type { Logger } from './log.js';

export function logInternalError(log: Logger, sessionId: string, error: unknown): void {
  if (error instanceof TerminalHandoffError) {
    log.warn('terminal handoff went on past a bound', { sessionId, code: error.code, ...(error.elapsedMs === undefined ? {} : { elapsedMs: error.elapsedMs }) });
  } else if (error instanceof TerminalImportError) {
    log.warn('terminal turns were not imported', { sessionId, code: error.code });
  } else {
    log.error('applying an agent event failed', { sessionId, reason: String(error) });
  }
}
