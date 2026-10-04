#!/usr/bin/env node
// The fake ACP agent with a session that starts in `bypassPermissions`, as a
// user's or project's Claude settings (`permissions.defaultMode`) would start
// it (permission modes): core must put it in Ask before its first prompt. The
// switch is set here because the server passes agents an allowlisted
// environment.
process.env.FAKE_ACP_START_MODE = 'bypassPermissions';
await import('./fake-acp-agent.mjs');
