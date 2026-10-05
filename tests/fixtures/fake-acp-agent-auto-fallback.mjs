#!/usr/bin/env node
// The fake ACP agent whose model lacks Auto (permission modes): it answers
// `session/set_mode auto`, then falls back to `acceptEdits` and reports it, as
// claude-agent-acp 0.84 does. The switch is set here because the server
// passes agents an allowlisted environment.
process.env.FAKE_ACP_AUTO_FALLBACK = '1';
await import('./fake-acp-agent.mjs');
