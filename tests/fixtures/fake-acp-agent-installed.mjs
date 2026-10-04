#!/usr/bin/env node
// The fake ACP agent as the installed-package suite runs it (story 2.13):
// the installed server finds it through OGDEN_AGENTS_CLAUDE_ACP_PATH, and
// gives agents only an allowlisted environment, so the fake's switches are
// set here instead. `resume` lets a chat reopened after a restart report
// `via=resumed`.
import { fileURLToPath } from 'node:url';

process.env.FAKE_ACP_RESUME = 'resume';
// Claude Code (the fake) is signed in (its `--cli auth status` reads this), unless a wrapper set another state:
// a new chat with a signed-out agent is refused (epic 6, 6.3).
process.env.FAKE_LOGIN_STATE ??= fileURLToPath(new URL('./fake-login-signed-in.json', import.meta.url));
await import('./fake-acp-agent.mjs');
