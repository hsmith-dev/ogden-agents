#!/usr/bin/env node
// A fake coding agent that speaks real ACP over stdio (story 2.2), for CI and
// the tests: it is what `acp-claude-code` spawns in place of the Claude Agent
// ACP adapter, so the whole path (REST, core, AgentPort, the adapter, ACP)
// runs without a real agent or account.
//
//   node fake-acp-agent.mjs
//
// It answers `initialize`, `session/new`, `session/resume`, `session/load`,
// `session/prompt` (streaming its reply as `agent_message_chunk` updates,
// then `end_turn`), `session/cancel` and `session/close`. The prompt text
// picks the behavior:
//
//   anything else  "Hello from the fake agent." in three chunks
//   "permission"   an `execute` tool call (`npm test`), then asks permission
//                  to run it; replies "Ran npm test." if allowed, else
//                  "Denied npm test."
//   "permission-hold"  as "permission", but once allowed the tool call stays
//                  `in_progress` until the turn is cancelled (a long command)
//   "permission <command>"  the same for <command> ("Ran <command>." or
//                  "Denied <command>.")
//   "permission-edit <path>[|<path>…]"  an `edit` tool call naming those
//                  paths (as its locations), then asks permission; replies
//                  "Edited <paths>." if allowed, else "Denied <paths>."
//   "tool"         an `edit` tool call, then an update completing it with a
//                  diff of src/example.ts; replies "Edited."
//   "context"      replies `session=<its id> via=<new|resumed|loaded> primed=<n>`,
//                  n being the earlier messages ("User: " or "Claude Code: "
//                  lines) of a transcript core primed the prompt with
//   "/<command>"   replies `command=/<command> primed=<n>` (a slash command)
//   "auth-expired" the prompt fails with ACP's auth-required error (-32000)
//   "crash"        one chunk, then the process exits with code 1 mid-prompt
//   "slow"         one chunk, then waits until cancelled (`cancelled`) or 10 s
//   "wait <file>"  one chunk ("Waiting"), then waits until <file> exists (the
//                  test creates it) or the turn is cancelled; then ", done."
//                  and `end_turn`: a turn that stays `working` exactly as
//                  long as a test needs, then ends on its own
//   "hold"         one chunk, then waits until cancelled (`cancelled`), with no
//                  timer: the session stays `working` for as long as a test needs
//   While any prompt runs, `_session/steering` (advertised as
//                  `_meta.steering.supported` at `initialize`, not in the
//                  Antigravity or generic personalities) injects a message:
//                  a turn waiting ("hold", "wait", "slow", "quiet") goes on
//                  at once, and the turn ends with "Steered: <text>." and
//                  `end_turn`; with no turn running it answers
//                  `promptRequired` (send now or wait)
//   "tools"        reads three files (src/a.ts, src/b.ts, src/c.ts), then edits
//                  src/a.ts with a diff; replies "Changed src/a.ts."
//   "quiet-tool"   one chunk and an `execute` tool call left in progress
//                  ("Run npm run build"), then silence until cancelled
//   "quiet"        one chunk, then silence until cancelled (no tool call)
//   "fail"         the prompt fails with a JSON-RPC internal error
//   "usage-limit"  the prompt fails with a JSON-RPC internal error whose
//                  message is a plan's usage-limit notice (handoff: the
//                  agent ran out of usage)
//   "whoami"       replies `agent=<FAKE_ACP_AGENT_NAME, or default>`: which
//                  registered agent a chat reached (epic 6, two agents at once),
//                  then ` home=<value>` when FAKE_ACP_HOME_ENV names the
//                  variable its home folder is in (6.3)
//   "env"          replies with the CLAUDE_CODE_EXECUTABLE it was given
//   "echo-env"     replies with its whole environment, `NAME=value` per line,
//                  each value split across two chunks, and writes it to stderr
//   "cancels"      replies `cancels=<session/cancel notifications this session got>`
//   "pids"         replies `pid=<its pid> grandchild=<pid or none>`
//   "session-start"  replies one JSON line `{ via, cwd, mcpServers, meta,
//                  prompt, env }`: how the session was opened (`new`,
//                  `resumed`, `loaded`), the `cwd`, `mcpServers` and `_meta`
//                  (`null` when absent) its `session/new`, `resume` or `load`
//                  carried, the whole prompt text it received, and its
//                  environment (story 10.6: what a simple project's session
//                  starts with)
//   "write-doc <relpath>"  writes a small Markdown file at <relpath> under the
//                  session's cwd (never outside it), reports an `edit` tool
//                  call, then completes it with a diff of the file's absolute
//                  path; replies "Wrote <relpath>." (story 4.7)
//   "/bmad-retrospective <folder>"  the look-back (epic 7): writes
//                  <folder>/<folder name>-retrospective.md under the session's
//                  cwd, with `verdict` (FAKE_ACP_RETRO_VERDICT, default
//                  `accepted-with-open-items`) and `date` in its frontmatter and
//                  a proposed pitfall in its body, as an `edit` tool call
//                  completed with a diff (a document card), then replies
//                  `command=<text> primed=<n>` and "Wrote <path>."
//   "/bmad-project-context <retrospective path>"  the lessons (epic 7):
//                  appends one pitfall line to AGENTS.md at the cwd (made if
//                  missing), as an `edit` tool call, then replies
//                  `command=<text> primed=<n>` and "Updated AGENTS.md."
//   "write-file <relpath> <base64>"  as "write-doc", but writes the decoded
//                  bytes (an agent writing a plan file or `tickets.toml`;
//                  story 4.13)
//
//   "mode"         replies `mode=<its current session mode>` (permission modes)
//   "mode-switch <mode id>"  switches its own session mode, as the agent does
//                  entering plan mode, reports it (`current_mode_update`), and
//                  replies `mode=<mode id>`
//   "permission-safety <command>"  as "permission <command>", but asked even
//                  in `bypassPermissions` (one of the agent's own safety checks)
//   "guards"       replies `ask=<JSON of the permissions.ask rules its session
//                  was started with>` (`_meta.claudeCode.options.settings`)
//   In `acceptEdits`, `auto` and `bypassPermissions`, "permission-edit <path>"
//   edits without asking unless one of those ask rules matches the path
//   (`Edit(**/<folder>/**)` or `Edit(**/<file>)`), which still asks, as
//   Claude Code's bypass-immune ask rules do.
//   "/bmad-build-auto ticket <ref>"  build mode (story 5.2): plays one
//                  unattended build in the session's cwd (the run's
//                  worktree). It asks permission to write src/built-<ref>.txt
//                  (an `edit` naming the absolute path) and writes it if
//                  allowed; asks to write ../escape-<ref>.txt (outside the
//                  worktree) and writes it only if allowed (the build policy
//                  must refuse); sets the ticket's plan (the `.md` under
//                  _bmad-output whose frontmatter says `ticket: <id>`) to
//                  `status: built`, or with FAKE_ACP_BUILD_OUTCOME=blocked to
//                  `blocked` with a reason; with FAKE_ACP_BUILD_HOOKS=<dir>
//                  also writes executable `.husky/` hooks that would create
//                  files in <dir> if git ever ran them; then commits it all on
//                  the run's branch (its own commit runs no hook) and replies
//                  "Built <ref>." (or "Blocked <ref>.").
//                  Story 5.3's switches for epics 5 and 11's lanes:
//                  FAKE_ACP_BUILD_HALT=<blocking condition> blocks the plan
//                  with that `blocked_reason`, as the skill's HALT writes it
//                  (an `intent gap` also saves `<plan>.patch` beside the plan,
//                  a patch adding src/fix-<ref>.txt, and leaves no code
//                  change); FAKE_ACP_BUILD_FAIL_TESTS=1 also writes
//                  `.fake-tests-fail`, so the fixture's test command
//                  (FAKE_TEST_COMMAND_FILES in tests/fixtures/fake-bmad-repo.ts) fails 3 tests;
//                  FAKE_ACP_BUILD_DELAY_MS=<n> waits n ms before finishing
//                  (a time limit to hit); FAKE_ACP_BUILD_CHILD=<file> starts a
//                  long-lived child process (a build's command still running)
//                  and writes "<agent pid> <child pid>" to <file> (story 5.4:
//                  stopping the session must stop both). Story 5.7:
//                  FAKE_ACP_BUILD_ENV_DUMP=<file> writes the agent's whole
//                  environment there (`NAME=value` per line);
//                  FAKE_ACP_BUILD_ECHO_KEY=1 says ANTHROPIC_API_KEY in a message.
//   "plan-exit"    asks permission to leave plan mode with the real adapter's
//                  options (mode-raising ones as `allow_always`, "manually
//                  approve" as `allow_once`); replies `chose=<option id>`
//   "permission-always-only"  asks permission with one `allow_always` option
//                  only (no `allow_once`, no `reject_once`); replies
//                  `chose=<option id>` or `chose=cancelled` (6.4)
//   "permission-abandon <file>"  "Working" until <file> exists, then an
//                  `execute` tool call (`npm test`) and its permission
//                  request; once <file>.withdraw exists, it withdraws the
//                  request (`$/cancel_request`) without waiting for the
//                  answer, as Claude Code does when its SDK aborts a tool
//                  call; the call fails, it replies "Gave up on npm test."
//                  and ends its turn (`end_turn`). The test creates both files
//
//   "model"        replies `model=<the model its session runs on>` (story 11)
//   "model-switch <model id>"  switches its own model, as an agent falling
//                  back does, reports it (`config_option_update`), and replies
//                  `model=<model id>`
//
// Models (story 11): `session/new`, `session/resume` and `session/load`
// answer `configOptions` with a `model` select (category `model`, as
// claude-agent-acp 0.84 and Antigravity list theirs): `fake-default`,
// `fake-large`, `fake-small` and `fake-locked`, starting on
// FAKE_ACP_START_MODEL, else the value after a `--model` argument, else
// `fake-default`. `session/set_config_option` switches it; `fake-locked` is
// refused with the agent's own words (a plan without it), an unlisted value
// as Claude Code refuses one. FAKE_ACP_NO_MODELS=1 lists no models (an agent
// that takes its model only at start: FAKE_ACP_START_MODEL or `--model`).
//
// Session modes (permission modes): `session/new`, `session/resume` and
// `session/load` answer `modes` as claude-agent-acp 0.84 does (`default`,
// `acceptEdits`, `plan`, `auto`, `bypassPermissions`), starting in
// FAKE_ACP_START_MODE (default `default`, as a user's or project's
// `permissions.defaultMode` would set it), and `session/set_mode` sets the
// mode. In `bypassPermissions`, "permission <command>" runs without asking.
// FAKE_ACP_SET_MODE_FAIL=<mode id> takes that mode, then fails the `set_mode`;
// FAKE_ACP_SET_MODE_HANG=<mode id> takes it and never answers (adapter tests only).
// FAKE_ACP_NO_AUTO=1 lists no `auto`, FAKE_ACP_NO_BYPASS=1 no
// `bypassPermissions`; FAKE_ACP_AUTO_FALLBACK=1 answers `set_mode auto`, then
// falls back to `acceptEdits` and reports it (a model without Auto). These
// switches reach the agent only through wrappers
// (`fake-acp-agent-start-bypass.mjs`, `fake-acp-agent-no-modes.mjs`,
// `fake-acp-agent-auto-fallback.mjs`): the server passes agents an
// allowlisted environment.
//
// With FAKE_ACP_EXIT_AT_START=1 it exits before answering anything. With
// FAKE_ACP_SPAWN_GRANDCHILD=1 it starts a long-lived child of its own (as the
// real adapter starts `claude`), which it never stops.
//
// FAKE_ACP_RESUME picks how it reopens a session: `resume` advertises
// `sessionCapabilities.resume`, `load` advertises `loadSession` (and replays
// one earlier chunk, "Earlier reply.", while loading), `none` neither.
// `both` advertises both. Unset, it advertises neither. Any session id is
// accepted: a reopen is a new process, and the fake keeps nothing on disk.
//
// FAKE_ACP_REOPEN_FAIL lists (comma-separated) the reopen methods that refuse:
// `resume` and `load` fail with resource-not-found, `resume-auth` fails resume
// with ACP's auth-required error (-32000).
//
// A prompt that core primed with a transcript ends with the user's text after
// the "[Ogden Agents] New message:" line; the keywords above match that text.
//
// FAKE_ACP_AUTH=terminal advertises one terminal-type sign-in method, but only
// to a client that sets `clientCapabilities.auth.terminal`.
// FAKE_ACP_AUTH=claude-terminal advertises the real adapter's methods
// (claude-agent-acp 0.84: `claude-ai-login` and `console-login`), to the same
// clients (story 9.1).
//
// FAKE_ACP_SKIP_PERMISSION=1 makes "permission" (and "permission <command>")
// run the command without asking: the tool call, then "Ran <command>.", and no
// `session/request_permission` (story 2.13's hold proof, an agent that doesn't
// wait for a decision). It reaches the agent only through a wrapper
// (`fake-acp-agent-no-hold.mjs`): the server passes agents an allowlisted
// environment.
//
// FAKE_ACP_REQUIRE_API_KEY=1 makes every prompt need ANTHROPIC_API_KEY (story
// 9.2): without it the prompt fails with ACP's auth-required error (-32000);
// with it the reply is "key received …<last 4>" (never the whole value).
//
// A generic second agent (epic 6, 6.3), in place of Claude Code's shapes:
// FAKE_ACP_MODES=`id:Name,…` lists exactly those session modes (start in
// FAKE_ACP_START_MODE); FAKE_ACP_AUTH_METHODS=`id:Name,…` advertises those
// agent-type sign-in methods; FAKE_ACP_API_KEY_ENV names the variable
// FAKE_ACP_REQUIRE_API_KEY reads; FAKE_ACP_HOME_ENV names its home variable
// (see "whoami").
//
// A generic third agent's hooks (epic 12, 12.3), beside the above, all
// agent-neutral: `authenticate`'s `_meta` is kept ("auth" replies `meta=<JSON>`
// when it carried one); FAKE_ACP_REJECT_OPTIONS=`id:Name,…` replaces the
// `reject_once` option of "permission <command>" with those (all of kind
// `reject_once`, in that order) and the reply gets ` chose=<option id>`;
// FAKE_ACP_FIXED_MODE=1 is an agent that takes its mode only when a session
// opens: no session modes are listed, `session/set_mode` is refused, and the
// mode is the `_meta.mode` (`ask`, `auto` or `skip_all`) of `session/new`,
// `resume` or `load` (default `ask`): "mode" replies `mode=<it>`, and in
// `skip_all` "permission <command>" runs without asking.
//
// Codex's personality (epic 12 entry 4; spike 12.1's shapes), set by the wrapper
// `fake-codex.mjs` (FAKE_ACP_PERSONALITY=codex): `session/list` beside resume and
// load, the four session modes (`read-only`, `workspace-write`, `agent`,
// `agent-full-access`), starting in `INITIAL_AGENT_MODE` (default `agent`),
// sign-in methods `chat-gpt` and `api-key` (the key from CODEX_API_KEY), no
// session before `authenticate`, and "permission <command>" with Codex's
// options (`allow_once`, `allow_for_session`, and two reject_once: `decline`
// and `cancel`). `agent-full-access` runs commands without asking.
//
// Grok's personality (epic 12 entry 4; spike 12.2's shapes and the entry 7
// probes of 1.0.49), set by the wrapper `fake-grok.mjs` (FAKE_ACP_PERSONALITY=grok):
// `session/list`, resume, load and close; only `grok.com` advertised and never
// signed into (it refuses), `xai.api_key` accepted unadvertised and only with
// XAI_API_KEY in its environment; no session before `authenticate`; no session
// modes and no `session/set_mode`: the mode is `_meta.yoloMode` (skip_all) or
// `_meta.autoMode` (auto) of `session/new`, `resume` or `load`, default ask
// ("mode" replies `mode=<it>`); it ignores the project's `.claude/settings.json`
// (as the real agent did in the probe); "permission <command>" offers
// `allow_once`, `allow_always`, `reject_once` and `reject_always`; "env" replies
// `GROK_FOLDER_TRUST=<v> GROK_DISABLE_AUTOUPDATER=<v> key=<last 4 or none>`;
// "meta" replies `meta=<the _meta its session opened with>`; "skills" replies the folders of `.claude/skills` it sees, none unless
// GROK_FOLDER_TRUST is `0` (its own folder trust skips project skills otherwise).
//
// Antigravity's personality (epic 6 entry 5; spike 6.1's shapes), set by the
// wrapper `fake-antigravity.mjs` (FAKE_ACP_PERSONALITY=antigravity): its
// `agentInfo` (`antigravity-acp` 1.3.0), `session/list` beside resume and
// load, "permission <command>" with its options (`allow` allow_once, `deny`
// reject_once, `allow_always` "Allow Always") and the command in
// `rawInput.CommandLine`, replying "Ran <command>. chose=<option id>" or
// "Denied <command>. chose=<option id>"; `yolo` runs it without asking, as
// `bypassPermissions` does; "trust" asks its workspace-trust question
// (`trust` allow_once, `dont_trust` reject_once) and replies
// `trust=<option id or cancelled>`.
// FAKE_ACP_REQUIRE_AUTH=1 refuses `session/new`, `resume` and `load` with
// ACP's auth-required error (-32000) until `authenticate` was called in this
// process (as Antigravity does before a sign-in method is chosen); "auth"
// replies `auth=<method id or none> key=<last 4 of its API key or none>`.
// FAKE_ACP_INIT_DELAY_MS delays the `initialize` answer (Antigravity takes
// about 17 s to start on Windows).
// Its Google sign-in (epic 6 entry 7, spike 6.1's route): `authenticate
// oauth-personal` prints "Open the following link to authenticate the ACP
// server: <url>" on stderr (FAKE_ACP_OAUTH_URL, default a fake
// accounts.google.com link), runs `$BROWSER <url>` when set (no shell), and
// waits until the "browser" answers: a file `fake-google-consent` (signed in)
// or `fake-google-deny` (refused) in its home ($GEMINI_HOME). Signed in, it
// keeps `fake-google-signed-in` there, which a later process counts as a
// sign-in (as its stored credentials would be); `logout` (advertised as
// `auth.logout`) removes it.
//
// FAKE_ACP_REQUIRE_LOGIN=<state file> makes every prompt need a sign-in (story
// 9.4): until `fake-claude-login.mjs` has written `{"loggedIn":true}` to that
// file (its FAKE_LOGIN_STATE), the prompt fails with ACP's auth-required error
// (-32000); after it, prompts behave as usual. The file is read on each prompt.
//
// FAKE_ACP_CLAUDE_RECORD=1, with CLAUDE_CONFIG_DIR set, records each exchange
// that gets the default reply as Claude Code's own record of the session, as
// the real Agent SDK does (story 3.10): the user's text and the reply,
// appended as JSONL to `$CLAUDE_CONFIG_DIR/projects/<folder slug>/<session
// id>.jsonl` and chained by `parentUuid`, the file the fake CLI
// (`fake-claude-cli.mjs`) appends its turns to. So a chat switched back from
// the terminal lines its turns up and imports them. Off by default, and
// never without CLAUDE_CONFIG_DIR: never the user's own ~/.claude.
//
// `--cli <args>` runs the fake Claude CLI, `fake-claude-login.mjs <args>`, as
// the real adapter runs `claude`: as a child with this process's terminal,
// passing on its exit code (story 9.1). `--cli auth status --json` is answered
// here, in this one process and before the ACP SDK loads, as fast as the real
// `claude auth status`: the server runs it on every read of the agents (with a
// 5 s limit), and a wrapper process plus a second Node start and the SDK's
// load could pass that limit on a busy Windows runner, which reads as "can't
// check the sign-in" and turns a saved API key off.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

if (process.env.FAKE_ACP_EXIT_AT_START === '1') process.exit(3);

if (process.argv.includes('--cli')) {
  const cliArgs = process.argv.slice(2).filter((arg) => arg !== '--cli');
  if (cliArgs[0] === 'auth' && cliArgs[1] === 'status') {
    // As `fake-claude-login.mjs auth status` answers it.
    const state = process.env.FAKE_LOGIN_STATE;
    let signedIn = false;
    try {
      signedIn = state !== undefined && existsSync(state) && JSON.parse(readFileSync(state, 'utf8')).loggedIn === true;
    } catch {
      signedIn = false;
    }
    process.stdout.write(`${JSON.stringify({ loggedIn: signedIn, authMethod: signedIn ? 'claude.ai' : 'none' })}\n`, () => process.exit(signedIn ? 0 : 1));
    await new Promise(() => {});
  }
  const cli = spawn(process.execPath, [fileURLToPath(new URL('./fake-claude-login.mjs', import.meta.url)), ...cliArgs], { stdio: 'inherit' });
  for (const signal of process.platform === 'win32' ? ['SIGINT', 'SIGTERM'] : ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => cli.kill(signal));
  }
  cli.on('error', () => process.exit(1));
  cli.on('exit', (code) => process.exit(code ?? 1));
  // Nothing below runs: this process only wraps the CLI.
  await new Promise(() => {});
}

// Loaded only for the agent itself, so the CLI paths above stay fast.
const acp = await import('@agentclientprotocol/sdk');

const grandchild =
  process.env.FAKE_ACP_SPAWN_GRANDCHILD === '1'
    ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    : undefined;

/** Chunk delay, so a live subscriber sees the reply stream in. */
const CHUNK_DELAY_MS = Number(process.env.FAKE_ACP_CHUNK_DELAY_MS ?? '20');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {Map<string, { cancel?: () => void, via: 'new' | 'resumed' | 'loaded' }>} */
const sessions = new Map();
let nextSession = 1;
const RESUME = process.env.FAKE_ACP_RESUME ?? '';
const REOPEN_FAIL = new Set((process.env.FAKE_ACP_REOPEN_FAIL ?? '').split(',').filter((method) => method !== ''));
const NEW_MESSAGE = '[Ogden Agents] New message:\n';
/** Antigravity's personality (epic 6 entry 5), from `fake-antigravity.mjs`. */
const ANTIGRAVITY = process.env.FAKE_ACP_PERSONALITY === 'antigravity';
/** Codex's personality (epic 12 entry 4), from `fake-codex.mjs`. */
const CODEX = process.env.FAKE_ACP_PERSONALITY === 'codex';
/** Grok's personality (epic 12 entry 4), from `fake-grok.mjs`. */
const GROK = process.env.FAKE_ACP_PERSONALITY === 'grok';

/**
 * Whether it offers the steering extension (send now or wait): as
 * claude-agent-acp 0.84 does, advertised at `initialize`; Antigravity's
 * personality and a generic agent (FAKE_ACP_MODES) don't.
 */
const STEERING = !ANTIGRAVITY && !GROK && process.env.FAKE_ACP_MODES === undefined;
const INIT_DELAY_MS = Number(process.env.FAKE_ACP_INIT_DELAY_MS ?? '0');
/** The sign-in method `authenticate` chose in this process, if any, and the `_meta` it carried. */
let authenticatedWith;
let authenticatedMeta;
/** Antigravity's home, where its fake Google sign-in is kept (epic 6 entry 7). */
const googleHome = () => process.env.GEMINI_HOME;
const googleFile = (name) => (googleHome() === undefined ? undefined : join(googleHome(), name));
const signedInWithGoogle = () => ANTIGRAVITY && googleFile('fake-google-signed-in') !== undefined && existsSync(googleFile('fake-google-signed-in'));
const requireAuth = () => {
  if (process.env.FAKE_ACP_REQUIRE_AUTH === '1' && authenticatedWith === undefined && !signedInWithGoogle()) {
    throw acp.RequestError.authRequired({ message: 'Authentication required. Call authenticate first.' }, 'Authentication required');
  }
};

/**
 * `id:Name,id:Name` (FAKE_ACP_MODES, FAKE_ACP_AUTH_METHODS: a generic second
 * agent's own mode or sign-in ids, 6.3) as `{ id, name }`s.
 */
const listOf = (value) =>
  value
    .split(',')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [id, ...name] = entry.split(':');
      return { id, name: name.join(':') || id };
    });

/**
 * The session modes it lists: as claude-agent-acp 0.84 lists them, or (a
 * generic agent, 6.3) exactly FAKE_ACP_MODES.
 */
const AVAILABLE_MODES = process.env.FAKE_ACP_MODES ? listOf(process.env.FAKE_ACP_MODES).map((mode) => ({ ...mode, description: mode.name })) : [
  { id: 'default', name: 'Manual', description: 'Always ask before making changes' },
  { id: 'acceptEdits', name: 'Accept edits', description: 'Automatically accept all file edits' },
  { id: 'plan', name: 'Plan', description: 'Create a plan before making changes' },
  ...(process.env.FAKE_ACP_NO_AUTO === '1' ? [] : [{ id: 'auto', name: 'Auto', description: 'Claude handles permission decisions' }]),
  ...(process.env.FAKE_ACP_NO_BYPASS === '1' ? [] : [{ id: 'bypassPermissions', name: 'Bypass permissions', description: 'Accepts all permissions' }]),
];
/** The variable FAKE_ACP_REQUIRE_API_KEY reads its key from: FAKE_ACP_API_KEY_ENV (a generic agent's own, 6.3), else Claude Code's. */
const API_KEY_ENV = process.env.FAKE_ACP_API_KEY_ENV || 'ANTHROPIC_API_KEY';
// Codex starts in the mode `INITIAL_AGENT_MODE` names, else its own default, Auto review (`agent`).
const START_MODE = process.env.FAKE_ACP_START_MODE ?? (CODEX ? (process.env.INITIAL_AGENT_MODE ?? 'agent') : 'default');
/** Modes in which it edits files without asking (Claude Code's `acceptEdits`, `auto` and `bypassPermissions`). */
const EDITS_WITHOUT_ASKING = new Set(['acceptEdits', 'auto', 'bypassPermissions', 'auto_edit', 'yolo', 'skip_all', 'agent-full-access']);
/** Modes in which it runs commands without asking (Claude Code's `bypassPermissions`, Antigravity's `yolo`). */
const RUNS_WITHOUT_ASKING = new Set(['bypassPermissions', 'yolo', 'skip_all', 'agent-full-access']);
/** The `permissions.ask` rules its session was started with (`_meta.claudeCode.options.settings`, as claude-agent-acp 0.84 reads them). */
const askRulesOf = (session) => session.opened?._meta?.claudeCode?.options?.settings?.permissions?.ask ?? [];
// Whether an `Edit(**/<folder>/**)` or `Edit(**/<file>)` rule matches `path` (the two shapes Ogden sends).
const askRuleMatches = (rules, path) => {
  const segments = path.split(/[\\/]/);
  return rules.some((rule) => {
    const folder = /^Edit\(\*\*\/(.+)\/\*\*\)$/.exec(rule);
    if (folder) return segments.slice(0, -1).includes(folder[1]);
    const file = /^Edit\(\*\*\/(.+)\)$/.exec(rule);
    return file !== null && segments.at(-1) === file[1];
  });
};
/** The models it lists (story 11). */
const MODELS = [
  { value: 'fake-default', name: 'Fake Default', description: 'The fake agent picks this one itself' },
  { value: 'fake-large', name: 'Fake Large' },
  { value: 'fake-small', name: 'Fake Small' },
  { value: 'fake-locked', name: 'Fake Locked', description: 'Not in your plan' },
];
const NO_MODELS = process.env.FAKE_ACP_NO_MODELS === '1';
const argModel = process.argv.indexOf('--model') === -1 ? undefined : process.argv[process.argv.indexOf('--model') + 1];
/** The model a session starts on: its start variable, else its `--model` argument, else its own choice. */
const START_MODEL = process.env.FAKE_ACP_START_MODEL || argModel || (NO_MODELS ? 'none' : 'fake-default');
/** The `configOptions` a session answer carries (none with FAKE_ACP_NO_MODELS). */
const configOf = (session) =>
  NO_MODELS ? [] : [{ id: 'model', name: 'Model', description: 'AI model to use', category: 'model', type: 'select', currentValue: session.model, options: MODELS }];

/** The `modes` a session answer carries, for a session now in `currentModeId`. */
const FIXED_MODE = process.env.FAKE_ACP_FIXED_MODE === '1';
const modesOf = (currentModeId) => (FIXED_MODE ? undefined : { currentModeId, availableModes: AVAILABLE_MODES });
/** The mode of an agent that fixes it when a session opens: its `_meta.mode`, default `ask`. */
const fixedModeOf = (opened) => (GROK ? (opened?._meta?.yoloMode === true ? 'skip_all' : opened?._meta?.autoMode === true ? 'auto' : 'ask') : (opened?._meta?.mode ?? 'ask'));
const REJECT_OPTIONS = process.env.FAKE_ACP_REJECT_OPTIONS ? listOf(process.env.FAKE_ACP_REJECT_OPTIONS) : undefined;

/** Appends `text` and `reply` to the session's Claude Code record (FAKE_ACP_CLAUDE_RECORD), chained after its last main-chain record. */
const recordExchange = (sessionId, text, reply) => {
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  if (process.env.FAKE_ACP_CLAUDE_RECORD !== '1' || !configDir) return;
  const folder = join(configDir, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'));
  const file = join(folder, `${sessionId}.jsonl`);
  mkdirSync(folder, { recursive: true });
  let parentUuid = null;
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      try {
        const record = JSON.parse(line);
        if (record.uuid && !record.isSidechain) parentUuid = record.uuid;
      } catch {
        // Not a record.
      }
    }
  }
  const user = { type: 'user', uuid: randomUUID(), parentUuid, isSidechain: false, sessionId, cwd: process.cwd(), message: { role: 'user', content: text } };
  const agent = {
    type: 'assistant',
    uuid: randomUUID(),
    parentUuid: user.uuid,
    isSidechain: false,
    sessionId,
    cwd: process.cwd(),
    message: { role: 'assistant', model: 'claude-fake', content: [{ type: 'text', text: reply }] },
  };
  appendFileSync(file, `${JSON.stringify(user)}\n${JSON.stringify(agent)}\n`);
};

/** Whether the fake login's state file says signed in (FAKE_ACP_REQUIRE_LOGIN). */
const loggedIn = (stateFile) => {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8')).loggedIn === true;
  } catch {
    return false;
  }
};

/**
 * @param {import('@agentclientprotocol/sdk').AgentContext} client
 * @param {string} sessionId
 * @param {Record<string, unknown>} update
 */
const update = (client, sessionId, update) => client.notify('session/update', { sessionId, update });

/**
 * @param {import('@agentclientprotocol/sdk').AgentContext} client
 * @param {string} sessionId
 * @param {string} text
 */
const say = (client, sessionId, text) =>
  client.notify('session/update', {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  });

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));

const agentBuilder = acp
  .agent({ name: 'fake-acp-agent' })
  .onRequest('initialize', async ({ params }) => {
    if (INIT_DELAY_MS > 0) await sleep(INIT_DELAY_MS);
    const terminalAuth = params.clientCapabilities?.auth?.terminal === true;
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: RESUME === 'load' || RESUME === 'both',
        sessionCapabilities: { ...(ANTIGRAVITY || CODEX || GROK ? { list: {} } : { close: {} }), ...(GROK ? { close: {} } : {}), ...(RESUME === 'resume' || RESUME === 'both' ? { resume: {} } : {}) },
        ...(ANTIGRAVITY ? { auth: { logout: {} } } : {}),
      },
      authMethods: process.env.FAKE_ACP_AUTH_METHODS
        ? // A generic agent's own sign-in methods, done by the agent itself (6.3).
          listOf(process.env.FAKE_ACP_AUTH_METHODS).map(({ id, name }) => ({ id, name, description: name }))
        : process.env.FAKE_ACP_AUTH === 'terminal' && terminalAuth
          ? [{ type: 'terminal', id: 'fake-login', name: 'Log in with your account', description: 'Signs in with the fake agent', args: ['--login'], env: { FAKE_LOGIN: '1' } }]
          : process.env.FAKE_ACP_AUTH === 'claude-terminal' && terminalAuth
            ? [
                { type: 'terminal', id: 'claude-ai-login', name: 'Claude Subscription', description: 'Use Claude subscription ', args: ['--cli', 'auth', 'login', '--claudeai'] },
                { type: 'terminal', id: 'console-login', name: 'Anthropic Console', description: 'Use Anthropic Console (API usage billing)', args: ['--cli', 'auth', 'login', '--console'] },
              ]
            : [],
      agentInfo: ANTIGRAVITY ? { name: 'antigravity-acp', title: 'Google Antigravity', version: '1.3.0' } : CODEX ? { name: '@agentclientprotocol/codex-acp', title: 'Codex', version: '2.1.1' } : GROK ? { name: 'grok', title: 'Grok Build', version: '1.0.49' } : { name: 'fake-acp-agent', version: '1.0.0' },
      ...(STEERING ? { _meta: { steering: { supported: true } } } : {}),
    };
  })
  .onRequest('authenticate', async ({ params }) => {
    if (GROK) {
      // Only the unadvertised `xai.api_key`, and only with a token in its environment; `grok.com` (an account sign in) is never done here.
      if (params.methodId !== 'xai.api_key') throw acp.RequestError.invalidParams(undefined, `the fake Grok does not sign in with ${params.methodId}`);
      if (!process.env.XAI_API_KEY) throw acp.RequestError.authRequired(undefined, 'no xAI API access token');
    }
    if (ANTIGRAVITY && params.methodId === 'oauth-personal' && !signedInWithGoogle()) {
      const url = process.env.FAKE_ACP_OAUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth?client_id=fake-client&state=fake-state&redirect_uri=http%3A%2F%2F127.0.0.1%3A9%2F&scope=openid';
      // What its sign-in process was given, for the tests: whether a key reached it, and its home.
      writeFileSync(googleFile('fake-google-env'), `key=${process.env.GEMINI_API_KEY ? 'set' : 'none'}\n`);
      process.stderr.write(`Open the following link to authenticate the ACP server: ${url}\n`);
      if (process.env.BROWSER) {
        try {
          spawn(process.env.BROWSER, [url], { stdio: 'ignore' }).on('error', () => {});
        } catch {
          // As Python's webbrowser: a browser that can't start is skipped.
        }
      }
      for (;;) {
        const consent = googleFile('fake-google-consent');
        const deny = googleFile('fake-google-deny');
        if (deny !== undefined && existsSync(deny)) {
          rmSync(deny, { force: true });
          throw acp.RequestError.internalError(undefined, 'the fake Google sign-in was refused');
        }
        if (consent !== undefined && existsSync(consent)) {
          rmSync(consent, { force: true });
          writeFileSync(googleFile('fake-google-signed-in'), 'signed in\n');
          break;
        }
        await sleep(50);
      }
    }
    authenticatedWith = params.methodId;
    authenticatedMeta = params._meta;
    return {};
  })
  .onRequest('logout', () => {
    if (googleFile('fake-google-signed-in') !== undefined) rmSync(googleFile('fake-google-signed-in'), { force: true });
    authenticatedWith = undefined;
    return {};
  })
  .onRequest('session/new', ({ params }) => {
    requireAuth();
    const sessionId = `fake-session-${nextSession++}`;
    const session = { via: 'new', opened: params, mode: FIXED_MODE ? fixedModeOf(params) : START_MODE, model: START_MODEL };
    sessions.set(sessionId, session);
    return { sessionId, modes: modesOf(START_MODE), configOptions: configOf(session) };
  })
  .onRequest('session/resume', ({ params }) => {
    if (RESUME !== 'resume' && RESUME !== 'both') throw acp.RequestError.methodNotFound('session/resume');
    requireAuth();
    if (REOPEN_FAIL.has('resume-auth')) throw acp.RequestError.authRequired(undefined, 'the fake agent needs a new sign-in');
    if (REOPEN_FAIL.has('resume')) throw acp.RequestError.resourceNotFound(params.sessionId);
    const session = { via: 'resumed', opened: params, mode: FIXED_MODE ? fixedModeOf(params) : START_MODE, model: START_MODEL };
    sessions.set(params.sessionId, session);
    return { modes: modesOf(START_MODE), configOptions: configOf(session) };
  })
  .onRequest('session/load', async ({ params, client }) => {
    if (RESUME !== 'load' && RESUME !== 'both') throw acp.RequestError.methodNotFound('session/load');
    requireAuth();
    // The history a load replays: the client already has it.
    await say(client, params.sessionId, 'Earlier reply.');
    if (REOPEN_FAIL.has('load')) throw acp.RequestError.resourceNotFound(params.sessionId);
    const session = { via: 'loaded', opened: params, mode: FIXED_MODE ? fixedModeOf(params) : START_MODE, model: START_MODEL };
    sessions.set(params.sessionId, session);
    return { modes: modesOf(START_MODE), configOptions: configOf(session) };
  })
  .onRequest('session/set_mode', ({ params, client }) => {
    if (FIXED_MODE) throw acp.RequestError.methodNotFound('session/set_mode');
    const session = sessions.get(params.sessionId);
    if (session === undefined) throw acp.RequestError.invalidParams(undefined, `no session ${params.sessionId}`);
    if (!AVAILABLE_MODES.some((mode) => mode.id === params.modeId)) throw acp.RequestError.invalidParams(undefined, `Mode ${params.modeId} is not available`);
    session.mode = params.modeId;
    // Takes the mode, then fails the request, or never answers it (an agent whose answer can't be trusted).
    if (process.env.FAKE_ACP_SET_MODE_FAIL === params.modeId) throw acp.RequestError.internalError(undefined, 'the fake agent failed set_mode on purpose');
    if (process.env.FAKE_ACP_SET_MODE_HANG === params.modeId) return new Promise(() => {});
    if (params.modeId === 'auto' && process.env.FAKE_ACP_AUTO_FALLBACK === '1') {
      // Answers first, then falls back to accepting edits and says so (a model without Auto).
      setTimeout(() => {
        session.mode = 'acceptEdits';
        void update(client, params.sessionId, { sessionUpdate: 'current_mode_update', currentModeId: 'acceptEdits' });
      }, 20);
    }
    return {};
  })
  .onRequest('session/set_config_option', ({ params }) => {
    const session = sessions.get(params.sessionId);
    if (session === undefined) throw acp.RequestError.invalidParams(undefined, `no session ${params.sessionId}`);
    if (NO_MODELS || params.configId !== 'model') throw new Error(`Unknown config option: ${params.configId}`);
    // As Claude Code: an unlisted value is refused; a listed one the user's plan lacks is refused in plain words.
    if (!MODELS.some((model) => model.value === params.value)) throw new Error(`Invalid value for config option model: ${params.value}`);
    if (params.value === 'fake-locked') throw new Error("Your plan doesn't include Fake Locked.");
    session.model = params.value;
    return { configOptions: configOf(session) };
  })
  .onRequest('session/prompt', async ({ params, client }) => {
    const session = sessions.get(params.sessionId);
    if (session === undefined) throw acp.RequestError.invalidParams(undefined, `no session ${params.sessionId}`);
    session.turns = (session.turns ?? 0) + 1;
    session.steered = [];
    try {
      const result = await runPrompt(params, client, session);
      // Messages steered into the turn are answered before it ends; a wait they ended is no cancel.
      const steered = session.steered.splice(0);
      for (const text of steered) await say(client, params.sessionId, `Steered: ${text}.`);
      return steered.length > 0 ? { stopReason: 'end_turn' } : result;
    } finally {
      session.turns -= 1;
    }
  })
  // The steering extension (claude-agent-acp 0.84, send now or wait): a message into the running turn.
  .onRequest('_session/steering', { parse: (params) => params }, async ({ params }) => {
    const session = sessions.get(params.sessionId);
    if (session === undefined) throw acp.RequestError.invalidParams(undefined, `no session ${params.sessionId}`);
    if (!STEERING) throw acp.RequestError.methodNotFound('_session/steering');
    if ((session.turns ?? 0) === 0) return { outcome: 'promptRequired', reason: 'noRunningTurn' };
    const text = params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('');
    session.steered.push(text);
    // A turn waiting on something ("hold", "wait", "slow", "quiet") goes on with the message, after
    // this answer is out (as the real adapter answers before the model's next output).
    setTimeout(() => session.cancel?.(), 20);
    return { outcome: 'injected' };
  });

/** One prompt's turn (the behaviors listed at the top). */
async function runPrompt(params, client, session) {
  {
    // Kept as a block: the behaviors below were the prompt handler's body.
    const whole = params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('');
    const primedAt = whole.lastIndexOf(NEW_MESSAGE);
    const primer = primedAt === -1 ? '' : whole.slice(0, primedAt);
    const primed = primer.split('\n').filter((line) => line.startsWith('User: ') || line.startsWith('Claude Code: ') || line.startsWith('Antigravity: ')).length;
    const text = (primedAt === -1 ? whole : whole.slice(primedAt + NEW_MESSAGE.length)).trim();

    if (process.env.FAKE_ACP_REQUIRE_LOGIN && !loggedIn(process.env.FAKE_ACP_REQUIRE_LOGIN)) {
      throw acp.RequestError.authRequired(undefined, 'the fake agent needs a new sign-in');
    }
    if (process.env.FAKE_ACP_REQUIRE_API_KEY === '1') {
      const key = process.env[API_KEY_ENV];
      if (!key) throw acp.RequestError.authRequired(undefined, 'the fake agent needs an API key');
      await say(client, params.sessionId, `key received …${key.slice(-4)}`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'markdown') {
      // A Markdown reply in chunks (backlog story 14): the code fence opens in one chunk and closes in a later one.
      const chunks = [
        '## Summary\n\nSome **bold** text, a [docs link](https://example.com/docs) and a [bad link](javascript:alert(1)).\n\n',
        '- [x] tests\n- [ ] docs\n\n```ts\nconst answer = 42;\n',
        'console.log("<b>" + answer);\n```\n\n| Name | Count |\n| --- | ---: |\n| apples | 3 |\n\n',
        '<script>window.hacked = true</script> ![chart](https://example.com/chart.png)\n',
      ];
      for (const chunk of chunks) {
        await say(client, params.sessionId, chunk);
        await sleep(CHUNK_DELAY_MS);
      }
      return { stopReason: 'end_turn' };
    }
    if (text === 'crash') {
      await say(client, params.sessionId, 'About to ');
      await sleep(CHUNK_DELAY_MS);
      process.exit(1);
    }
    if (text === 'fail') throw acp.RequestError.internalError(undefined, 'the fake agent failed on purpose');
    if (text === 'usage-limit') throw acp.RequestError.internalError(undefined, 'Claude AI usage limit reached|1760000000');
    if (text === 'auth-expired') throw acp.RequestError.authRequired(undefined, 'the fake agent needs a new sign-in');
    // The look-back and the lessons (epic 7, story 7.2): the retrospective skill writes its document, the project-context skill edits AGENTS.md.
    if (text.startsWith('/bmad-retrospective ') || text.startsWith('/bmad-project-context ')) {
      const retro = text.startsWith('/bmad-retrospective ');
      const argument = text.slice(text.indexOf(' ') + 1).trim();
      const cwd = session.opened.cwd ?? process.cwd();
      const relpath = retro ? `${argument.replace(/\/+$/, '')}/${argument.replace(/\/+$/, '').split('/').pop()}-retrospective.md` : 'AGENTS.md';
      const file = resolve(cwd, relpath);
      const inside = relative(cwd, file);
      if (argument === '' || inside === '' || inside.startsWith('..') || isAbsolute(inside)) throw acp.RequestError.invalidParams(undefined, 'the fake agent writes only inside the session cwd');
      const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
      const content = retro
        ? `---\nepic: ${argument.split('/').pop()}\ndate: 2026-10-05T12:00:00-0600\nverdict: ${process.env.FAKE_ACP_RETRO_VERDICT ?? 'accepted-with-open-items'}\n---\n\n# Retrospective\n\n## Proposed AGENTS.md pitfalls\n\n- Run the fake check before you say a fake change is done.\n`
        : `${before ?? '# Project instructions\n'}${before === null || before.endsWith('\n') ? '' : '\n'}\n- Run the fake check before you say a fake change is done.\n`;
      const toolCallId = `call-write-${randomUUID()}`;
      await update(client, params.sessionId, { sessionUpdate: 'tool_call', toolCallId, title: `Write ${relpath}`, kind: 'edit', status: 'in_progress', locations: [{ path: file }] });
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
      await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', content: [{ type: 'diff', path: file, oldText: before, newText: content }] });
      await say(client, params.sessionId, `command=${text} primed=${primed}`);
      await say(client, params.sessionId, retro ? `Wrote ${relpath}.` : 'Updated AGENTS.md.');
      return { stopReason: 'end_turn' };
    }
    // Any slash command but the build (story 5.2), which is played below.
    if (text.startsWith('/') && !text.startsWith('/bmad-build-auto ticket ')) {
      await say(client, params.sessionId, `command=${text} primed=${primed}`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'mode') {
      await say(client, params.sessionId, `mode=${session.mode}`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'model') {
      await say(client, params.sessionId, `model=${session.model}`);
      return { stopReason: 'end_turn' };
    }
    if (text.startsWith('model-switch ')) {
      session.model = text.slice('model-switch '.length).trim();
      await update(client, params.sessionId, { sessionUpdate: 'config_option_update', configOptions: configOf(session) });
      await say(client, params.sessionId, `model=${session.model}`);
      return { stopReason: 'end_turn' };
    }
    if (text.startsWith('mode-switch ')) {
      session.mode = text.slice('mode-switch '.length).trim();
      await update(client, params.sessionId, { sessionUpdate: 'current_mode_update', currentModeId: session.mode });
      await say(client, params.sessionId, `mode=${session.mode}`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'plan-exit') {
      // The real adapter's ExitPlanMode card: the mode-raising options are `allow_always`.
      const toolCall = { toolCallId: 'call-exit-plan', title: 'Ready to code?', kind: 'switch_mode', rawInput: { plan: 'The plan.' } };
      await update(client, params.sessionId, { sessionUpdate: 'tool_call', ...toolCall, status: 'pending' });
      const answer = await client.request('session/request_permission', {
        sessionId: params.sessionId,
        toolCall,
        options: [
          { optionId: 'exit-plan-clear-auto', name: 'Yes, clear context and use auto mode', kind: 'allow_always' },
          { optionId: 'exit-plan-auto', name: 'Yes, and use auto mode', kind: 'allow_always' },
          { optionId: 'exit-plan-bypass', name: 'Yes, and bypass permissions', kind: 'allow_always' },
          { optionId: 'exit-plan-default', name: 'Yes, manually approve edits', kind: 'allow_once' },
          { optionId: 'reject', name: 'No, keep planning', kind: 'reject_once' },
        ],
      });
      await say(client, params.sessionId, `chose=${answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled'}`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'permission-always-only') {
      // A request a card may not answer (6.4): only a session-wide option is on offer.
      const toolCall = { toolCallId: 'call-always-only', title: 'Run npm test', kind: 'execute', rawInput: { command: 'npm test' } };
      await update(client, params.sessionId, { sessionUpdate: 'tool_call', ...toolCall, status: 'pending' });
      const answer = await client.request('session/request_permission', {
        sessionId: params.sessionId,
        toolCall,
        options: [{ optionId: 'always', name: 'Always allow', kind: 'allow_always' }],
      });
      await say(client, params.sessionId, `chose=${answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled'}`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'auth') {
      const key = process.env[API_KEY_ENV];
      await say(client, params.sessionId, `auth=${authenticatedWith ?? 'none'} key=${key ? key.slice(-4) : 'none'}${authenticatedMeta === undefined ? '' : ` meta=${JSON.stringify(authenticatedMeta)}`}`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'trust') {
      // Antigravity's workspace-trust question (spike 6.1 saw `trust`/`dont_trust` in its binary).
      const toolCall = { toolCallId: 'call-trust', title: 'Trust this workspace?', kind: 'other', rawInput: { Cwd: process.cwd() } };
      const answer = await client.request('session/request_permission', {
        sessionId: params.sessionId,
        toolCall,
        options: [
          { optionId: 'trust', name: 'Trust', kind: 'allow_once' },
          { optionId: 'dont_trust', name: "Don't trust", kind: 'reject_once' },
        ],
      });
      await say(client, params.sessionId, `trust=${answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled'}`);
      return { stopReason: 'end_turn' };
    }
    if (text.startsWith('/bmad-build-auto ticket ')) {
      const ref = text.slice('/bmad-build-auto ticket '.length).trim().split(/\s/)[0];
      const cwd = session.opened.cwd ?? process.cwd();
      const ask = async (toolCallId, path) => {
        const toolCall = { toolCallId, title: `Write ${path}`, kind: 'edit', locations: [{ path }], rawInput: { file_path: path } };
        await update(client, params.sessionId, { sessionUpdate: 'tool_call', ...toolCall, status: 'pending' });
        const answer = await client.request('session/request_permission', {
          sessionId: params.sessionId,
          toolCall,
          options: [
            { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
          ],
        });
        const allowed = answer.outcome.outcome === 'selected' && answer.outcome.optionId === 'allow';
        await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId, status: allowed ? 'completed' : 'failed' });
        return allowed;
      };
      await say(client, params.sessionId, `Building ${ref}. `);
      // Story 5.7: what the build's agent was started with, for the secrets and allowlist tests.
      if (process.env.FAKE_ACP_BUILD_ENV_DUMP) writeFileSync(process.env.FAKE_ACP_BUILD_ENV_DUMP, Object.entries(process.env).map(([name, value]) => `${name}=${value}`).join('\n'));
      if (process.env.FAKE_ACP_BUILD_ECHO_KEY === '1') await say(client, params.sessionId, `The key is ${process.env.ANTHROPIC_API_KEY ?? 'none'}. `);
      const childFile = process.env.FAKE_ACP_BUILD_CHILD;
      if (childFile) {
        // Not detached: it stays in the agent's process group (its tree on Windows), as a build's command does.
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
        child.on('error', () => undefined);
        writeFileSync(childFile, `${process.pid} ${child.pid}\n`);
      }
      const inside = join(cwd, 'src', `built-${ref}.txt`);
      if (await ask('call-build-write', inside)) {
        mkdirSync(dirname(inside), { recursive: true });
        writeFileSync(inside, `Built ${ref} by the fake agent.\n`);
      }
      const outside = resolve(cwd, '..', `escape-${ref}.txt`);
      if (await ask('call-build-escape', outside)) writeFileSync(outside, 'escaped\n');
      // The plan: the Markdown file under _bmad-output whose frontmatter names this ticket's id.
      const id = ref.slice(ref.lastIndexOf('.') + 1);
      const plans = [];
      const visit = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) visit(full);
          else if (entry.name.endsWith('.md') && new RegExp(`^ticket:\\s*['"]?${id}['"]?\\s*$`, 'm').test(readFileSync(full, 'utf8'))) plans.push(full);
        }
      };
      if (existsSync(join(cwd, '_bmad-output'))) visit(join(cwd, '_bmad-output'));
      const halt = process.env.FAKE_ACP_BUILD_HALT;
      const blocked = process.env.FAKE_ACP_BUILD_OUTCOME === 'blocked' || (halt !== undefined && halt !== '');
      const reason = halt !== undefined && halt !== '' ? halt : 'The fake agent was told to block.';
      const delay = Number(process.env.FAKE_ACP_BUILD_DELAY_MS ?? '0');
      if (delay > 0) await new Promise((done) => setTimeout(done, delay));
      if (process.env.FAKE_ACP_BUILD_FAIL_TESTS === '1') writeFileSync(join(cwd, '.fake-tests-fail'), 'fail\n');
      for (const plan of plans) {
        const before = readFileSync(plan, 'utf8');
        const status = blocked ? `status: blocked\nblocked_reason: ${JSON.stringify(reason)}` : 'status: built';
        writeFileSync(plan, before.replace(/^status:.*$/m, status));
        if (blocked && reason.startsWith('intent gap')) {
          // As the skill's intent-gap HALT: the attempted change saved as a patch beside the plan, the code reverted.
          rmSync(inside, { force: true });
          const file = `src/fix-${ref}.txt`;
          writeFileSync(plan.replace(/\.md$/, '.patch'), `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n+Fixed ${ref} by the saved patch.\n`);
        }
      }
      const hooks = process.env.FAKE_ACP_BUILD_HOOKS;
      if (hooks) {
        mkdirSync(join(cwd, '.husky'), { recursive: true });
        for (const hook of ['pre-commit', 'commit-msg', 'post-merge', 'post-commit', 'post-checkout', 'pre-merge-commit']) {
          const file = join(cwd, '.husky', hook);
          writeFileSync(file, `#!/bin/sh\ntouch "${join(hooks, hook)}"\n`);
          chmodSync(file, 0o755);
        }
      }
      try {
        const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${join(cwd, '.no-hooks')}`, '-c', 'user.name=Fake Agent', '-c', 'user.email=fake@example.com', ...args], { cwd, stdio: 'ignore' });
        git('add', '-A');
        git('commit', '--no-verify', '-m', `Build ${ref}`);
      } catch {
        await say(client, params.sessionId, 'The commit failed. ');
      }
      await say(client, params.sessionId, `${blocked ? 'Blocked' : 'Built'} ${ref}.`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'context') {
      await say(client, params.sessionId, `session=${params.sessionId} via=${session.via} primed=${primed}`);
      return { stopReason: 'end_turn' };
    }
    if (text.startsWith('permission-kind ')) {
      // `permission-kind <kind> [<path>|…]`: a request of any tool kind naming those paths (story 2.8).
      // `permission-kind search-pattern <pattern> [<folder>]`: a Glob-like search, its pattern and folder in rawInput only (2.8 review F2).
      const [kind = 'other', ...rest] = text.slice('permission-kind '.length).trim().split(' ');
      const paths = rest.join(' ').split('|').map((path) => path.trim()).filter((path) => path !== '');
      const [pattern, folder] = rest;
      const toolCall =
        kind === 'search-pattern'
          ? { toolCallId: 'call-search-permission', title: `search ${pattern}`, kind: 'search', rawInput: { pattern, ...(folder === undefined ? {} : { path: folder }) } }
          : { toolCallId: `call-${kind}-permission`, title: `${kind} ${paths.join(', ')}`.trim(), kind, locations: paths.map((path) => ({ path })) };
      await update(client, params.sessionId, { sessionUpdate: 'tool_call', ...toolCall, status: 'pending' });
      const answer = await client.request('session/request_permission', {
        sessionId: params.sessionId,
        toolCall,
        options: [
          { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
          { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
        ],
      });
      const ran = answer.outcome.outcome === 'selected' && (answer.outcome.optionId === 'allow' || answer.outcome.optionId === 'always');
      await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: toolCall.toolCallId, status: ran ? 'completed' : 'failed' });
      await say(client, params.sessionId, `${ran ? 'Did' : 'Denied'} ${toolCall.title}.`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'guards') {
      await say(client, params.sessionId, `ask=${JSON.stringify(askRulesOf(session))}`);
      return { stopReason: 'end_turn' };
    }
    if (text.startsWith('permission-edit ')) {
      const paths = text.slice('permission-edit '.length).split('|').map((path) => path.trim()).filter((path) => path !== '');
      const toolCall = { toolCallId: 'call-edit-permission', title: `Edit ${paths.join(', ')}`, kind: 'edit', locations: paths.map((path) => ({ path })) };
      await update(client, params.sessionId, { sessionUpdate: 'tool_call', ...toolCall, status: 'pending' });
      // A mode that edits without asking does so, unless an ask rule it was started with matches (bypass-immune, as Claude Code's).
      if (EDITS_WITHOUT_ASKING.has(session.mode) && !paths.some((path) => askRuleMatches(askRulesOf(session), path))) {
        await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: toolCall.toolCallId, status: 'completed' });
        await say(client, params.sessionId, `Edited ${paths.join(', ')}.`);
        return { stopReason: 'end_turn' };
      }
      const answer = await client.request('session/request_permission', {
        sessionId: params.sessionId,
        toolCall,
        options: [
          { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
          { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
        ],
      });
      const edited = answer.outcome.outcome === 'selected' && (answer.outcome.optionId === 'allow' || answer.outcome.optionId === 'always');
      await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: toolCall.toolCallId, status: edited ? 'completed' : 'failed' });
      await say(client, params.sessionId, `${edited ? 'Edited' : 'Denied'} ${paths.join(', ')}.`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'permission' || text === 'permission-hold' || text.startsWith('permission ') || text.startsWith('permission-safety ')) {
      const safety = text.startsWith('permission-safety ');
      const holds = text === 'permission-hold';
      const command = text === 'permission' || holds ? 'npm test' : text.slice(safety ? 'permission-safety '.length : 'permission '.length).trim();
      // Antigravity names the command in `CommandLine` (6.5); Claude Code in `command`.
      const toolCall = { toolCallId: 'call-permission', title: `Run ${command}`, kind: 'execute', rawInput: ANTIGRAVITY ? { CommandLine: command } : { command } };
      await update(client, params.sessionId, { sessionUpdate: 'tool_call', ...toolCall, status: 'pending' });
      // Skipping permission checks (`bypassPermissions`, `yolo`) runs it without asking, unless it is one of its own safety checks.
      if (process.env.FAKE_ACP_SKIP_PERMISSION === '1' || (RUNS_WITHOUT_ASKING.has(session.mode) && !safety)) {
        await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: toolCall.toolCallId, status: 'completed' });
        await say(client, params.sessionId, `Ran ${command}.`);
        return { stopReason: 'end_turn' };
      }
      const answer = await client.request('session/request_permission', {
        sessionId: params.sessionId,
        toolCall,
        options: ANTIGRAVITY
          ? [
              { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
              { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
              { optionId: 'allow_always', name: 'Allow Always', kind: 'allow_always' },
            ]
          : GROK
            ? [
                { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
                { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
                { optionId: 'reject_once', name: 'Deny', kind: 'reject_once' },
                { optionId: 'reject_always', name: 'Always deny', kind: 'reject_always' },
              ]
            : [
              // Codex's own ids (codex-acp 2.1.1): Allow once `allow_once`, its session-wide `allow_for_session`.
              { optionId: CODEX ? 'allow_once' : 'allow', name: 'Allow once', kind: 'allow_once' },
              { optionId: CODEX ? 'allow_for_session' : 'always', name: 'Always allow', kind: 'allow_always' },
              ...(REJECT_OPTIONS ?? [{ id: 'reject', name: 'Deny' }]).map(({ id, name }) => ({ optionId: id, name, kind: 'reject_once' })),
              { optionId: 'never', name: 'Always deny', kind: 'reject_always' },
            ],
      });
      const chosen = answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled';
      const ran = ['allow', 'always', 'allow_always', 'allow_once', 'allow_for_session'].includes(chosen);
      if (holds && ran) {
        await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: toolCall.toolCallId, status: 'in_progress' });
        await new Promise((resolve) => {
          session.cancel = () => resolve(undefined);
        });
        session.cancel = undefined;
        return { stopReason: 'cancelled' };
      }
      await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: toolCall.toolCallId, status: ran ? 'completed' : 'failed' });
      await say(client, params.sessionId, `${ran ? 'Ran' : 'Denied'} ${command}.${ANTIGRAVITY || GROK || REJECT_OPTIONS ? ` chose=${chosen}` : ''}`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'tool') {
      await update(client, params.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call-edit', title: 'Edit src/example.ts', kind: 'edit', status: 'in_progress' });
      await update(client, params.sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-edit',
        status: 'completed',
        content: [{ type: 'diff', path: 'src/example.ts', oldText: 'const a = 1;\n', newText: 'const a = 2;\n' }],
      });
      await say(client, params.sessionId, 'Edited.');
      return { stopReason: 'end_turn' };
    }
    if (text.startsWith('write-doc ') || text.startsWith('write-file ')) {
      const own = text.startsWith('write-file ');
      const [relpath = '', encoded = ''] = own ? text.slice('write-file '.length).trim().split(/\s+/) : [text.slice('write-doc '.length).trim()];
      const cwd = session.opened.cwd ?? process.cwd();
      const file = resolve(cwd, relpath);
      const inside = relative(cwd, file);
      if (relpath === '' || inside === '' || inside.startsWith('..') || isAbsolute(inside)) throw acp.RequestError.invalidParams(undefined, 'write-doc writes only inside the session cwd');
      const content = own ? Buffer.from(encoded, 'base64').toString('utf8') : `---\ntitle: ${relpath}\n---\n\n# Written by the fake agent\n\nA **small** document at \`${relpath}\`.\n\n- one\n- two\n`;
      const toolCallId = `call-write-${randomUUID()}`;
      await update(client, params.sessionId, { sessionUpdate: 'tool_call', toolCallId, title: `Write ${relpath}`, kind: 'edit', status: 'in_progress', locations: [{ path: file }] });
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
      await update(client, params.sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'completed',
        content: [{ type: 'diff', path: file, oldText: null, newText: content }],
      });
      await say(client, params.sessionId, `Wrote ${relpath}.`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'whoami') {
      const homeEnv = process.env.FAKE_ACP_HOME_ENV;
      const home = homeEnv ? ` home=${process.env[homeEnv] ?? '(unset)'}` : '';
      await say(client, params.sessionId, `agent=${process.env.FAKE_ACP_AGENT_NAME ?? 'default'}${home}`);
      return { stopReason: 'end_turn' };
    }
    if (GROK && text === 'env') {
      const key = process.env.XAI_API_KEY;
      await say(client, params.sessionId, `GROK_FOLDER_TRUST=${process.env.GROK_FOLDER_TRUST ?? '(unset)'} GROK_DISABLE_AUTOUPDATER=${process.env.GROK_DISABLE_AUTOUPDATER ?? '(unset)'} key=${key ? key.slice(-4) : 'none'}`);
      return { stopReason: 'end_turn' };
    }
    if (GROK && text === 'meta') {
      await say(client, params.sessionId, `meta=${JSON.stringify(session.opened._meta ?? null)}`);
      return { stopReason: 'end_turn' };
    }
    if (GROK && text === 'skills') {
      // Its own folder trust skips project skills unless it is turned off (`GROK_FOLDER_TRUST=0`).
      const folder = join(session.opened.cwd ?? process.cwd(), '.claude', 'skills');
      const names = process.env.GROK_FOLDER_TRUST === '0' && existsSync(folder) ? readdirSync(folder).sort() : [];
      await say(client, params.sessionId, `skills=${names.join(',') || 'none'}`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'env') {
      await say(client, params.sessionId, `CLAUDE_CODE_EXECUTABLE=${process.env.CLAUDE_CODE_EXECUTABLE ?? '(unset)'}`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'echo-env') {
      const lines = Object.entries(process.env).map(([name, value]) => `${name}=${value ?? ''}\n`);
      process.stderr.write(lines.join(''));
      for (const line of lines) {
        const middle = Math.floor(line.length / 2);
        await say(client, params.sessionId, line.slice(0, middle));
        await say(client, params.sessionId, line.slice(middle));
      }
      return { stopReason: 'end_turn' };
    }
    if (text === 'session-start') {
      const { opened } = session;
      const reply = { via: session.via, cwd: opened.cwd, mcpServers: opened.mcpServers ?? null, meta: opened._meta ?? null, prompt: whole, env: { ...process.env } };
      await say(client, params.sessionId, JSON.stringify(reply));
      return { stopReason: 'end_turn' };
    }
    if (text === 'cancels') {
      await say(client, params.sessionId, `cancels=${session.cancels ?? 0}`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'pids') {
      await say(client, params.sessionId, `pid=${process.pid} grandchild=${grandchild?.pid ?? 'none'}`);
      return { stopReason: 'end_turn' };
    }
    /** Waits until `path` exists (false) or the turn is cancelled (true). */
    const waitForFile = (path) =>
      new Promise((resolve) => {
        const timer = setInterval(() => {
          if (!existsSync(path)) return;
          clearInterval(timer);
          session.cancel = undefined;
          resolve(false);
        }, 25);
        session.cancel = () => {
          clearInterval(timer);
          session.cancel = undefined;
          resolve(true);
        };
      });
    if (text.startsWith('permission-abandon ')) {
      const file = text.slice('permission-abandon '.length).trim();
      await say(client, params.sessionId, 'Working');
      if (await waitForFile(file)) return { stopReason: 'cancelled' };
      const toolCall = { toolCallId: 'call-abandon', title: 'Run npm test', kind: 'execute', rawInput: { command: 'npm test' } };
      await update(client, params.sessionId, { sessionUpdate: 'tool_call', ...toolCall, status: 'pending' });
      const withdraw = new AbortController();
      const asking = client.request(
        'session/request_permission',
        {
          sessionId: params.sessionId,
          toolCall,
          options: [
            { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
          ],
        },
        { cancellationSignal: withdraw.signal },
      );
      // The answer, whenever it comes, is not waited for (claude-agent-acp's local abort race).
      asking.catch(() => undefined);
      const cancelled = await waitForFile(`${file}.withdraw`);
      withdraw.abort();
      if (cancelled) return { stopReason: 'cancelled' };
      await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: toolCall.toolCallId, status: 'failed' });
      await say(client, params.sessionId, 'Gave up on npm test.');
      return { stopReason: 'end_turn' };
    }
    if (text.startsWith('wait ')) {
      const file = text.slice('wait '.length).trim();
      await say(client, params.sessionId, 'Waiting');
      const cancelled = await new Promise((resolve) => {
        const timer = setInterval(() => {
          if (!existsSync(file)) return;
          clearInterval(timer);
          resolve(false);
        }, 25);
        session.cancel = () => {
          clearInterval(timer);
          resolve(true);
        };
      });
      session.cancel = undefined;
      if (cancelled) return { stopReason: 'cancelled' };
      await say(client, params.sessionId, ', done.');
      return { stopReason: 'end_turn' };
    }
    if (text === 'hold') {
      await say(client, params.sessionId, 'Holding');
      await new Promise((resolve) => {
        session.cancel = () => resolve(undefined);
      });
      session.cancel = undefined;
      return { stopReason: 'cancelled' };
    }
    if (text === 'tools') {
      for (const name of ['a', 'b', 'c']) {
        const toolCallId = `call-read-${name}`;
        await update(client, params.sessionId, { sessionUpdate: 'tool_call', toolCallId, title: `Read src/${name}.ts`, kind: 'read', status: 'in_progress', locations: [{ path: `src/${name}.ts` }] });
        await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });
      }
      await update(client, params.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call-edit-a', title: 'Edit src/a.ts', kind: 'edit', status: 'in_progress' });
      await update(client, params.sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-edit-a',
        status: 'completed',
        content: [{ type: 'diff', path: 'src/a.ts', oldText: 'export const a = 1;\n', newText: 'export const a = 2;\n' }],
      });
      await say(client, params.sessionId, 'Changed src/a.ts.');
      return { stopReason: 'end_turn' };
    }
    if (text === 'quiet' || text === 'quiet-tool') {
      await say(client, params.sessionId, 'Starting');
      if (text === 'quiet-tool') {
        await update(client, params.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call-quiet', title: 'Run npm run build', kind: 'execute', status: 'in_progress' });
      }
      // Silence until cancelled: no timer, as a hung agent.
      await new Promise((resolve) => (session.cancel = () => resolve(undefined)));
      session.cancel = undefined;
      return { stopReason: 'cancelled' };
    }
    if (text === 'slow') {
      await say(client, params.sessionId, 'Thinking');
      const cancelled = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 10_000);
        session.cancel = () => {
          clearTimeout(timer);
          resolve(true);
        };
      });
      session.cancel = undefined;
      return { stopReason: cancelled ? 'cancelled' : 'end_turn' };
    }
    for (const chunk of ['Hello', ' from the', ' fake agent.']) {
      await say(client, params.sessionId, chunk);
      await sleep(CHUNK_DELAY_MS);
    }
    try {
      recordExchange(params.sessionId, text, 'Hello from the fake agent.');
    } catch {
      // The record is the test's to check; the chat answers either way (as the fake CLI does).
    }
    return { stopReason: 'end_turn' };
  }
}

agentBuilder
  .onNotification('session/cancel', ({ params }) => {
    const cancelled = sessions.get(params.sessionId);
    if (cancelled !== undefined) cancelled.cancels = (cancelled.cancels ?? 0) + 1;
    cancelled?.cancel?.();
  })
  .onRequest('session/close', ({ params }) => {
    sessions.delete(params.sessionId);
    return {};
  })
  .connect(stream);

// The client closing stdin ends the agent, as a real adapter does.
process.stdin.on('end', () => process.exit(0));
