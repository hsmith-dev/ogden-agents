// SPIKE 13.1: imported first by the server's Node (`--import`, OGDEN_SPIKE_PRELOAD) to stand in
// for an agent: it starts one long-lived child, as a coding agent's process would, and records
// its pid so the harness can see whether quitting the app leaves it running.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore', windowsHide: true });
const file = process.env.OGDEN_SPIKE_GRANDCHILD_FILE;
const record = (data) => {
  if (file) appendFileSync(file, `${JSON.stringify({ at: Date.now(), ...data })}\n`);
};
record({ serverPid: process.pid, grandchildPid: child.pid, arch: process.arch, execPath: process.execPath });
// If the child ends while the server is still up, say how (it should not).
child.on('exit', (code, signal) => record({ grandchildExit: { code, signal } }));
