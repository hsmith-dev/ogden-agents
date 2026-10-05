#!/usr/bin/env node
// The fake ACP agent as Antigravity's ACP server (epic 6 entry 5, spike 6.1's
// shapes): its agent info, sign-in methods, session modes (`default`,
// `auto_edit`, `yolo`), resume, load and list, its permission options and
// workspace-trust question, and no session before a sign-in method is chosen.
// The switches are set here because the server passes agents an allowlisted
// environment; a test's own (an adapter test's environment) win. Started as
// `agy_acp_server.par` is on Linux, it is given `--uid=`, which it ignores.
const defaults = {
  FAKE_ACP_PERSONALITY: 'antigravity',
  FAKE_ACP_MODES: 'default:Default,auto_edit:Auto Edit,yolo:YOLO',
  FAKE_ACP_AUTH_METHODS: 'oauth-personal:Log in with Google,oauth-business:Log in with Google (business),gemini-api-key:Use Gemini API key,agent-platform:Agent Platform',
  FAKE_ACP_API_KEY_ENV: 'GEMINI_API_KEY',
  FAKE_ACP_HOME_ENV: 'GEMINI_HOME',
  FAKE_ACP_RESUME: 'both',
  FAKE_ACP_REQUIRE_AUTH: '1',
  FAKE_ACP_AGENT_NAME: 'antigravity',
};
for (const [name, value] of Object.entries(defaults)) if (process.env[name] === undefined) process.env[name] = value;
await import('./fake-acp-agent.mjs');
