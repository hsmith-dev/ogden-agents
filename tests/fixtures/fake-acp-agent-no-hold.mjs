#!/usr/bin/env node
// The installed-package suite's fake agent, but one that runs a command
// without asking for permission (FAKE_ACP_SKIP_PERMISSION): the hold proof's
// agent (story 2.13, `tests/e2e-installed/hold-proof.spec.ts`). The switch is
// set here because the server passes agents an allowlisted environment.
process.env.FAKE_ACP_SKIP_PERMISSION = '1';
await import('./fake-acp-agent-installed.mjs');
