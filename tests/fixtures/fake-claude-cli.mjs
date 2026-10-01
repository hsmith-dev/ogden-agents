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
// With CLAUDE_CONFIG_DIR set, each `echo` line is also recorded as the real
// CLI records it (story 3.3): JSONL records appended to
// `$CLAUDE_CONFIG_DIR/projects/<folder slug>/<resumed id>.jsonl`, chained by
// `parentUuid` after the file's last main-chain record: the user's text, a
// thinking block, a `tool_use` and its `tool_result`, a sidechain record off
// the chain, then the reply text `echo:<line>`. Never the user's own ~/.claude.
// With FAKE_CLAUDE_GRANDCHILD=1 it first starts a long-lived child of its own
// (as the real CLI starts tools), whose pid it records too.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  try {
    recordExchange(text, `echo:${text}`);
  } catch {
    // The record is the test's to check; the terminal answers either way.
  }
  process.stdout.write(`\r\necho:${text}\r\nready>`);
});
