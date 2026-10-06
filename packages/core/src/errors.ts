import {
  BMAD_DOWNLOAD_INTEGRITY_MESSAGE,
  BMAD_DOWNLOAD_OFFLINE_MESSAGE,
  BMAD_NOT_DOWNLOADED_MESSAGE,
  BMAD_ALREADY_SET_UP_MESSAGE,
  BMAD_NOT_SET_UP_MESSAGE,
  BMAD_UPGRADE_REFUSED_TEXT,
  REDUCED_MODE_MESSAGE,
  BMAD_SETUP_FAILURE_REASONS,
  FEATURE_OFF_MESSAGE,
  FEATURE_UNAVAILABLE_MESSAGE,
  SCRIPTS_CHANGED_MESSAGE,
  SCRIPTS_NOT_TRUSTED_MESSAGE,
  STATUS_NOT_ALLOWED_MESSAGE,
  TICKET_CHANGED_MESSAGE,
  REOPEN_NOT_CONFIRMED_MESSAGE,
  type BmadCapability,
  type BmadSetupFailureReason,
  type SessionTerminal,
  type TerminalUnavailableCode,
} from '@ogden-agents/shared';

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

/**
 * A BMad Method piece the workspace has turned off was asked for (AD-22):
 * core's guard refused it and did nothing. `piece` is the piece's id.
 */
export class FeatureOffError extends CoreError {
  override readonly name = 'FeatureOffError';
  constructor(readonly piece: string) {
    super('feature_off', FEATURE_OFF_MESSAGE);
  }
}

/**
 * Turning on a BMad Method piece this install doesn't ship yet was refused
 * (AD-22: a piece is turned on only when available; story 10.2). Nothing was
 * stored. `piece` is the first such piece.
 */
export class FeatureUnavailableError extends CoreError {
  override readonly name = 'FeatureUnavailableError';
  constructor(readonly piece: string) {
    super('feature_unavailable', FEATURE_UNAVAILABLE_MESSAGE);
  }
}

/**
 * A use-case that runs the project's own BMad Method scripts was asked for
 * before the user trusted the project (story 4.2, AD-22 note 2026-10-02):
 * core refused it and ran nothing.
 */
export class ScriptsNotTrustedError extends CoreError {
  override readonly name = 'ScriptsNotTrustedError';
  constructor() {
    super('scripts_not_trusted', SCRIPTS_NOT_TRUSTED_MESSAGE);
  }
}

/**
 * A use-case that runs the project's own BMad Method scripts found them
 * changed since the user trusted the project (story 4.13, user decision
 * 2026-10-04: the trust is bound to their contents): core ran nothing.
 */
export class ScriptsChangedError extends CoreError {
  override readonly name = 'ScriptsChangedError';
  constructor() {
    super('scripts_changed', SCRIPTS_CHANGED_MESSAGE);
  }
}

/**
 * A use-case that runs BMad Method's scripts was asked for before the pinned
 * upstream BMad Method was downloaded and verified (story 4.14, AD-13): core
 * refused it and ran nothing. The UI offers Download BMad Method.
 */
export class BmadNotDownloadedError extends CoreError {
  override readonly name = 'BmadNotDownloadedError';
  constructor() {
    super('bmad_not_downloaded', BMAD_NOT_DOWNLOADED_MESSAGE);
  }
}

/**
 * BMad Method's setup was asked for in a project that already has `_bmad/`
 * (story 4.3; a link or a file there counts too). Nothing was written:
 * updating a set-up project is Upgrade's (entry 4.11).
 */
export class BmadAlreadySetUpError extends CoreError {
  override readonly name = 'BmadAlreadySetUpError';
  constructor() {
    super('bmad_already_set_up', BMAD_ALREADY_SET_UP_MESSAGE);
  }
}

/**
 * A piece that needs BMad Method installed was used in a project without
 * `_bmad/` (story 4.2's `bmad_not_set_up`; entry 4.11: Upgrade this project
 * asked for in a project that was never set up). Nothing ran.
 */
export class BmadNotSetUpError extends CoreError {
  override readonly name = 'BmadNotSetUpError';
  constructor() {
    super('bmad_not_set_up', BMAD_NOT_SET_UP_MESSAGE);
  }
}

/**
 * Upgrade this project was refused before anything was written (entry 4.11):
 * the project's `_bmad` is a link or a file, not a folder.
 */
export class BmadUpgradeRefusedError extends CoreError {
  override readonly name = 'BmadUpgradeRefusedError';
  constructor() {
    super('bmad_upgrade_refused', BMAD_UPGRADE_REFUSED_TEXT);
  }
}

/**
 * The project's BMad Method lacks a capability the use-case needs (AD-14,
 * entry 4.11): core refused before anything ran (for the board, before
 * `tickets.py`). `capability` is the first missing one. The UI shows the
 * reduced-mode notice with Upgrade this project.
 */
export class ReducedModeError extends CoreError {
  override readonly name = 'ReducedModeError';
  constructor(readonly capability: BmadCapability) {
    super('reduced_mode', REDUCED_MODE_MESSAGE);
  }
}

/**
 * Why downloading the pinned BMad Method failed: it didn't arrive
 * (`offline`: no network, an HTTP error, a timeout, too large) or what
 * arrived isn't the pinned content (`integrity`: a hash mismatch, an unsafe
 * or unreadable archive).
 */
export type BmadDownloadFailure = 'offline' | 'integrity';

/**
 * Downloading the pinned BMad Method failed (story 4.14); nothing was saved.
 * `message` is plain words for the user; `detail` is for the log only (a
 * status code, the hashes), never shown.
 */
export class BmadDownloadError extends CoreError {
  override readonly name = 'BmadDownloadError';
  readonly reason: BmadDownloadFailure;
  readonly detail: string | undefined;
  constructor(reason: BmadDownloadFailure, detail?: string) {
    super('bmad_download_failed', reason === 'offline' ? BMAD_DOWNLOAD_OFFLINE_MESSAGE : BMAD_DOWNLOAD_INTEGRITY_MESSAGE);
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * BMad Method's setup failed (story 4.3): no usable uv (`uv_missing`), the
 * project's folder can't be written (`not_writable`), it took too long
 * (`timeout`), or anything else (`failed`). `message` is the plain reason
 * `bmad.setup_failed` carries; nothing holds a path or the script's output.
 */
export class BmadSetupError extends CoreError {
  override readonly name = 'BmadSetupError';
  constructor(
    readonly reason: BmadSetupFailureReason,
    options: { cause?: unknown } = {},
  ) {
    super('bmad_setup_failed', BMAD_SETUP_FAILURE_REASONS[reason]);
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** A ticket status the board may not set (`done`, AD-10) was asked for (story 4.2); nothing ran. */
export class StatusNotAllowedError extends CoreError {
  override readonly name = 'StatusNotAllowedError';
  constructor(readonly status: string) {
    super('status_not_allowed', STATUS_NOT_ALLOWED_MESSAGE);
  }
}

/**
 * The ticket's status is no longer the one the request expected (story 4.10):
 * someone else (an agent, a `git pull`) changed it since the board showed it.
 * Nothing was written.
 */
export class TicketChangedError extends CoreError {
  override readonly name = 'TicketChangedError';
  constructor(
    readonly ref: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super('ticket_changed', TICKET_CHANGED_MESSAGE);
  }
}

/**
 * A change to a ticket the board showed as Done that didn't confirm the
 * reopen (story 4.10, user decision 2026-10-02): `expectedStatus` was `done`
 * without `reopen: true`. Nothing ran.
 */
export class ReopenNotConfirmedError extends CoreError {
  override readonly name = 'ReopenNotConfirmedError';
  constructor(readonly ref: string) {
    super('reopen_not_confirmed', REOPEN_NOT_CONFIRMED_MESSAGE);
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

/** The plain reason a message can't go right away while a permission card waits (send now or wait). */
export const ANSWER_FIRST_REASON = 'Answer the request above first, then send your message.';

/**
 * A message was to be sent right away while the agent waits for an answer on
 * a permission card (send now or wait): nothing was sent or recorded.
 */
export class AnswerFirstError extends CoreError {
  override readonly name = 'AnswerFirstError';
  constructor() {
    super('answer_first', ANSWER_FIRST_REASON);
  }
}

/** The plain reason a waiting message can't be changed (send now or wait). */
export const MESSAGE_NOT_QUEUED_REASON = 'That message is no longer waiting. It was sent, removed, or the agent stopped.';

/** A waiting message was to be changed or sent right away, but it is no longer waiting (send now or wait): nothing changed. */
export class MessageNotQueuedError extends CoreError {
  override readonly name = 'MessageNotQueuedError';
  constructor() {
    super('message_not_queued', MESSAGE_NOT_QUEUED_REASON);
  }
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

/** Skip all was asked for while Developer mode is off (permission modes): nothing changed. */
export class DeveloperModeRequiredError extends CoreError {
  override readonly name = 'DeveloperModeRequiredError';
  constructor(message = 'Skip all is only offered in Developer mode. Turn it on in Settings → Appearance first.') {
    super('developer_mode_required', message);
  }
}

/** Skip all was asked for without the user's confirmation of its warning: nothing changed. */
export class ConfirmationRequiredError extends CoreError {
  override readonly name = 'ConfirmationRequiredError';
  constructor(message = 'Confirm the warning to turn on Skip all.') {
    super('confirmation_required', message);
  }
}

/** A handoff whose brief, agent and chat no unused, unexpired preview token covers (handoff): nothing changed. */
export class HandoffNotPreviewedError extends CoreError {
  override readonly name = 'HandoffNotPreviewedError';
  constructor(message = 'This summary wasn’t previewed for that agent, or its preview expired. Review it again, then continue.') {
    super('handoff_not_previewed', message);
  }
}

/** A permission mode the chat's agent, or its session, doesn't offer: nothing changed. */
export class ModeUnavailableError extends CoreError {
  override readonly name = 'ModeUnavailableError';
  constructor(message: string) {
    super('mode_unavailable', message);
  }
}

/** A chat was asked for a model its agent (or its session) doesn't list (story 11): nothing changed. */
export class ModelUnavailableError extends CoreError {
  override readonly name = 'ModelUnavailableError';
  constructor(message: string) {
    super('model_unavailable', message);
  }
}

/** A new chat named an agent that isn't registered (epic 6): nothing was created. */
export class UnknownAgentError extends CoreError {
  override readonly name = 'UnknownAgentError';
  constructor(message = "Ogden Agents doesn't have that agent on this computer. Pick another one.") {
    super('agent_unknown', message);
  }
}

/** Why a new chat with a registered agent is refused (6.3): it isn't installed, isn't signed in, or needs a trusted project. */
export type AgentNotReadyCode = 'agent_not_installed' | 'agent_signed_out' | 'project_not_trusted';

/**
 * A new chat was refused because its agent can't start it now (epic 6, 6.3):
 * nothing was created. `message` is plain words naming the agent; `action`
 * is what fixes it. Never a path, a key or a URL.
 */
export class AgentNotReadyError extends CoreError {
  override readonly name = 'AgentNotReadyError';
  override readonly code: AgentNotReadyCode;
  constructor(
    code: AgentNotReadyCode,
    message: string,
    readonly agentId: string,
    readonly action: 'install' | 'sign_in' | 'trust_project',
  ) {
    super(code, message);
    this.code = code;
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

/** What it says for an agent that takes only an API key and can't be signed in with an account (Codex, Grok). */
export const secretsUnavailableKeyOnlyMessage = (agentName: string) =>
  `There's no keychain on this computer to keep an API key in, so ${agentName} can't be used here.`;

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
export type TerminalHandoffCode =
  | 'terminal_release_timeout'
  | 'terminal_release_late'
  | 'terminal_exit_timeout'
  | 'terminal_close_timeout'
  | 'terminal_open_timeout'
  | 'terminal_read_timeout';

/**
 * A handoff that hit a bound and went on (story 3.4): the agent did not stop
 * in time, a killed CLI did not report its exit, a close stopped waiting for
 * a switch, opening the terminal or reading the CLI's record took too long;
 * or an agent past its release bound has stopped at last
 * (`terminal_release_late`, story 3.9). For the log only; its message is its
 * code, then the elapsed milliseconds when given.
 */
export class TerminalHandoffError extends CoreError {
  override readonly name = 'TerminalHandoffError';
  override readonly code: TerminalHandoffCode;
  /** How long it took, in milliseconds, when that is the point (`terminal_release_late`). */
  readonly elapsedMs: number | undefined;
  constructor(code: TerminalHandoffCode, elapsedMs?: number) {
    super(code, elapsedMs === undefined ? code : `${code} (${elapsedMs} ms)`);
    this.code = code;
    this.elapsedMs = elapsedMs;
  }
}

/** Why a build use-case refused (story 5.2; frozen by 5.3): each answers 409 with its code, and nothing was written. */
export type BuildRefusalCode =
  | 'prerequisite_unmet'
  | 'not_ready'
  | 'run_active'
  | 'sandbox_unavailable'
  | 'checkout_dirty'
  | 'merge_conflict'
  | 'checks_failed'
  | 'plan_uncommitted'
  | 'vcs_unavailable'
  | 'disk_space_low'
  | 'run_not_active';

/**
 * A use-case whose lane has not shipped yet was asked for (story 5.3: such
 * as building every ready ticket before 5.8). The server answers 501
 * `not_implemented`; nothing was written.
 */
export class NotImplementedError extends CoreError {
  override readonly name = 'NotImplementedError';
  constructor(message: string) {
    super('not_implemented', message);
  }
}

/**
 * A build, approve or reject was refused (story 5.2): `code` says why for
 * the API, `message` in plain words for the user (a shared sentence; a
 * `sandbox_unavailable` may carry the sandbox's own plain reason).
 */
export class BuildRefusedError extends CoreError {
  override readonly name = 'BuildRefusedError';
  override readonly code: BuildRefusalCode;
  constructor(code: BuildRefusalCode, message: string) {
    super(code, message);
    this.code = code;
  }
}

/**
 * Save the lessons was refused (epic 7, story 7.2): `code` says why for the
 * API, `message` in plain words for the user (a shared sentence); nothing was
 * committed. Each answers 409.
 */
export class LessonsRefusedError extends CoreError {
  override readonly name = 'LessonsRefusedError';
  override readonly code: 'nothing_to_save' | 'checkout_busy' | 'agents_file_missing';
  constructor(code: 'nothing_to_save' | 'checkout_busy' | 'agents_file_missing', message: string) {
    super(code, message);
    this.code = code;
  }
}

/** What a read-only build session refuses (story 5.2): it runs on its own. */
export const BUILD_SESSION_READ_ONLY_MESSAGE = 'An unattended build runs on its own: its session is read-only.';

/**
 * A user message, permission mode, driver change or Stop was asked of an
 * unattended build's session (story 5.2 review loop 1): core refuses it,
 * changing nothing. Only the builds use-case sends its first prompt.
 */
export class BuildSessionReadOnlyError extends CoreError {
  override readonly name = 'BuildSessionReadOnlyError';
  constructor() {
    super('build_session_read_only', BUILD_SESSION_READ_ONLY_MESSAGE);
  }
}
