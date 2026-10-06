// A stand-in for `uv` in the script runner's and the toolchain's tests
// (stories 4.1 and 4.2), run as `node fake-uv.mjs run --no-project --quiet
// <script> <args…>` or `node fake-uv.mjs --version`. It never runs the
// script, and it behaves like the real program where the tests rely on it:
// the version probe prints uv's own version line, a refusal is a non-zero
// exit with `{"error": …}` on stderr, and output arrives as lines.
//
// `FAKE_UV_ENV_FILE` (from the environment the caller passes): append this
// process's whole environment, as one JSON line, to that file, in every mode,
// so a test can compare what the version probe and a script run were given.
//
// `FAKE_UV_MODE` picks what it does (a `--version` call is always `version`):
//   echo (default)  prints { argv, cwd, env } as JSON and exits 0
//   version         prints `uv 0.12.21 (fake)` and exits 0, as `uv --version`
//   lines           prints three progress lines on stderr, each flushed on
//                   its own, then `{"done": true}` on stdout over two lines
//                   with no final line break, exits 0
//   fail            prints uv-like noise and `{"error": …}` on stderr, exits 1
//   refuse          prints `{"error": …}` on stderr and exits 2 (the store's refusal)
//   bad             prints text that isn't JSON, exits 0
//   big             prints 2 MiB, exits 0
//   hang            starts a child that never exits, writes both pids to
//                   `FAKE_UV_PID_FILE`, and never exits itself (a `tickets.py`
//                   read that never answers: the runner's timeout and close())
//   bmad-setup      emulates BMad Method's `setup.py` (story 4.3) against its
//                   `--project-root`: `--list-config-questions` prints
//                   `FAKE_UV_QUESTIONS` (a JSON list, default `[]`); without
//                   it, setup creates `_bmad/scripts/`, `_bmad/config.toml`
//                   and `_bmad-output/` (or, with `FAKE_UV_SETUP_FAIL` set,
//                   prints `{"error"}` naming it and exits 1).
//
// `FAKE_UV_ENV_FILE` lines also carry `argv` and `cwd`.
// `FAKE_UV_LOG_FILE`: append `{ argv, cwd, answers }` as one JSON line to that
// file on every run (`answers` is the `--module-answers` file's text, if any).
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const mode = argv[0] === '--version' ? 'version' : (process.env.FAKE_UV_MODE ?? 'echo');

if (process.env.FAKE_UV_ENV_FILE) appendFileSync(process.env.FAKE_UV_ENV_FILE, `${JSON.stringify({ mode, argv, cwd: process.cwd(), env: process.env })}\n`);

/** The value after `flag` in argv, or `undefined`. */
const option = (flag) => {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};

if (process.env.FAKE_UV_LOG_FILE) {
  const answersFile = option('--module-answers');
  const answers = answersFile !== undefined && existsSync(answersFile) ? readFileSync(answersFile, 'utf8') : null;
  appendFileSync(process.env.FAKE_UV_LOG_FILE, `${JSON.stringify({ argv, cwd: process.cwd(), answers })}\n`);
}

if (mode === 'bmad-setup') {
  const root = option('--project-root');
  const bmad = join(root, '_bmad');
  if (argv.includes('--list-config-questions')) {
    process.stdout.write(process.env.FAKE_UV_QUESTIONS ?? '[]');
  } else if (process.env.FAKE_UV_SETUP_FAIL) {
    process.stderr.write(`${JSON.stringify({ error: `${process.env.FAKE_UV_SETUP_FAIL}: ${bmad}` })}\n`);
    process.exitCode = 1;
  } else {
    mkdirSync(join(bmad, 'scripts'), { recursive: true });
    writeFileSync(join(bmad, 'config.toml'), '[core]\nproject_name = "repo"\noutput_folder = "{project-root}/_bmad-output"\n');
    mkdirSync(join(root, '_bmad-output'), { recursive: true });
    process.stdout.write(JSON.stringify({ mode: 'setup', status: 'created', changed: true, next: null }));
  }
} else if (mode === 'echo') {
  process.stdout.write(JSON.stringify({ argv, cwd: process.cwd(), env: process.env }));
} else if (mode === 'version') {
  process.stdout.write('uv 0.12.21 (fake)\n');
} else if (mode === 'lines') {
  const lines = ['step checking', 'step copying_skills', 'step verifying'];
  const next = () => {
    const line = lines.shift();
    if (line === undefined) {
      process.stdout.write('{"done":\n true}');
      return;
    }
    process.stderr.write(`${line}\n`);
    setTimeout(next, 20);
  };
  next();
} else if (mode === 'fail') {
  process.stderr.write('Reading inline script metadata from `tickets.py`\n');
  process.stderr.write(`${JSON.stringify({ error: 'no active initiative: set core.active_initiative' })}\n`);
  process.exitCode = 1;
} else if (mode === 'refuse') {
  process.stderr.write(`${JSON.stringify({ error: "store is linear: change status through the store's write verb, not this script" })}\n`);
  process.exitCode = 2;
} else if (mode === 'bad') {
  process.stdout.write('this is not JSON');
} else if (mode === 'big') {
  process.stdout.write('x'.repeat(2 * 1024 * 1024));
} else if (mode === 'hang') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  // Written whole and renamed into place: a test polling for the file never reads it half-written
  // (`writeFileSync` truncates first, so `existsSync` is true before the content is).
  const pidFile = process.env.FAKE_UV_PID_FILE;
  writeFileSync(`${pidFile}.tmp`, JSON.stringify({ uv: process.pid, child: child.pid }));
  renameSync(`${pidFile}.tmp`, pidFile);
  setInterval(() => {}, 1000);
}
