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
