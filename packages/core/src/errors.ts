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
