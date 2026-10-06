#!/usr/bin/env node
// The fake ACP agent as the Local model's OpenCode (`opencode acp`, epic 14 story
// 14.2, spike 14.1's shapes), for CI and the tests: the whole path (REST, core,
// AgentPort, the adapter, ACP, the generated config, the environment) runs
// without the real harness. Unlike the other personalities it really talks to an
// OpenAI-compatible server (the fake one in `fake-openai-server.mjs`), as the
// harness does, so what Ogden wrote into the config and the environment is what
// reaches the endpoint.
//
// What it takes from its environment, as OpenCode does:
//   OPENCODE_CONFIG   the generated config: `provider.ogden.options.baseURL`,
//                     `apiKey` (a literal key, or `{env:NAME}` read from its environment),
//                     `provider.ogden.models`, `model` (`ogden/<id>`)
//   XDG_DATA_HOME     where its session store lives (`opencode/fake-sessions.json`,
//                     standing in for `opencode.db`), so a session resumes across processes
//   HOME              an empty folder: `~/.claude/skills` and `~/.agents/skills` are read from it
//
// What it speaks (spike 14.1): `initialize` (OpenCode 1.18.34, `loadSession`, session
// capabilities close, fork, list and resume, one auth method `opencode-login` that is
// never needed); `session/new` with `configOptions` `model` (`ogden/<id>`, every model of
// the config) and `mode` (`build`, `plan`), and no `modes`; `session/set_config_option`;
// `session/list`; `session/resume` and `session/load` (an unknown id answers -32603
// "OpenCode service failure"); `session/prompt` as a streamed chat completion with one
// `bash` tool; `session/cancel`; `session/close`. A shell command arrives as a permission
// request with options `allow_once:once`, `allow_always:always`, `reject_once:reject`;
// an allowed one "runs" (never really: the result is `ran(<option id>): <command>`), a rejected one
// answers "The user rejected permission to use this specific tool call."
//
// The prompt text picks the behavior beyond a plain chat (the fake model's own rules,
// `fake-openai-server.mjs`, still apply: "run echo hi" asks for a command):
//   "env-report"   replies one JSON line: which of the network switches and folders it was
//                  started with (names and the values that are paths or `1`), whether a key
//                  reached it (never the key), and its cwd
//   "config-report"  replies the config it read, as JSON (it holds no key)
//   "skills"       replies the skill folders it can see, `<scope>:<name>` comma separated
//   "session-start"  replies `via=<new|resumed|loaded> cwd=<cwd> meta=<_meta or none>`
//   "crash"        exits with code 1
// Errors map as the harness's do: a server that can't be reached is an internal error
// "Cannot connect to API: Unable to connect. Is the computer able to access the url?"
// (after FAKE_OPENCODE_CONNECT_DELAY_MS, default 0: the real one takes 63 to 66 s), any
// other server error its own message, a context error "Session too large to compact -
// context exceeds model limit".
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';

if (process.env.FAKE_OPENCODE_EXIT_AT_START === '1') process.exit(3);

const acp = await import('@agentclientprotocol/sdk');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SWITCHES = [
  'OPENCODE_DISABLE_AUTOUPDATE',
  'OPENCODE_DISABLE_MODELS_FETCH',
  'OPENCODE_DISABLE_SHARE',
  'OPENCODE_DISABLE_LSP_DOWNLOAD',
  'OPENCODE_DISABLE_DEFAULT_PLUGINS',
  'OPENCODE_DISABLE_PROJECT_CONFIG',
  'OPENCODE_DISABLE_CLAUDE_CODE_SKILLS',
  'OPENCODE_PURE',
  'NPM_CONFIG_REGISTRY',
];
const FOLDERS = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME'];

/** The generated config this process was started with. */
function readConfig() {
  const file = process.env.OPENCODE_CONFIG;
  if (!file || !existsSync(file)) throw acp.RequestError.internalError(undefined, 'OpenCode service failure');
  return JSON.parse(readFileSync(file, 'utf8'));
}
const providerOf = (config) => config.provider?.ogden;
/** `{env:NAME}` as OpenCode reads it, else the literal. */
const keyOf = (provider) => {
  const raw = provider?.options?.apiKey;
  if (typeof raw !== 'string') return undefined;
  const ref = /^\{env:([A-Za-z0-9_]+)\}$/.exec(raw);
  return ref === null ? raw : process.env[ref[1]];
};

/** The session store: standing in for `opencode.db`. */
const storeFile = () => join(process.env.XDG_DATA_HOME ?? process.cwd(), 'opencode', 'fake-sessions.json');
const readStore = () => {
  try {
    return JSON.parse(readFileSync(storeFile(), 'utf8'));
  } catch {
    return {};
  }
};
const writeStore = (store) => {
  mkdirSync(dirname(storeFile()), { recursive: true });
  const temp = `${storeFile()}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(store));
  renameSync(temp, storeFile());
};

const sessions = new Map();
let next = 1;
const newId = () => `ses_fake${Date.now().toString(36)}${next++}`;

const modelOption = (config, session) => {
  const models = providerOf(config)?.models ?? {};
  return {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: session.model,
    options: Object.entries(models).map(([id, model]) => ({ value: `ogden/${id}`, name: model.name ?? id })),
  };
};
const configOptions = (config, session) => [
  modelOption(config, session),
  { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'build', options: [{ value: 'build', name: 'build' }, { value: 'plan', name: 'plan' }] },
];

const say = (client, sessionId, text) =>
  client.notify('session/update', { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });
const update = (client, sessionId, body) => client.notify('session/update', { sessionId, update: body });

/** The skill folders it can see, as `<scope>:<name>`. */
function skillsSeen(cwd) {
  const out = [];
  const read = (scope, dir) => {
    try {
      for (const name of readdirSync(dir)) out.push(`${scope}:${name}`);
    } catch {
      // No such folder.
    }
  };
  read('project-agents', join(cwd, '.agents', 'skills'));
  if (process.env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS !== '1') read('project-claude', join(cwd, '.claude', 'skills'));
  const home = process.env.HOME;
  if (home) {
    read('home-agents', join(home, '.agents', 'skills'));
    if (process.env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS !== '1') read('home-claude', join(home, '.claude', 'skills'));
  }
  return out;
}

const errorFor = (status, body) => {
  let message = '';
  try {
    message = JSON.parse(body)?.error?.message ?? '';
  } catch {
    message = '';
  }
  if (/context length|context_length/i.test(message)) return 'Session too large to compact - context exceeds model limit';
  return message || `HTTP ${status}`;
};

/** One streamed chat completion; returns `{ text, calls }` and says the text as it arrives. */
async function complete({ client, sessionId, session, config, signal }) {
  const provider = providerOf(config);
  const key = keyOf(provider);
  const model = session.model.replace(/^ogden\//, '');
  const delay = Number(process.env.FAKE_OPENCODE_CONNECT_DELAY_MS ?? '0');
  let response;
  try {
    response = await fetch(`${provider.options.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model,
        stream: true,
        tool_choice: 'auto',
        messages: [{ role: 'system', content: 'You are the fake OpenCode.' }, ...session.messages],
        tools: [{ type: 'function', function: { name: 'bash', description: 'Run a shell command', parameters: { type: 'object', properties: { command: { type: 'string' }, description: { type: 'string' } }, required: ['command'] } } }],
      }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    if (delay > 0) await sleep(delay);
    throw acp.RequestError.internalError(undefined, 'Cannot connect to API: Unable to connect. Is the computer able to access the url?');
  }
  if (!response.ok) throw acp.RequestError.internalError(undefined, errorFor(response.status, await response.text()));
  let text = '';
  const calls = new Map();
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let at;
    while ((at = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      if (!event.startsWith('data: ') || event === 'data: [DONE]') continue;
      const delta = JSON.parse(event.slice(6)).choices?.[0]?.delta;
      if (delta?.content) {
        text += delta.content;
        await say(client, sessionId, delta.content);
      }
      for (const call of delta?.tool_calls ?? []) {
        const known = calls.get(call.index) ?? { id: call.id, name: '', args: '' };
        if (call.id) known.id = call.id;
        if (call.function?.name) known.name = call.function.name;
        known.args += call.function?.arguments ?? '';
        calls.set(call.index, known);
      }
    }
  }
  return { text, calls: [...calls.values()] };
}

async function runPrompt(params, client, session) {
  const config = readConfig();
  const text = params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('').trim();
  const sessionId = params.sessionId;
  if (text === 'crash') process.exit(1);
  if (text === 'env-report') {
    const report = {
      switches: Object.fromEntries(SWITCHES.map((name) => [name, process.env[name] ?? null])),
      folders: Object.fromEntries(FOLDERS.map((name) => [name, process.env[name] ?? null])),
      config: process.env.OPENCODE_CONFIG ?? null,
      key: process.env.OGDEN_ENDPOINT_KEY === undefined ? 'absent' : 'present',
      cwd: session.cwd,
    };
    await say(client, sessionId, JSON.stringify(report));
    return { stopReason: 'end_turn' };
  }
  if (text === 'config-report') {
    await say(client, sessionId, JSON.stringify(config));
    return { stopReason: 'end_turn' };
  }
  if (text === 'skills') {
    await say(client, sessionId, `skills=${skillsSeen(session.cwd).join(',')}`);
    return { stopReason: 'end_turn' };
  }
  if (text === 'session-start') {
    await say(client, sessionId, `via=${session.via} cwd=${session.cwd} meta=${session.opened?._meta === undefined ? 'none' : JSON.stringify(session.opened._meta)}`);
    return { stopReason: 'end_turn' };
  }
  if (text.startsWith('/')) {
    await say(client, sessionId, `command=${text} skills=${skillsSeen(session.cwd).length}`);
    return { stopReason: 'end_turn' };
  }
  const controller = new AbortController();
  session.cancel = () => controller.abort();
  try {
    session.messages.push({ role: 'user', content: text });
    for (let round = 0; round < 5; round++) {
      const { text: reply, calls } = await complete({ client, sessionId, session, config, signal: controller.signal });
      if (calls.length === 0) {
        session.messages.push({ role: 'assistant', content: reply });
        persist(sessionId, session);
        return { stopReason: 'end_turn' };
      }
      session.messages.push({ role: 'assistant', content: reply || null, tool_calls: calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.args } })) });
      for (const call of calls) {
        let args = {};
        try {
          args = JSON.parse(call.args);
        } catch {
          session.messages.push({ role: 'tool', tool_call_id: call.id, content: 'The arguments provided to the tool are invalid' });
          continue;
        }
        const toolCall = { toolCallId: call.id, title: 'bash', kind: 'execute', rawInput: args };
        await update(client, sessionId, { sessionUpdate: 'tool_call', ...toolCall, status: 'pending' });
        const answer = await client.request('session/request_permission', {
          sessionId,
          toolCall,
          options: [
            { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'always', name: 'Allow always', kind: 'allow_always' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
        });
        const allowed = answer.outcome.outcome === 'selected' && (answer.outcome.optionId === 'once' || answer.outcome.optionId === 'always');
        await update(client, sessionId, { sessionUpdate: 'tool_call_update', toolCallId: call.id, status: allowed ? 'completed' : 'failed' });
        session.messages.push({ role: 'tool', tool_call_id: call.id, content: allowed ? `ran(${answer.outcome.optionId}): ${args.command}` : 'The user rejected permission to use this specific tool call.' });
      }
    }
    return { stopReason: 'end_turn' };
  } catch (error) {
    if (controller.signal.aborted) return { stopReason: 'cancelled' };
    throw error;
  } finally {
    session.cancel = undefined;
  }
}

function persist(id, session) {
  const store = readStore();
  store[id] = { cwd: session.cwd, model: session.model, messages: session.messages, updatedAt: Date.now() };
  writeStore(store);
}

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
acp
  .agent({ name: 'fake-opencode' })
  .onRequest('initialize', async () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: true,
      mcpCapabilities: { http: true, sse: true },
      promptCapabilities: { embeddedContext: true, image: true },
      sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} },
    },
    authMethods: [{ id: 'opencode-login', name: 'Login with opencode', description: 'Run `opencode auth login` in the terminal' }],
    agentInfo: { name: 'OpenCode', version: '1.18.34' },
  }))
  .onRequest('session/new', ({ params }) => {
    const config = readConfig();
    const sessionId = newId();
    const session = { via: 'new', opened: params, cwd: params.cwd, model: config.model, messages: [] };
    sessions.set(sessionId, session);
    persist(sessionId, session);
    return { sessionId, configOptions: configOptions(config, session) };
  })
  .onRequest('session/resume', ({ params }) => {
    const config = readConfig();
    const stored = readStore()[params.sessionId];
    if (stored === undefined) throw acp.RequestError.internalError(undefined, 'OpenCode service failure');
    const session = { via: 'resumed', opened: params, cwd: params.cwd, model: stored.model ?? config.model, messages: stored.messages };
    sessions.set(params.sessionId, session);
    return { configOptions: configOptions(config, session) };
  })
  .onRequest('session/load', async ({ params, client }) => {
    const config = readConfig();
    const stored = readStore()[params.sessionId];
    if (stored === undefined) throw acp.RequestError.internalError(undefined, 'OpenCode service failure');
    for (const message of stored.messages) if (message.role === 'assistant' && typeof message.content === 'string') await say(client, params.sessionId, message.content);
    const session = { via: 'loaded', opened: params, cwd: params.cwd, model: stored.model ?? config.model, messages: stored.messages };
    sessions.set(params.sessionId, session);
    return { configOptions: configOptions(config, session) };
  })
  .onRequest('session/list', () => ({
    sessions: Object.entries(readStore()).map(([sessionId, stored]) => ({ sessionId, cwd: stored.cwd, title: 'Fake session', updatedAt: new Date(stored.updatedAt).toISOString() })),
  }))
  .onRequest('session/set_config_option', ({ params }) => {
    const session = sessions.get(params.sessionId);
    if (session === undefined) throw acp.RequestError.invalidParams(undefined, `no session ${params.sessionId}`);
    const config = readConfig();
    if (params.configId === 'model') {
      if (!(providerOf(config)?.models ?? {})[String(params.value).replace(/^ogden\//, '')]) throw new Error(`Invalid value for config option model: ${params.value}`);
      session.model = params.value;
    }
    return { configOptions: configOptions(config, session) };
  })
  .onRequest('session/prompt', async ({ params, client }) => {
    const session = sessions.get(params.sessionId);
    if (session === undefined) throw acp.RequestError.invalidParams(undefined, `no session ${params.sessionId}`);
    return runPrompt(params, client, session);
  })
  .onNotification('session/cancel', ({ params }) => sessions.get(params.sessionId)?.cancel?.())
  .onRequest('session/close', ({ params }) => {
    sessions.delete(params.sessionId);
    return {};
  })
  .connect(stream);

// The client closing stdin ends the agent, as the real one does.
process.stdin.on('end', () => process.exit(0));
