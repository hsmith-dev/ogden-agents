#!/usr/bin/env node
// A fake `claude` CLI for the terminal tests (story 3.1): what the terminal
// runs as `claude --resume <id>` (through CLAUDE_CODE_EXECUTABLE), so no test
// runs the real Claude Code or touches an account.
//
//   node fake-claude-cli.mjs --resume <session id>
//
// It prints `fake-claude:<args, comma-separated>` and a `ready>` prompt, then
// answers each line:
//
//   /exit       prints "bye" and exits 0 (the CLI leaving by itself)
//   crash       exits 70 at once, printing nothing (the CLI crashing; story 3.2)
//   size        prints `size=<cols>x<rows>` (the terminal's size)
//   flood       prints 64 KiB chunks of `x` without end, as fast as the terminal takes them
//   anything    prints `echo:<line>`
//
// On POSIX, each time the terminal is resized (SIGWINCH) it prints
// `resized=<cols>x<rows>` unasked (story 3.2). Windows has no SIGWINCH:
// story 3.8 decides how a resize shows there.
//
// Every token it prints has no spaces and no trailing blank: Windows' ConPTY
// repaints the screen (cursor moves, trimmed or skipped blanks) rather than
// passing output through, so tests match these tokens in the output with its
// escape sequences stripped.
//
// With FAKE_CLAUDE_RECORD set it writes, as JSON, its arguments, its folder,
// its pid, its TERM and the names (never the values) of its environment.
// With FAKE_CLAUDE_GRANDCHILD=1 it first starts a long-lived child of its own
// (as the real CLI starts tools), whose pid it records too.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
let grandchild = null;
if (process.env.FAKE_CLAUDE_GRANDCHILD === '1') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  grandchild = child.pid ?? null;
}
if (process.env.FAKE_CLAUDE_RECORD) {
  writeFileSync(
    process.env.FAKE_CLAUDE_RECORD,
    JSON.stringify({
      argv: args,
      cwd: process.cwd(),
      pid: process.pid,
      grandchild,
      term: process.env.TERM ?? null,
      envNames: Object.keys(process.env).sort(),
    }),
  );
}

/** The terminal's size now: on Windows `columns`/`rows` can lag a ConPTY resize. */
const windowSize = () => process.stdout.getWindowSize?.() ?? [process.stdout.columns, process.stdout.rows];

if (process.platform !== 'win32') {
  // Node's own SIGWINCH handling: a `SIGWINCH` listener would still read the old size.
  process.stdout.on('resize', () => {
    const [cols, rows] = windowSize();
    process.stdout.write(`\r\nresized=${cols}x${rows}\r\nready>`);
  });
}

process.stdout.write(`fake-claude:${args.join(',')}\r\nready>`);
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const text = line.trim();
  if (text === '/exit') {
    process.stdout.write('bye\r\n', () => process.exit(0));
    return;
  }
  if (text === 'crash') {
    process.exit(70);
  }
  if (text === 'flood') {
    const chunk = 'x'.repeat(64 * 1024);
    const pump = () => {
      while (process.stdout.write(chunk));
      process.stdout.once('drain', pump);
    };
    pump();
    return;
  }
  if (text === 'size') {
    const [cols, rows] = windowSize();
    process.stdout.write(`\r\nsize=${cols}x${rows}\r\nready>`);
    return;
  }
  process.stdout.write(`\r\necho:${text}\r\nready>`);
});
