#!/usr/bin/env node
// A fake shell for the terminal pane tests (epic 16): what a pane runs in
// place of the user's own shell (OGDEN_AGENTS_TEST_PANE_SHELL, or the
// `paneShell` start option), so no test opens a real shell or a real CLI.
//
//   node fake-pane-shell.mjs
//
// It prints `fake-shell-ready` and a `fs>` prompt, then answers each line:
//
//   exit [n]    exits with code n (default 0)
//   size        prints `size=<cols>x<rows>`
//   alt         paints a full-screen picture on the alternate screen, once, and prints no prompt (a replay probe)
//   args        prints `args=<its arguments as JSON>` (what the launcher passed)
//   pid         prints `pid=<pid>`
//   cwd         prints `cwd=<folder>`
//   secret      prints `secret=<value>` for each variable whose name contains KEY, TOKEN, SECRET, PASSWORD or SSH_AUTH_SOCK (should print none)
//   anything    prints `echo:<line>`
//
// Raw input, echoed itself (as the real CLIs do, and as ConPTY needs). Each
// token has no spaces, since ConPTY repaints the screen: tests match tokens
// with escape sequences stripped. A pane's environment is the allowlist, so
// its switches are arguments (the `paneShell` start option):
//   --record <file>   writes (whole, then renamed) its cwd, pid, TERM, COLORTERM and the NAMES of its environment
//   --grandchild      first starts a child that ignores SIGHUP; its pid is in the record's `grandchild`
//   --silent          prints nothing until a line is typed (a program that starts slowly)
import { spawn } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';

const flags = process.argv.slice(2);
// As a stand-in for an agent's own CLI (epic 16, story 16.5): `--version` answers and exits, as a real CLI does for detection.
if (flags.includes('--version')) {
  process.stdout.write('fake-cli 1.2.3\n');
  process.exit(0);
}
const flagValue = (name) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);
const recordFile = flagValue('--record');
let grandchild = null;
if (flags.includes('--grandchild')) {
  const child = spawn(process.execPath, ['-e', "process.on('SIGHUP', () => {}); process.stdout.write('up'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  child.on('error', () => {});
  grandchild = child.pid ?? null;
  await new Promise((resolve) => {
    child.stdout.once('data', resolve);
    child.once('exit', resolve);
    child.once('error', resolve);
  });
  child.stdout.destroy();
}
if (recordFile !== undefined) {
  const temp = `${recordFile}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ cwd: process.cwd(), pid: process.pid, grandchild, term: process.env.TERM ?? null, colorterm: process.env.COLORTERM ?? null, envNames: Object.keys(process.env).sort() }));
  renameSync(temp, recordFile);
}

const out = (text) => process.stdout.write(text);
const prompt = () => out('fs> ');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
if (!flags.includes('--silent')) {
  out('fake-shell-ready\r\n');
  prompt();
}

let line = '';
const run = (text) => {
  const [command, ...rest] = text.trim().split(/\s+/);
  if (command === 'exit') {
    out('bye\r\n');
    process.exit(Number(rest[0] ?? 0));
  }
  if (command === 'size') out(`size=${process.stdout.columns}x${process.stdout.rows}\r\n`);
  else if (command === 'args') out(`args=${JSON.stringify(flags)}\r\n`);
  else if (command === 'pid') out(`pid=${process.pid}\r\n`);
  else if (command === 'cwd') out(`cwd=${process.cwd()}\r\n`);
  else if (command === 'alt') {
    // The alternate screen, a picture painted once, then left alone: a raw tail cannot rebuild it.
    out('\x1b[?1049h\x1b[2J\x1b[H');
    for (let row = 1; row <= 5; row += 1) out(`\x1b[${row};1Hscreen-row-${row}`);
    out('\x1b[3;1H');
    return false;
  } else if (command === 'secret') {
    for (const [name, value] of Object.entries(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD|SSH_AUTH_SOCK/i.test(name)) out(`secret=${name}=${value}\r\n`);
    out('secret-done\r\n');
  } else if (command !== undefined && command !== '') out(`echo:${text.trim()}\r\n`);
  return true;
};

process.stdin.on('data', (chunk) => {
  for (const ch of chunk) {
    if (ch === '\r' || ch === '\n') {
      out('\r\n');
      const text = line;
      line = '';
      if (run(text)) prompt();
    } else if (ch === '\x7f' || ch === '\b') {
      if (line.length > 0) {
        line = line.slice(0, -1);
        out('\b \b');
      }
    } else if (ch >= ' ') {
      line += ch;
      out(ch);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
