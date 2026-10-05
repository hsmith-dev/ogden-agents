// SPIKE 16.1 (TEMPORARY): a stand-in for an agent's own CLI. No network, no sign-in, no real vendor tool.
// Usage: node fake-cli.mjs <mode> [args...]. Each mode mimics one behaviour a real CLI shows in a terminal.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [mode = 'prompt', ...args] = process.argv.slice(2);
const out = (text) => process.stdout.write(text);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LABELS = process.env.FAKE_LABELS; // ground-truth side channel for the status probe (a file path)
const label = (state) => LABELS && appendFileSync(LABELS, `${JSON.stringify({ t: Date.now(), state })}\n`);

/** Reads one line from the terminal in raw mode, understanding bracketed paste. Returns the line. */
function readLine() {
  return new Promise((resolve) => {
    let buffer = '';
    let pasting = false;
    const onData = (chunk) => {
      let text = chunk.toString('utf8');
      while (text.length > 0) {
        if (text.startsWith('\x1b[200~')) { pasting = true; text = text.slice(6); continue; }
        if (text.startsWith('\x1b[201~')) { pasting = false; text = text.slice(6); continue; }
        const ch = text[0];
        text = text.slice(1);
        if ((ch === '\r' || ch === '\n') && !pasting) {
          process.stdin.off('data', onData);
          out('\r\n');
          resolve(buffer);
          return;
        }
        if (ch === '\x7f' || ch === '\b') { buffer = buffer.slice(0, -1); continue; }
        buffer += ch;
        out(ch);
      }
    };
    process.stdin.on('data', onData);
  });
}

function rawOn() {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
}

async function promptLoop() {
  rawOn();
  for (;;) {
    out('fake> ');
    label('idle');
    const line = await readLine();
    if (line === 'exit') process.exit(0);
    label('working');
    out(`you said: ${line}\r\n`);
  }
}

if (mode === 'prompt') {
  out('Fake CLI ready\r\n');
  await promptLoop();
} else if (mode === 'raw') {
  // Reports every byte it is given (hex), its terminal size at start and on every resize, and asks for bracketed paste.
  rawOn();
  out('\x1b[?2004h');
  const size = () => `SIZE:${process.stdout.columns}x${process.stdout.rows}\r\n`;
  out(`READY ${size()}`);
  process.stdout.on('resize', () => out(size()));
  let total = 0;
  process.stdin.on('data', (chunk) => {
    total += chunk.length;
    // A side channel for the probes: how much input arrived, whatever the terminal does with the output.
    if (process.env.FAKE_COUNT) writeFileSync(process.env.FAKE_COUNT, String(total));
    if (process.env.FAKE_QUIET) return;
    const hex = Buffer.from(chunk).toString('hex');
    out(`GOT:${chunk.length}:${hex}\r\n`);
    if (chunk.toString() === 'q') process.exit(0);
  });
} else if (mode === 'echo') {
  // Cheapest possible echo for latency: every byte typed is printed back with a marker.
  rawOn();
  out('ECHO-READY\r\n');
  process.stdin.on('data', (chunk) => out(`<${chunk.toString('latin1')}>`));
} else if (mode === 'login') {
  // A login in the terminal: prints a URL, reads a pasted code, "stores" a credential in the user's own home.
  rawOn();
  out('Welcome. To sign in open https://fake.example.test/login in your browser.\r\n');
  out('Paste the code here> ');
  const code = await readLine();
  const folder = join(process.env.FAKE_HOME || homedir(), '.fakecli');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'credentials.json'), JSON.stringify({ code }));
  out('Signed in as fake@example.test\r\n');
  await promptLoop();
} else if (mode === 'long') {
  const mb = Number(args[0] ?? 10);
  const pad = 'x'.repeat(100);
  const total = Math.floor((mb * 1024 * 1024) / 110);
  let batch = '';
  for (let i = 0; i < total; i += 1) {
    batch += `line ${String(i).padStart(7, '0')} ${pad}\r\n`;
    if (batch.length > 64 * 1024) { out(batch); batch = ''; await sleep(0); }
  }
  out(batch);
  out(`LONG-DONE ${total}\r\n`);
  if (args[1] !== 'exit') { rawOn(); await sleep(60_000); }
} else if (mode === 'lines') {
  // Prints N numbered lines and exits at once: does the last output survive the exit (ConPTY is known to lose a tail)?
  const n = Number(args[0] ?? 1000);
  let text = '';
  for (let i = 1; i <= n; i += 1) text += `row ${i}\r\n`;
  out(text);
  out('LINES-END\r\n');
  process.exit(Number(args[1] ?? 0));
} else if (mode === 'escapes') {
  out('\x1b]0;fake title\x07'); // OSC title
  out('\x1b[31mred\x1b[0m \x1b[1;32mbold green\x1b[0m \x1b[38;5;208m256-orange\x1b[0m \x1b[38;2;12;200;99mtruecolor\x1b[0m \x1b[48;2;10;20;30m bg \x1b[0m\r\n');
  out('unicode: café naïve 日本語テスト 한국어 😀🚀 é ‘quotes’ ─┌┐└┘ █▓▒░\r\n');
  out('wide: ｗｉｄｅ  ZWJ: 👨‍👩‍👧\r\n');
  out('\x1b[?1049h\x1b[2J\x1b[H'); // alternate screen, clear
  out('\x1b[3;5HALT-SCREEN-TEXT\x1b[5;1Hsecond row\x1b[1;1H');
  out('\x1b[?25l\x1b[?1000h\x1b[?2004h'); // hide cursor, mouse, bracketed paste
  rawOn();
  process.stdin.on('data', (c) => { if (c.toString() === 'q') { out('\x1b[?1049l\x1b[?25h\x1b[?1000l'); out('BACK-TO-MAIN\r\n'); process.exit(0); } });
} else if (mode === 'permission') {
  // Works for workMs with a spinner, then asks a permission-style question and waits for an answer; then works, then idles.
  const workMs = Number(args[0] ?? 1500);
  const style = args[1] ?? 'yn'; // yn | menu | proceed
  rawOn();
  label('working');
  const end = Date.now() + workMs;
  let i = 0;
  while (Date.now() < end) { out(`\r${'|/-\\'[i++ % 4]} Thinking...`); await sleep(80); }
  out('\r\x1b[K');
  out('I want to run: rm -rf build/\r\n');
  label('attention');
  if (style === 'yn') out('Allow this command? (y/n) ');
  else if (style === 'menu') out('Do you want to proceed?\r\n\x1b[36m❯ 1. Yes\x1b[0m\r\n  2. Yes, and don\'t ask again\r\n  3. No, and tell me what to do differently\r\n');
  else out('Press Enter to continue...');
  await readLine();
  label('working');
  const end2 = Date.now() + 1000;
  while (Date.now() < end2) { out(`\r${'|/-\\'[i++ % 4]} Running...`); await sleep(80); }
  out('\r\x1b[KDone.\r\n');
  await promptLoop();
} else if (mode === 'exit') {
  await sleep(Number(args[1] ?? 0));
  out('bye\r\n');
  process.exit(Number(args[0] ?? 0));
} else if (mode === 'hang') {
  // Ignores every polite signal; only a hard kill ends it.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => out(`ignored ${signal}\r\n`));
  out(`HANGING ${process.pid}\r\n`);
  setInterval(() => {}, 1000);
} else if (mode === 'tree') {
  // A CLI that started a helper (as real CLIs start language servers, MCP servers, tools).
  const detached = args[0] === 'detached';
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', detached, windowsHide: true });
  if (detached) child.unref();
  out(`CHILD ${child.pid}\r\n`);
  setInterval(() => {}, 1000);
} else if (mode === 'env') {
  const b64 = Buffer.from(JSON.stringify(process.env)).toString('base64');
  for (let i = 0; i * 60 < b64.length; i += 1) out(`ENVB64 ${i}:${b64.slice(i * 60, i * 60 + 60)}\r\n`);
  out('ENVDUMP-END\r\n');
  if (args[0] !== 'exit') setInterval(() => {}, 1000);
} else if (mode === 'scenario') {
  // A timeline from a JSON file: [{print}, {wait}, {spinner}, {read}, {label}, {exit}].
  const steps = JSON.parse(readFileSync(args[0], 'utf8'));
  rawOn();
  let i = 0;
  for (const step of steps) {
    if (step.label) label(step.label);
    if (step.print) out(step.print);
    if (step.wait) await sleep(step.wait);
    if (step.spinner) { const end = Date.now() + step.spinner; while (Date.now() < end) { out(`\r${'|/-\\'[i++ % 4]} ${step.text ?? 'Working...'}`); await sleep(80); } out('\r\x1b[K'); }
    if (step.read) await readLine();
    if (step.exit !== undefined) { label('exited'); process.exit(step.exit); }
  }
  setInterval(() => {}, 1000);
} else if (mode === 'cjk') {
  // A big Unicode stream (3-byte and 4-byte characters, a combining mark) to catch a multibyte character split across reads.
  const unit = '日本語😀é\u0301ｗ ';
  const n = Number(args[0] ?? 20000);
  let batch = '';
  for (let i = 0; i < n; i += 1) { batch += unit; if (i % 50 === 49) batch += '\r\n'; if (batch.length > 30000) { out(batch); batch = ''; await sleep(0); } }
  out(batch + '\r\nCJK-DONE\r\n');
  setInterval(() => {}, 1000);
} else if (mode === 'version') {
  out('fake-cli 1.2.3\n');
  process.exit(0);
} else {
  out(`unknown mode ${mode}\r\n`);
  process.exit(2);
}
