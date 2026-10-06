#!/usr/bin/env node
// The installed suite's fake agent for a build that hits the agent's usage limit (epic 17, story 17.11): the
// installed server gives agents only an allowlisted environment, so the fake's switches are set here. The build's
// prompt fails with Claude Code's own usage limit words, as the real agent's error would read.
process.env.FAKE_ACP_BUILD_FAIL = 'usage';
process.env.FAKE_ACP_BUILD_FAIL_TEXT = 'Claude usage limit reached';
await import('./fake-acp-agent-installed.mjs');
