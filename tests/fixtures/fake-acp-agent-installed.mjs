#!/usr/bin/env node
// The fake ACP agent as the installed-package suite runs it (story 2.13):
// the installed server finds it through OGDEN_AGENTS_CLAUDE_ACP_PATH, and
// gives agents only an allowlisted environment, so the fake's switches are
// set here instead. `resume` lets a chat reopened after a restart report
// `via=resumed`.
process.env.FAKE_ACP_RESUME = 'resume';
await import('./fake-acp-agent.mjs');
