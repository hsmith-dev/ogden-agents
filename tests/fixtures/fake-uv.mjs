// A stand-in for `uv` in the script runner's tests (story 4.1), run as
// `node fake-uv.mjs run --no-project --quiet <script> <args…>`. It never runs
// the script; `FAKE_UV_MODE` (from the environment the runner passes) picks
// what it does:
//   echo (default)  prints { argv, cwd, env } as JSON and exits 0
//   fail            prints uv-like noise and `{"error": …}` on stderr, exits 1
//   bad             prints text that isn't JSON, exits 0
//   big             prints 2 MiB, exits 0
//   hang            starts a child that never exits, writes both pids to
//                   `FAKE_UV_PID_FILE`, and never exits itself
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const mode = process.env.FAKE_UV_MODE ?? 'echo';
const argv = process.argv.slice(2);

if (mode === 'echo') {
  process.stdout.write(JSON.stringify({ argv, cwd: process.cwd(), env: process.env }));
} else if (mode === 'fail') {
  process.stderr.write('Reading inline script metadata from `tickets.py`\n');
  process.stderr.write(`${JSON.stringify({ error: 'no active initiative: set core.active_initiative' })}\n`);
  process.exitCode = 1;
} else if (mode === 'bad') {
  process.stdout.write('this is not JSON');
} else if (mode === 'big') {
  process.stdout.write('x'.repeat(2 * 1024 * 1024));
} else if (mode === 'hang') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(process.env.FAKE_UV_PID_FILE, JSON.stringify({ uv: process.pid, child: child.pid }));
  setInterval(() => {}, 1000);
}
