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
//   colour      prints `colour:` then `TC` in a truecolour SGR (`ESC[38;2;12;34;56m`), then a reset
//   anything    prints `echo:<line>`
//
// In a terminal it reads raw, as the real CLI (Ink) does, and echoes what is
// typed itself (story 3.8). It turns on bracketed paste (`ESC[?2004h`)
// before its banner; a bracketed paste (`ESC[200~ ... ESC[201~`) prints
// `pasted:<hex of the text>`; Ctrl+C (0x03) prints `ctrl-c` and leaves it
// running; Backspace (0x7f or 0x08) removes the last character; any other
// escape sequence is dropped. Enter is CR, LF or CR LF. With stdin a pipe it
// reads the same lines, without echo.
//
// Each time the terminal is resized it prints `resized=<cols>x<rows>` unasked
// (story 3.2): SIGWINCH on POSIX; on Windows libuv sees ConPTY's resize only
// while stdin is read raw, and otherwise keeps the first size (story 3.8,
// CI probe run 36896007333).
//
// Every token it prints has no spaces and no trailing blank: Windows' ConPTY
// repaints the screen (cursor moves, trimmed or skipped blanks) rather than
// passing output through, so tests match these tokens in the output with its
// escape sequences stripped.
//
// With FAKE_CLAUDE_RECORD set it writes, as JSON, its arguments, its folder,
// its pid, its TERM and the names (never the values) of its environment.
// With CLAUDE_CONFIG_DIR set, each `echo` line is also recorded as the real
// CLI records it (story 3.3): JSONL records appended to
// `$CLAUDE_CONFIG_DIR/projects/<folder slug>/<resumed id>.jsonl`, chained by
// `parentUuid` after the file's last main-chain record: the user's text, a
// thinking block, a `tool_use` and its `tool_result`, a sidechain record off
// the chain, then the reply text `echo:<line>`. Never the user's own ~/.claude.
// With FAKE_CLAUDE_GRANDCHILD=1 it first starts a long-lived child of its own
// (as the real CLI starts tools), whose pid it records too. The child ignores
// SIGHUP (as `nohup` tools do), so only a tree kill stops it once the CLI has
// gone (story 3.4).
// With FAKE_CLAUDE_CRASH_ON_START=1 it exits 70 right after starting (and
// recording), printing nothing: a CLI that crashes on start (story 3.4).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
let grandchild = null;
if (process.env.FAKE_CLAUDE_GRANDCHILD === '1') {
  const child = spawn(process.execPath, ['-e', "process.on('SIGHUP', () => {}); process.stdout.write('up'); setInterval(() => {}, 1000)"], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  child.on('error', () => {});
  grandchild = child.pid ?? null;
  // Only once it ignores the hang-up: a crash right after must not stop it by accident.
  await new Promise((resolve) => {
    child.stdout.once('data', resolve);
    child.once('exit', resolve);
    child.once('error', resolve);
  });
  child.stdout.destroy();
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

if (process.env.FAKE_CLAUDE_CRASH_ON_START === '1') process.exit(70);

/** The terminal's size now: on Windows `columns`/`rows` can lag a ConPTY resize. */
const windowSize = () => process.stdout.getWindowSize?.() ?? [process.stdout.columns, process.stdout.rows];

// Node's own resize event (SIGWINCH on POSIX, ConPTY's resize on Windows while
// stdin is read raw): a `SIGWINCH` listener would still read the old size.
process.stdout.on('resize', () => {
  const [cols, rows] = windowSize();
  process.stdout.write(`\r\nresized=${cols}x${rows}\r\nready>`);
});

/** Appends `line` and the reply to it to the session's record, as the CLI does, when CLAUDE_CONFIG_DIR is set. */
function recordExchange(line, reply) {
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  const at = args.indexOf('--resume');
  const sessionId = at === -1 ? undefined : args[at + 1];
  if (!configDir || !sessionId) return;
  const folder = join(configDir, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'));
  const file = join(folder, `${sessionId}.jsonl`);
  mkdirSync(folder, { recursive: true });
  let parentUuid = null;
  if (existsSync(file)) {
    for (const text of readFileSync(file, 'utf8').split('\n')) {
      try {
        const record = JSON.parse(text);
        if (record.uuid && !record.isSidechain) parentUuid = record.uuid;
      } catch {
        // Not a record.
      }
    }
  }
  const base = () => ({ sessionId, cwd: process.cwd(), version: '2.1.0', timestamp: new Date().toISOString(), userType: 'external' });
  const records = [];
  const add = (record, chained = true) => {
    const uuid = randomUUID();
    records.push({ parentUuid: chained ? parentUuid : records.at(-1)?.uuid ?? parentUuid, isSidechain: !chained, ...base(), uuid, ...record });
    if (chained) parentUuid = uuid;
  };
  const tool = `toolu_${randomUUID().replaceAll('-', '')}`;
  add({ type: 'user', message: { role: 'user', content: line } });
  add({ type: 'assistant', message: { role: 'assistant', model: 'claude-fake', content: [{ type: 'thinking', thinking: `thinking about ${line}`, signature: 'x' }] } });
  add({ type: 'assistant', message: { role: 'assistant', model: 'claude-fake', content: [{ type: 'tool_use', id: tool, name: 'Bash', input: { command: 'true' } }] } });
  add({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tool, content: 'tool-output' }] }, toolUseResult: { stdout: 'tool-output' } });
  add({ type: 'assistant', message: { role: 'assistant', model: 'claude-fake', content: [{ type: 'text', text: 'sidechain-text' }] } }, false);
  add({ type: 'assistant', message: { role: 'assistant', model: 'claude-fake', content: [{ type: 'text', text: reply }] } });
  appendFileSync(file, records.map((record) => `${JSON.stringify(record)}\n`).join(''));
}

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const tty = process.stdin.isTTY === true;
// Asks for bracketed paste first, as Claude Code does: Windows' ConPTY dropped the
// markers for a program that hadn't (the CI probe asked first; 3.8 review R10).
process.stdout.write(`${tty ? '\x1b[?2004h' : ''}fake-claude:${args.join(',')}\r\nready>`);
if (tty) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let pending = '';
let line = '';
let lastWasCr = false;
process.stdin.on('data', (chunk) => {
  pending += chunk;
  while (pending.length > 0) {
    if (pending.startsWith(PASTE_START)) {
      const end = pending.indexOf(PASTE_END);
      if (end === -1) return; // The rest of the paste is still on its way.
      const text = pending.slice(PASTE_START.length, end);
      pending = pending.slice(end + PASTE_END.length);
      process.stdout.write(`\r\npasted:${Buffer.from(text).toString('hex')}\r\nready>`);
      continue;
    }
    if (pending[0] === '\x1b') {
      // Another escape sequence (an arrow, a focus report): dropped whole, or kept until it is.
      const match = /^\x1b(\[[0-?]*[ -/]*[@-~]|O.|[^[O])/.exec(pending);
      if (match === null) {
        if (pending.length < 16) return;
        pending = pending.slice(1);
      } else pending = pending.slice(match[0].length);
      continue;
    }
    const char = pending[0];
    pending = pending.slice(1);
    const cr = char === '\r';
    if (cr || char === '\n') {
      const skip = char === '\n' && lastWasCr;
      lastWasCr = cr;
      if (skip) continue;
      const done = line;
      line = '';
      answer(done);
      continue;
    }
    lastWasCr = false;
    if (char === '\x03') {
      process.stdout.write('\r\nctrl-c\r\nready>');
      line = '';
    } else if (char === '\x7f' || char === '\b') {
      if (line.length > 0) {
        line = line.slice(0, -1);
        if (tty) process.stdout.write('\b \b');
      }
    } else if (char >= ' ') {
      line += char;
      if (tty) process.stdout.write(char);
    }
  }
});

/** Answers one line typed at the prompt. */
function answer(typed) {
  const text = typed.trim();
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
  if (text === 'colour') {
    process.stdout.write('\r\ncolour:\x1b[38;2;12;34;56mTC\x1b[0m\r\nready>');
    return;
  }
  if (text === 'size') {
    const [cols, rows] = windowSize();
    process.stdout.write(`\r\nsize=${cols}x${rows}\r\nready>`);
    return;
  }
  try {
    recordExchange(text, `echo:${text}`);
  } catch {
    // The record is the test's to check; the terminal answers either way.
  }
  process.stdout.write(`\r\necho:${text}\r\nready>`);
}
