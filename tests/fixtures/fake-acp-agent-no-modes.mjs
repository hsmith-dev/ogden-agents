#!/usr/bin/env node
// The fake ACP agent with sessions that list neither `auto` nor
// `bypassPermissions` (permission modes: a session that doesn't offer Auto
// or Skip all, as one run as root outside a sandbox doesn't offer bypass).
// The switches are set here because the server passes agents an allowlisted
// environment.
process.env.FAKE_ACP_NO_AUTO = '1';
process.env.FAKE_ACP_NO_BYPASS = '1';
await import('./fake-acp-agent.mjs');
