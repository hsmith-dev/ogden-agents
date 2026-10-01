import type { SessionTerminal, TerminalUnavailableCode } from '@ogden-agents/shared';

/** Base class for errors core throws on purpose, so callers can tell them from bugs. */
export class CoreError extends Error {
  override readonly name: string = 'CoreError';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ValidationIssue {
  path: readonly PropertyKey[];
  message: string;
}

/** Input failed its shared schema; nothing was written. */
export class ValidationError extends CoreError {
  override readonly name: string = 'ValidationError';
  constructor(
    message: string,
    readonly issues: readonly ValidationIssue[],
    code = 'invalid_input',
  ) {
    super(code, message);
  }
}

/** An event failed its shared schema; nothing was written and `seq` is unchanged. */
export class EventValidationError extends ValidationError {
  override readonly name = 'EventValidationError';
  constructor(message: string, issues: readonly ValidationIssue[]) {
    super(message, issues, 'invalid_event');
  }
}

/** A referenced workspace, session or run does not exist. */
export class NotFoundError extends CoreError {
  override readonly name = 'NotFoundError';
  constructor(what: string, id: string) {
    super('not_found', `${what} ${id} does not exist`);
  }
}

/** An operation is not allowed in the entity's current state. */
export class InvalidOperationError extends CoreError {
  override readonly name = 'InvalidOperationError';
  constructor(message: string) {
    super('invalid_operation', message);
  }
}

/**
 * A session event was refused: it was appended around the session-event
 * helper, or it names a workspace or stream other than its session's (E2-R7).
 * Nothing was written.
 */
export class SessionEventScopeError extends CoreError {
  override readonly name = 'SessionEventScopeError';
  constructor(message: string) {
    super('session_event_scope', message);
  }
}

/** The session's agent is still answering; the message was not sent. */
export class SessionBusyError extends CoreError {
  override readonly name: string = 'SessionBusyError';
  constructor(sessionId: string) {
    super('session_busy', `session ${sessionId} is still answering the last message`);
  }
}

/** The session already holds the most queued messages it may (`MAX_QUEUED_MESSAGES`); this one was not stored. */
export class QueueFullError extends SessionBusyError {
  override readonly name = 'QueueFullError';
}

/** Stop was asked of a session whose agent is not answering (nothing to stop). */
export class SessionNotBusyError extends CoreError {
  override readonly name = 'SessionNotBusyError';
  constructor(sessionId: string) {
    super('session_not_busy', `session ${sessionId} has no turn running`);
  }
}

/**
 * A switch between the chat and the agent's terminal was refused (story 3.1;
 * story 3.2 gives each refusal its own class): {@link SessionNotIdleError} or
 * {@link TerminalUnavailableError}. `message` is plain words for the user;
 * nothing changed.
 */
export abstract class DriverSwitchRefusedError extends CoreError {
  override readonly name: string = 'DriverSwitchRefusedError';
}

/** The switch was refused because the session is working, waiting on a permission, has queued messages, or is switching (E3-R5). */
export class SessionNotIdleError extends DriverSwitchRefusedError {
  override readonly name = 'SessionNotIdleError';
  constructor(message: string) {
    super('session_not_idle', message);
  }
}

/**
 * The switch to the terminal was refused because the terminal can't work for
 * this session here (E3-R7): `terminalCode` says why, `message` in plain
 * words (never a path, a command line or a secret).
 */
export class TerminalUnavailableError extends DriverSwitchRefusedError {
  override readonly name = 'TerminalUnavailableError';
  constructor(
    readonly terminalCode: TerminalUnavailableCode,
    message: string,
  ) {
    super('terminal_unavailable', message);
  }

  /** The `SessionTerminal` this refusal reports. */
  get terminal(): SessionTerminal {
    return { available: false, code: this.terminalCode, reason: this.message };
  }
}

/** A chat message was refused because the agent's own terminal drives the session (AD-6). */
export class DriverIsTerminalError extends CoreError {
  override readonly name = 'DriverIsTerminalError';
  constructor(message = 'The terminal is driving this chat. Switch back to the chat to send a message.') {
    super('driver_is_terminal', message);
  }
}

/** A session of the workspace is `working` or `waiting`, so its history was not deleted. */
export class WorkspaceBusyError extends CoreError {
  override readonly name = 'WorkspaceBusyError';
  constructor(workspaceId: string) {
    super('sessions_busy', `workspace ${workspaceId} has a session that is working or waiting`);
  }
}

/** What {@link SecretsUnavailableError} says when nothing more specific applies (AD-16 as amended in story 9.2). */
export const SECRETS_UNAVAILABLE_MESSAGE = "There's no keychain on this computer to keep an API key in. Sign in with your account instead.";

/** What {@link SecretsUnavailableError} says when the keychain is there but didn't answer: a timeout, a locked keychain or a dismissed prompt. */
export const KEYCHAIN_NO_ANSWER_MESSAGE = "The keychain didn't answer. Check for a prompt from your computer and try again.";

/**
 * The OS keychain can't be used: there is none (Linux without Secret
 * Service), it is locked, the user dismissed its prompt, or its module didn't
 * load, with {@link SECRETS_UNAVAILABLE_MESSAGE}; or it didn't answer (a
 * timeout, locked, a dismissed prompt), with {@link KEYCHAIN_NO_ANSWER_MESSAGE}.
 * AD-16: there is no on-disk fallback. `message` is plain words for the user;
 * `cause` carries a code only, never a secret.
 */
export class SecretsUnavailableError extends CoreError {
  override readonly name = 'SecretsUnavailableError';
  constructor(message: string = SECRETS_UNAVAILABLE_MESSAGE, options: { cause?: string } = {}) {
    super('secrets_unavailable', message);
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** The agent's provider refused the API key (story 9.2); it was not stored. The message never echoes the key. */
export class ApiKeyRefusedError extends CoreError {
  override readonly name = 'ApiKeyRefusedError';
  constructor() {
    super('api_key_refused', 'That key was refused. Check it and paste it again.');
  }
}

/** Why bringing the terminal's turns into the chat (story 3.3) did less than it should: a code, logged on its own. */
export type TerminalImportCode = 'terminal_import_unreadable' | 'terminal_import_unaligned' | 'terminal_import_failed';

/**
 * A terminal import that read or appended nothing (story 3.3), for the log
 * only. Its message is its code plus, for an agent's failure, the agent's own
 * code: never a path, a reason text or anything read (AD-16).
 */
export class TerminalImportError extends CoreError {
  override readonly name = 'TerminalImportError';
  override readonly code: TerminalImportCode;
  constructor(code: TerminalImportCode, cause?: unknown) {
    const detail = (cause as { details?: { code?: unknown } } | undefined)?.details?.code;
    super(code, typeof detail === 'string' && /^[a-z_]{1,64}$/.test(detail) ? `${code} (${detail})` : code);
    this.code = code;
  }
}

/** Why a driver change (story 3.4) went past one of its limits: a code, logged on its own. */
export type TerminalHandoffCode = 'terminal_release_timeout' | 'terminal_exit_timeout' | 'terminal_close_timeout';

/**
 * A handoff that hit a bound and went on (story 3.4): the agent did not stop
 * in time, a killed CLI did not report its exit, or a close stopped waiting
 * for a switch. For the log only; its message is its code.
 */
export class TerminalHandoffError extends CoreError {
  override readonly name = 'TerminalHandoffError';
  override readonly code: TerminalHandoffCode;
  constructor(code: TerminalHandoffCode) {
    super(code, code);
    this.code = code;
  }
}
