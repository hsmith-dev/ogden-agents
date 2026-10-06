#!/usr/bin/env node
// A fake `claude` CLI login (story 9.1), for CI and the tests: what the fake
// ACP agent runs for `--cli …`, as the real adapter runs `claude`. It never
// touches a real account.
//
//   node fake-claude-login.mjs auth login --claudeai
//   node fake-claude-login.mjs auth status --json
//
// `auth login` starts a localhost callback server, prints (with colors) the
// real CLI's lines, "If the browser didn't open, visit: <OSC 8 link>" and
// "Paste code here if prompted > ", then waits. A GET of `/callback` on that
// server writes the signed-in state file, answers "Login successful.", prints
// it, and exits 0. The URL is `https://claude.ai/oauth/authorize?…` with the
// callback in its `redirect_uri` (the browser tests route it there).
//
// FAKE_LOGIN_MODE picks another behavior:
//   fail        prints the URL, then exits 1
//   notsigned   prints the URL, then exits 0 without signing in
//   hang        prints the URL and waits forever (cancel, timeouts)
//   nourl       prints a line with no URL and waits forever
//   code        prints the URL, then completes only when FAKE_LOGIN_CODE
//               (default `fake-code-123`) arrives on stdin, as a line
//
// FAKE_LOGIN_STATE is the state file `auth status --json` reads
// (`{"loggedIn":true}` once signed in); without it nobody is signed in.
// FAKE_LOGIN_PID_FILE, when set, gets this process's pid (tree-kill tests).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const MODE = process.env.FAKE_LOGIN_MODE ?? '';
const STATE = process.env.FAKE_LOGIN_STATE;
const CODE = process.env.FAKE_LOGIN_CODE ?? 'fake-code-123';
const ESC = '\u001b';

if (process.env.FAKE_LOGIN_PID_FILE) {
  // Whole file or none (see fake-uv.mjs): a polling test never reads it half-written.
  writeFileSync(`${process.env.FAKE_LOGIN_PID_FILE}.tmp`, String(process.pid));
  renameSync(`${process.env.FAKE_LOGIN_PID_FILE}.tmp`, process.env.FAKE_LOGIN_PID_FILE);
}

const signedIn = () => {
  if (STATE === undefined || !existsSync(STATE)) return false;
  try {
    return JSON.parse(readFileSync(STATE, 'utf8')).loggedIn === true;
  } catch {
    return false;
  }
};

const signIn = () => {
  if (STATE !== undefined) writeFileSync(STATE, JSON.stringify({ loggedIn: true }));
};

const forever = () => setInterval(() => {}, 60_000);

if (args[0] === 'auth' && args[1] === 'status') {
  const loggedIn = signedIn();
  process.stdout.write(`${JSON.stringify({ loggedIn, authMethod: loggedIn ? 'claude.ai' : 'none' })}\n`);
  process.exit(loggedIn ? 0 : 1);
} else if (args[0] === 'auth' && args[1] === 'login') {
  const server = createServer((req, res) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    signIn();
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Signed in</title><p>Login successful.</p>');
    process.stdout.write('\r\nLogin successful.\r\n');
    setTimeout(() => process.exit(0), 50);
  });
  server.on('error', () => process.exit(2));
  server.listen(0, '127.0.0.1', () => {
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    const callback = `http://localhost:${port}/callback`;
    const url = `https://claude.ai/oauth/authorize?code=true&client_id=fake&response_type=code&redirect_uri=${encodeURIComponent(callback)}&state=fake-state`;
    process.stdout.write(`${ESC}[1mClaude Code${ESC}[0m ${ESC}[2mopening your browser to sign in...${ESC}[0m\r\n`);
    if (MODE === 'nourl') {
      process.stdout.write('Something went wrong before a link was ready.\r\n');
      forever();
      return;
    }
    process.stdout.write(`If the browser didn't open, visit: ${ESC}]8;;${url}${ESC}\\${url}${ESC}]8;;${ESC}\\\r\n`);
    process.stdout.write(`${ESC}[36mPaste code here if prompted > ${ESC}[0m`);
    if (MODE === 'fail') setTimeout(() => process.exit(1), 100);
    else if (MODE === 'notsigned') setTimeout(() => process.exit(0), 100);
    else if (MODE === 'code') {
      let typed = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        typed += chunk;
        const lines = typed.split(/\r\n|\r|\n/);
        typed = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim() === CODE) {
            signIn();
            process.stdout.write('\r\nLogin successful.\r\n');
            setTimeout(() => process.exit(0), 50);
          } else {
            process.stdout.write('\r\nThat code is not valid. Paste code here if prompted > ');
          }
        }
      });
    }
    // `hang` and the default wait for the callback (or a kill).
  });
} else {
  process.stderr.write(`fake-claude-login: unknown arguments ${args.join(' ')}\n`);
  process.exit(64);
}
