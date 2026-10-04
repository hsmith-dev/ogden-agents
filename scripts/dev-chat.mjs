#!/usr/bin/env node
// `pnpm dev:chat` (story 2.2): runs the built server in this terminal with the
// Claude Agent ACP adapter from this checkout's dev dependencies, for the live
// check against the Claude Code already signed in on this computer.
//
//   pnpm dev:chat [--no-open] [--port <number>]
//
// The adapter is not a dependency of the published package (about 230 MB with
// its bundled CLI); onboarding installs it on demand (story 9.3). Here it comes
// from node_modules, and `acp-claude-code` points it at your own `claude`
// (CLAUDE_CODE_EXECUTABLE) when one is on PATH or in ~/.local/bin.
//
// The data folder is `$OGDEN_AGENTS_DATA_DIR`, else a dev folder in the temp
// directory, so a background Ogden Agents on the default folder is left alone.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ADAPTER_ENV = 'OGDEN_AGENTS_CLAUDE_ACP_PATH';
const DATA_DIR_ENV = 'OGDEN_AGENTS_DATA_DIR';

function adapterPath() {
  if (process.env[ADAPTER_ENV]) return process.env[ADAPTER_ENV];
  try {
    const manifest = createRequire(join(root, 'package.json')).resolve('@agentclientprotocol/claude-agent-acp/package.json');
    return join(dirname(manifest), 'dist', 'index.js');
  } catch {
    return undefined;
  }
}

const adapter = adapterPath();
if (adapter === undefined || !existsSync(adapter)) {
  console.error('dev:chat: the Claude Agent ACP adapter is not installed. Run `pnpm install` first.');
  process.exit(1);
}
const dataDir = process.env[DATA_DIR_ENV] || join(tmpdir(), 'ogden-agents-dev-chat');
console.log(`dev:chat: Claude Code adapter ${adapter}`);
console.log(`dev:chat: data folder ${dataDir}`);

const child = spawn(process.execPath, [join(root, 'bin', 'ogden.js'), '--foreground', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, [ADAPTER_ENV]: adapter, [DATA_DIR_ENV]: dataDir },
});
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal === null ? 0 : 1)));
