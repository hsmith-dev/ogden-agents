#!/usr/bin/env node
// A fake coding agent that speaks real ACP over stdio (story 2.2), for CI and
// the tests: it is what `acp-claude-code` spawns in place of the Claude Agent
// ACP adapter, so the whole path (REST, core, AgentPort, the adapter, ACP)
// runs without a real agent or account.
//
//   node fake-acp-agent.mjs
//
// It answers `initialize`, `session/new`, `session/prompt` (streaming its
// reply as `agent_message_chunk` updates, then `end_turn`), `session/cancel`
// and `session/close`. The prompt text picks the behavior:
//
//   anything else  "Hello from the fake agent." in three chunks
//   "crash"        one chunk, then the process exits with code 1 mid-prompt
//   "slow"         one chunk, then waits until cancelled (`cancelled`) or 10 s
//   "fail"         the prompt fails with a JSON-RPC internal error
//   "env"          replies with the CLAUDE_CODE_EXECUTABLE it was given
//   "echo-env"     replies with its whole environment, `NAME=value` per line,
//                  each value split across two chunks, and writes it to stderr
//   "pids"         replies `pid=<its pid> grandchild=<pid or none>`
//
// With FAKE_ACP_EXIT_AT_START=1 it exits before answering anything. With
// FAKE_ACP_SPAWN_GRANDCHILD=1 it starts a long-lived child of its own (as the
// real adapter starts `claude`), which it never stops.
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

/** @type {Map<string, { cancel?: () => void }>} */
const sessions = new Map();
let nextSession = 1;

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
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false, sessionCapabilities: { close: {} } },
    agentInfo: { name: 'fake-acp-agent', version: '1.0.0' },
  }))
  .onRequest('session/new', () => {
    const sessionId = `fake-session-${nextSession++}`;
    sessions.set(sessionId, {});
    return { sessionId };
  })
  .onRequest('session/prompt', async ({ params, client }) => {
    const session = sessions.get(params.sessionId);
    if (session === undefined) throw acp.RequestError.invalidParams(undefined, `no session ${params.sessionId}`);
    const text = params.prompt
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();

    if (text === 'crash') {
      await say(client, params.sessionId, 'About to ');
      await sleep(CHUNK_DELAY_MS);
      process.exit(1);
    }
    if (text === 'fail') throw acp.RequestError.internalError(undefined, 'the fake agent failed on purpose');
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
