import { TerminalHandoffError, TerminalImportError } from '@ogden-agents/core';
import { describe, expect, it } from 'vitest';
import { logInternalError } from '../src/internal-error-log.js';

function logger() {
  const lines: Array<[string, string, Record<string, unknown> | undefined]> = [];
  return {
    lines,
    log: {
      info: (m: string, f?: Record<string, unknown>) => void lines.push(['info', m, f]),
      warn: (m: string, f?: Record<string, unknown>) => void lines.push(['warn', m, f]),
      error: (m: string, f?: Record<string, unknown>) => void lines.push(['error', m, f]),
    },
  };
}

describe('internal errors of a session in the log', () => {
  it('a handoff or import bound has its own message and code, anything else stays the failure it was', () => {
    const { lines, log } = logger();
    logInternalError(log, 'ses_1', new TerminalHandoffError('terminal_release_late', 12_000));
    logInternalError(log, 'ses_1', new TerminalHandoffError('terminal_open_timeout'));
    logInternalError(log, 'ses_1', new TerminalImportError('terminal_import_unreadable'));
    logInternalError(log, 'ses_1', new Error('boom'));
    expect(lines).toEqual([
      ['warn', 'terminal handoff went on past a bound', { sessionId: 'ses_1', code: 'terminal_release_late', elapsedMs: 12_000 }],
      ['warn', 'terminal handoff went on past a bound', { sessionId: 'ses_1', code: 'terminal_open_timeout' }],
      ['warn', 'terminal turns were not imported', { sessionId: 'ses_1', code: 'terminal_import_unreadable' }],
      ['error', 'applying an agent event failed', { sessionId: 'ses_1', reason: 'Error: boom' }],
    ]);
  });
});
