#!/usr/bin/env node
// The fake ACP agent as Grok's `grok agent stdio` (epic 12 entry 4, spike 12.2's
// shapes): only `grok.com` advertised (an account sign in it never does),
// `xai.api_key` accepted unadvertised, `session/list`, resume, load and close,
// no session modes (the mode is in the `_meta` of a session's opening request:
// `yoloMode`, `autoMode`), and no session before `authenticate`. The switches
// are set here because the server passes agents an allowlisted environment; a
// test's own (an adapter test's environment) win.
const defaults = {
  FAKE_ACP_PERSONALITY: 'grok',
  FAKE_ACP_FIXED_MODE: '1',
  FAKE_ACP_AUTH_METHODS: 'grok.com:Grok',
  FAKE_ACP_API_KEY_ENV: 'XAI_API_KEY',
  FAKE_ACP_HOME_ENV: 'GROK_HOME',
  FAKE_ACP_RESUME: 'both',
  FAKE_ACP_REQUIRE_AUTH: '1',
  FAKE_ACP_AGENT_NAME: 'grok',
};
for (const [name, value] of Object.entries(defaults)) if (process.env[name] === undefined) process.env[name] = value;
await import('./fake-acp-agent.mjs');
