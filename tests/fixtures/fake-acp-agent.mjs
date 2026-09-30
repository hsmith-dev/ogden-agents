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
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

if (process.env.FAKE_ACP_EXIT_AT_START === '1') process.exit(3);

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
          : [],
      agentInfo: { name: 'fake-acp-agent', version: '1.0.0' },
    };
  })
  .onRequest('session/new', () => {
    const sessionId = `fake-session-${nextSession++}`;
    sessions.set(sessionId, { via: 'new' });
    return { sessionId };
  })
  .onRequest('session/resume', ({ params }) => {
    if (RESUME !== 'resume' && RESUME !== 'both') throw acp.RequestError.methodNotFound('session/resume');
    if (REOPEN_FAIL.has('resume-auth')) throw acp.RequestError.authRequired(undefined, 'the fake agent needs a new sign-in');
    if (REOPEN_FAIL.has('resume')) throw acp.RequestError.resourceNotFound(params.sessionId);
    sessions.set(params.sessionId, { via: 'resumed' });
    return {};
  })
  .onRequest('session/load', async ({ params, client }) => {
    if (RESUME !== 'load' && RESUME !== 'both') throw acp.RequestError.methodNotFound('session/load');
    // The history a load replays: the client already has it.
    await say(client, params.sessionId, 'Earlier reply.');
    if (REOPEN_FAIL.has('load')) throw acp.RequestError.resourceNotFound(params.sessionId);
    sessions.set(params.sessionId, { via: 'loaded' });
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
    if (text === 'context') {
      await say(client, params.sessionId, `session=${params.sessionId} via=${session.via} primed=${primed}`);
      return { stopReason: 'end_turn' };
    }
    if (text.startsWith('permission-edit ')) {
      const paths = text.slice('permission-edit '.length).split('|').map((path) => path.trim()).filter((path) => path !== '');
      const toolCall = { toolCallId: 'call-edit-permission', title: `Edit ${paths.join(', ')}`, kind: 'edit', locations: paths.map((path) => ({ path })) };
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
      const edited = answer.outcome.outcome === 'selected' && (answer.outcome.optionId === 'allow' || answer.outcome.optionId === 'always');
      await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: toolCall.toolCallId, status: edited ? 'completed' : 'failed' });
      await say(client, params.sessionId, `${edited ? 'Edited' : 'Denied'} ${paths.join(', ')}.`);
      return { stopReason: 'end_turn' };
    }
    if (text === 'permission' || text.startsWith('permission ')) {
      const command = text === 'permission' ? 'npm test' : text.slice('permission '.length).trim();
      const toolCall = { toolCallId: 'call-permission', title: `Run ${command}`, kind: 'execute', rawInput: { command } };
      await update(client, params.sessionId, { sessionUpdate: 'tool_call', ...toolCall, status: 'pending' });
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
    if (text === 'pids') {
      await say(client, params.sessionId, `pid=${process.pid} grandchild=${grandchild?.pid ?? 'none'}`);
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
