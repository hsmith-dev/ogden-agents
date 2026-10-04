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
//   "tools"        reads three files (src/a.ts, src/b.ts, src/c.ts), then edits
//                  src/a.ts with a diff; replies "Changed src/a.ts."
//   "quiet-tool"   one chunk and an `execute` tool call left in progress
//                  ("Run npm run build"), then silence until cancelled
//   "quiet"        one chunk, then silence until cancelled (no tool call)
//   "fail"         the prompt fails with a JSON-RPC internal error
//   "env"          replies with the CLAUDE_CODE_EXECUTABLE it was given
//   "echo-env"     replies with its whole environment, `NAME=value` per line,
//                  each value split across two chunks, and writes it to stderr
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
//   "plan-exit"    asks permission to leave plan mode with the real adapter's
//                  options (mode-raising ones as `allow_always`, "manually
//                  approve" as `allow_once`); replies `chose=<option id>`
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
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
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

/** The session modes it lists, as claude-agent-acp 0.84 lists them. */
const AVAILABLE_MODES = [
  { id: 'default', name: 'Manual', description: 'Always ask before making changes' },
  { id: 'acceptEdits', name: 'Accept edits', description: 'Automatically accept all file edits' },
  { id: 'plan', name: 'Plan', description: 'Create a plan before making changes' },
  ...(process.env.FAKE_ACP_NO_AUTO === '1' ? [] : [{ id: 'auto', name: 'Auto', description: 'Claude handles permission decisions' }]),
  ...(process.env.FAKE_ACP_NO_BYPASS === '1' ? [] : [{ id: 'bypassPermissions', name: 'Bypass permissions', description: 'Accepts all permissions' }]),
];
const START_MODE = process.env.FAKE_ACP_START_MODE ?? 'default';
/** Modes in which it edits files without asking (Claude Code's `acceptEdits`, `auto` and `bypassPermissions`). */
const EDITS_WITHOUT_ASKING = new Set(['acceptEdits', 'auto', 'bypassPermissions']);
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
/** The `modes` a session answer carries, for a session now in `currentModeId`. */
const modesOf = (currentModeId) => ({ currentModeId, availableModes: AVAILABLE_MODES });

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

acp
  .agent({ name: 'fake-acp-agent' })
  .onRequest('initialize', ({ params }) => {
    const terminalAuth = params.clientCapabilities?.auth?.terminal === true;
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: RESUME === 'load' || RESUME === 'both',
        sessionCapabilities: { close: {}, ...(RESUME === 'resume' || RESUME === 'both' ? { resume: {} } : {}) },
      },
      authMethods:
        process.env.FAKE_ACP_AUTH === 'terminal' && terminalAuth
          ? [{ type: 'terminal', id: 'fake-login', name: 'Log in with your account', description: 'Signs in with the fake agent', args: ['--login'], env: { FAKE_LOGIN: '1' } }]
          : process.env.FAKE_ACP_AUTH === 'claude-terminal' && terminalAuth
            ? [
                { type: 'terminal', id: 'claude-ai-login', name: 'Claude Subscription', description: 'Use Claude subscription ', args: ['--cli', 'auth', 'login', '--claudeai'] },
                { type: 'terminal', id: 'console-login', name: 'Anthropic Console', description: 'Use Anthropic Console (API usage billing)', args: ['--cli', 'auth', 'login', '--console'] },
              ]
            : [],
      agentInfo: { name: 'fake-acp-agent', version: '1.0.0' },
    };
  })
  .onRequest('session/new', ({ params }) => {
    const sessionId = `fake-session-${nextSession++}`;
    sessions.set(sessionId, { via: 'new', opened: params, mode: START_MODE });
    return { sessionId, modes: modesOf(START_MODE) };
  })
  .onRequest('session/resume', ({ params }) => {
    if (RESUME !== 'resume' && RESUME !== 'both') throw acp.RequestError.methodNotFound('session/resume');
    if (REOPEN_FAIL.has('resume-auth')) throw acp.RequestError.authRequired(undefined, 'the fake agent needs a new sign-in');
    if (REOPEN_FAIL.has('resume')) throw acp.RequestError.resourceNotFound(params.sessionId);
    sessions.set(params.sessionId, { via: 'resumed', opened: params, mode: START_MODE });
    return { modes: modesOf(START_MODE) };
  })
  .onRequest('session/load', async ({ params, client }) => {
    if (RESUME !== 'load' && RESUME !== 'both') throw acp.RequestError.methodNotFound('session/load');
    // The history a load replays: the client already has it.
    await say(client, params.sessionId, 'Earlier reply.');
    if (REOPEN_FAIL.has('load')) throw acp.RequestError.resourceNotFound(params.sessionId);
    sessions.set(params.sessionId, { via: 'loaded', opened: params, mode: START_MODE });
    return { modes: modesOf(START_MODE) };
  })
  .onRequest('session/set_mode', ({ params, client }) => {
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
  .onRequest('session/prompt', async ({ params, client }) => {
    const session = sessions.get(params.sessionId);
    if (session === undefined) throw acp.RequestError.invalidParams(undefined, `no session ${params.sessionId}`);
    const whole = params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('');
    const primedAt = whole.lastIndexOf(NEW_MESSAGE);
    const primer = primedAt === -1 ? '' : whole.slice(0, primedAt);
    const primed = primer.split('\n').filter((line) => line.startsWith('User: ') || line.startsWith('Claude Code: ')).length;
    const text = (primedAt === -1 ? whole : whole.slice(primedAt + NEW_MESSAGE.length)).trim();

    if (process.env.FAKE_ACP_REQUIRE_LOGIN && !loggedIn(process.env.FAKE_ACP_REQUIRE_LOGIN)) {
      throw acp.RequestError.authRequired(undefined, 'the fake agent needs a new sign-in');
    }
    if (process.env.FAKE_ACP_REQUIRE_API_KEY === '1') {
      if (!process.env.ANTHROPIC_API_KEY) throw acp.RequestError.authRequired(undefined, 'the fake agent needs an API key');
      await say(client, params.sessionId, `key received …${process.env.ANTHROPIC_API_KEY.slice(-4)}`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'crash') {
      await say(client, params.sessionId, 'About to ');
      await sleep(CHUNK_DELAY_MS);
      process.exit(1);
    }
    if (text === 'fail') throw acp.RequestError.internalError(undefined, 'the fake agent failed on purpose');
    if (text === 'auth-expired') throw acp.RequestError.authRequired(undefined, 'the fake agent needs a new sign-in');
    if (text.startsWith('/')) {
      await say(client, params.sessionId, `command=${text} primed=${primed}`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'mode') {
      await say(client, params.sessionId, `mode=${session.mode}`);
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
    if (text === 'permission' || text.startsWith('permission ') || text.startsWith('permission-safety ')) {
      const safety = text.startsWith('permission-safety ');
      const command = text === 'permission' ? 'npm test' : text.slice(safety ? 'permission-safety '.length : 'permission '.length).trim();
      const toolCall = { toolCallId: 'call-permission', title: `Run ${command}`, kind: 'execute', rawInput: { command } };
      await update(client, params.sessionId, { sessionUpdate: 'tool_call', ...toolCall, status: 'pending' });
      // Skipping permission checks (`bypassPermissions`) runs it without asking, unless it is one of its own safety checks.
      if (process.env.FAKE_ACP_SKIP_PERMISSION === '1' || (session.mode === 'bypassPermissions' && !safety)) {
        await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: toolCall.toolCallId, status: 'completed' });
        await say(client, params.sessionId, `Ran ${command}.`);
        return { stopReason: 'end_turn' };
      }
      const answer = await client.request('session/request_permission', {
        sessionId: params.sessionId,
        toolCall,
        options: [
          { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
          { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
          { optionId: 'never', name: 'Always deny', kind: 'reject_always' },
        ],
      });
      const ran = answer.outcome.outcome === 'selected' && (answer.outcome.optionId === 'allow' || answer.outcome.optionId === 'always');
      await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: toolCall.toolCallId, status: ran ? 'completed' : 'failed' });
      await say(client, params.sessionId, ran ? `Ran ${command}.` : `Denied ${command}.`);
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
    if (text === 'pids') {
      await say(client, params.sessionId, `pid=${process.pid} grandchild=${grandchild?.pid ?? 'none'}`);
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
  })
  .onNotification('session/cancel', ({ params }) => {
    sessions.get(params.sessionId)?.cancel?.();
  })
  .onRequest('session/close', ({ params }) => {
    sessions.delete(params.sessionId);
    return {};
  })
  .connect(stream);

// The client closing stdin ends the agent, as a real adapter does.
process.stdin.on('end', () => process.exit(0));
