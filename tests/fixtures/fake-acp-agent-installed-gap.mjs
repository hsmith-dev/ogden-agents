#!/usr/bin/env node
// The installed suite's fake agent for a build that halts on an intent gap (story 11.6): the
// installed server gives agents only an allowlisted environment, so the fake's switches are set here.
// The build saves a patch beside the plan and blocks the plan with an `intent gap` reason.
process.env.FAKE_ACP_BUILD_HALT = 'intent gap: what should the page say?';
await import('./fake-acp-agent-installed.mjs');
