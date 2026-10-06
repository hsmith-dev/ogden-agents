import { z } from 'zod';

/**
 * The API's error codes (Conventions: `snake_case`, kept here). Every 4xx and
 * 5xx the server answers on an API route has the body {@link ApiErrorBody}.
 */
export const API_ERROR_CODES = [
  /** No valid tab token (or launch code, or launcher token) (401). */
  'unauthorized',
  /** A wrong Host, or a missing or foreign Origin (403, AD-15). */
  'forbidden',
  /** A request body that fails its shared schema, or a workspace path that is not a folder (400). */
  'invalid_request',
  /** No such route (404), such as an old path outside `/api/v1`, or no such workspace or session. */
  'not_found',
  /** The session's agent is still answering the last message (409). */
  'session_busy',
  /** Stop was asked of a session whose agent is not answering (409). */
  'session_not_busy',
  /** Quit was refused while agents are working; `details.busySessions` says how many (409). */
  'sessions_busy',
  /** A switch to the terminal was refused: the session is working, waiting on a permission, has queued messages or is switching (409, story 3.2). */
  'session_not_idle',
  /**
   * A switch to the terminal was refused: it can't work for this session here
   * (409, story 3.2). `details.terminal` is the `SessionTerminal` that says why.
   */
  'terminal_unavailable',
  /** A chat message was refused: the session's terminal drives it (409, story 3.2, AD-6). */
  'driver_is_terminal',
  /** Skip all, or a terminal pane (epic 16), was asked for while Developer mode is off (403): nothing changed. */
  'developer_mode_required',
  /** Skip all was asked for without the user's confirmation of its warning (400): nothing changed. */
  'confirmation_required',
  /** A permission mode the chat's agent, or its session, doesn't offer (409): nothing changed. */
  'mode_unavailable',
  /** A model the chat's agent, or its session, doesn't list (409; story 11): nothing changed. */
  'model_unavailable',
  /**
   * A handoff with no matching preview (409; handoff): its preview token is
   * missing, used, expired, or was issued for another brief, agent or chat.
   * Nothing changed; preview again.
   */
  'handoff_not_previewed',
  /** A new chat named an agent this install doesn't have (400; epic 6): nothing created. */
  'agent_unknown',
  /**
   * A new chat named an agent that isn't installed (409; epic 6, 6.3): nothing
   * created. `details.agentId`, and `details.action` (`install`) says what fixes it.
   */
  'agent_not_installed',
  /** A new chat named an agent that isn't signed in (409; 6.3): nothing created. `details.action` is `sign_in`. */
  'agent_signed_out',
  /**
   * A new chat named an agent that runs the project's own agent settings or
   * hooks, in a project not trusted yet (409; 6.3): nothing created.
   * `details.action` is `trust_project`.
   */
  'project_not_trusted',
  /** A terminal pane would pass the limit of panes in a project or in this install (409; epic 16). `details` says which limit and how many. */
  'pane_limit_reached',
  /** uv's status or install could not be read or started (500). */
  'toolchain_unavailable',
  /** A route or socket request whose lane has not shipped yet (501; the story 2.3 stubs). */
  'not_implemented',
  /** A permission decision for a request that is no longer waiting: already decided, cancelled, or unknown (409). */
  'permission_not_pending',
  /** The app shortcut can't be added on this computer (422). */
  'shortcut_unsupported',
  /** A sign-in code was sent, but no sign-in is in progress for that agent (409). */
  'sign_in_not_pending',
  /** An API key was saved, but there is no usable OS keychain to keep it in (503; AD-16: no on-disk fallback). */
  'secrets_unavailable',
  /** The agent's provider refused an API key; it was not stored (400). */
  'api_key_refused',
  /** An agent's install, sign-in or API key could not be done (500). The message says why in plain words. */
  'agent_setup_failed',
  /** An agent can't be uninstalled or signed out right now (installing, a file in use, a sign-out it refused; 409). The message says why. */
  'agent_busy',
  /** A BMad Method piece this project has turned off was asked for (409; AD-22: core's guard refused it). */
  'feature_off',
  /**
   * Turning on a BMad Method piece this install doesn't ship yet was refused
   * (409; AD-22: a piece is turned on only when available). Nothing was stored.
   */
  'feature_unavailable',
  /**
   * A project's tickets couldn't be read (503; story 4.1): no active
   * initiative, no usable uv, a malformed ticket tree, a timeout or output
   * that isn't the script's JSON. The message says what to do in plain words.
   */
  'tickets_unavailable',
  /**
   * A route or use-case that runs the project's own BMad Method scripts was
   * asked for before the user trusted the project (409; story 4.2, AD-22
   * note). Nothing ran. The UI shows the trust prompt.
   */
  'scripts_not_trusted',
  /** A ticket status the board may not set (`done`: only approve writes it, AD-10) was asked for (409; story 4.2). */
  'status_not_allowed',
  /** A piece that needs BMad Method installed in the project was used before setup (409; story 4.2). */
  'bmad_not_set_up',
  /**
   * BMad Method's setup was asked for in a project that already has `_bmad/`
   * (409; story 4.3). Nothing was written: updating a project is Upgrade's.
   */
  'bmad_already_set_up',
  /** The project's BMad Method lacks the capability this needs (409, AD-14; story 4.2). The UI shows the reduced-mode notice. */
  'reduced_mode',
  /**
   * A surface that runs BMad Method's scripts was used before the pinned
   * BMad Method was downloaded (409; story 4.14, AD-13). Nothing ran. The UI
   * offers Download BMad Method.
   */
  'bmad_not_downloaded',
  /**
   * Downloading the pinned BMad Method failed (story 4.14): 503 when it
   * didn't arrive (offline, an HTTP error, a timeout, too large), 502 when
   * what arrived isn't the pinned content. Nothing was saved.
   */
  'bmad_download_failed',
  /**
   * A ticket's status changed since the board showed it (409; story 4.10):
   * the request's `expectedStatus` no longer matches the plan. Nothing was written.
   */
  'ticket_changed',
  /**
   * A change to a Done ticket that didn't say it reopens it (409; story 4.10,
   * user decision 2026-10-02): `expectedStatus` was `done` without `reopen: true`.
   * Nothing was written.
   */
  'reopen_not_confirmed',
  /**
   * Upgrade this project was refused before anything was written (409; entry
   * 4.11): the project's `_bmad` is a link or a file, not a folder.
   */
  'bmad_upgrade_refused',
  /**
   * The project's own BMad Method scripts (`_bmad/scripts/`) changed since the
   * user trusted the project (409; story 4.13, user decision 2026-10-04: the
   * trust is bound to their contents). Nothing ran. The UI asks again.
   */
  'scripts_changed',
  /**
   * A message was to be sent right away while the agent waits for an answer
   * on a permission card (409; send now or wait): nothing was sent. Waiting is still possible.
   */
  'answer_first',
  /** A waiting message was to be changed or sent right away, but it is no longer waiting (sent, removed, or the turn ended; 409). */
  'message_not_queued',
  // Unattended builds (story 5.2's tracer; frozen by 5.3). Each is a 409 and nothing was written.
  /** A ticket another one waits for is not done or in review yet. */
  'prerequisite_unmet',
  /** The ticket is not ready to build (its plan is not `ready-for-dev`). */
  'not_ready',
  /** The ticket already has a run in progress. */
  'run_active',
  /** No sandbox can contain an unattended build on this computer (fail closed). */
  'sandbox_unavailable',
  /** Approve was refused: the project's checkout has uncommitted changes outside the BMad output folder. */
  'checkout_dirty',
  /** Approve's merge conflicted: it was aborted and the checkout is unchanged. */
  'merge_conflict',
  /** Approve was refused: the run did not pass its checks (not `verified`), or was already merged. */
  'checks_failed',
  /** Build was refused: the ticket's plan or `tickets.toml` has uncommitted changes in the checkout. */
  'plan_uncommitted',
  /** Build was refused: the project is not a git repository with a checked-out branch that has a commit. */
  'vcs_unavailable',
  /** Build was refused: the data folder's disk has too little free space for a worktree (409; story 5.5). */
  'disk_space_low',
  /** Stop, Retry or Check again was asked of a run in the wrong state: Stop of a finished run, Retry of one not blocked or failed (409; story 5.3). */
  'run_not_active',
  // Retrospectives (epic 7, story 7.2). Each is a 409 and nothing was written.
  /** Save the lessons: neither AGENTS.md nor the retrospective file has a change to commit. */
  'nothing_to_save',
  /** Save the lessons: a merge, rebase, cherry-pick or revert is in progress in the checkout. */
  'checkout_busy',
  /** Save the lessons: the project has no AGENTS.md that git tracks. */
  'agents_file_missing',
  /** A Local model endpoint on a host that is not this computer was used before the user confirmed it, or its address changed since (409; epic 14 story 14.3). Nothing was called. */
  'endpoint_confirmation_required',
  /** Anything else that went wrong on the server (500). */
  'internal_error',
] as const;
export const ApiErrorCode = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** `{ "error": { "code", "message", "details"? } }`: every API error body. `message` is plain words for the user. */
export const ApiErrorBody = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
