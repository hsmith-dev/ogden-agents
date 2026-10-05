#!/usr/bin/env node
// The fake ACP agent as Codex's `codex-acp` adapter (epic 12 entry 4, spike
// 12.1's shapes): its sign-in methods, the four session modes, resume, load
// and list, its permission options (two `reject_once`: `decline` and
// `cancel`), the mode a session starts in from `INITIAL_AGENT_MODE`, and no
// session before a sign-in method is chosen. The switches are set here
// because the server passes agents an allowlisted environment; a test's own
// (an adapter test's environment) win.
const defaults = {
  FAKE_ACP_PERSONALITY: 'codex',
  FAKE_ACP_MODES: 'read-only:Read-only,workspace-write:Workspace write,agent:Auto review,agent-full-access:Full access',
  FAKE_ACP_AUTH_METHODS: 'chat-gpt:Login with ChatGPT,api-key:Use CODEX_API_KEY',
  FAKE_ACP_API_KEY_ENV: 'CODEX_API_KEY',
  FAKE_ACP_HOME_ENV: 'CODEX_HOME',
  FAKE_ACP_RESUME: 'both',
  FAKE_ACP_REQUIRE_AUTH: '1',
  FAKE_ACP_REJECT_OPTIONS: 'decline:No continue without running it,cancel:No and tell Codex what to do differently',
  FAKE_ACP_AGENT_NAME: 'codex',
};
for (const [name, value] of Object.entries(defaults)) if (process.env[name] === undefined) process.env[name] = value;
await import('./fake-acp-agent.mjs');
