/**
 * The build turn the fake agents play for `/bmad-build-auto ticket <ref>` (or Codex's
 * `$bmad-build-auto`), shared by `fake-acp-agent.mjs` and `fake-opencode.mjs` (epic 21
 * story 21.6) so every agent that builds plays the same build. The switches
 * (`FAKE_ACP_BUILD_*`) are described in `fake-acp-agent.mjs`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** Whether `text` is a build prompt. */
export const isBuildPrompt = (text) => /^[/$]bmad-build-auto ticket /.test(text);

/**
 * Plays one build in `cwd` (the run's worktree).
 * `editsInsideWithoutAsking`: Codex in `workspace-write`, as its real sandbox: an edit inside the workspace
 * (or an added directory) needs no card. `mode` and `openedAdditionalDirectories` are only reported in the env dump.
 */
export async function playBuildTurn({ acp, client, sessionId, text, cwd, mode, openedAdditionalDirectories, editsInsideWithoutAsking = false }) {
  const additionalDirectories = openedAdditionalDirectories ?? [];
  const update = (body) => client.notify('session/update', { sessionId, update: body });
  const say = (_client, _sessionId, chunk) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } });
  const ref = text.slice('/bmad-build-auto ticket '.length).trim().split(/\s/)[0];
  const ask = async (toolCallId, path) => {
    const toolCall = { toolCallId, title: `Write ${path}`, kind: 'edit', locations: [{ path }], rawInput: { file_path: path } };
    // Codex in `workspace-write` (epic 17), as the real sandbox: an edit inside the workspace (or an added directory) needs no card.
    if (editsInsideWithoutAsking) {
      const roots = [cwd, ...additionalDirectories];
      const insideRoot = roots.some((root) => { const rel = relative(root, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); });
      if (insideRoot) {
        await update({ sessionUpdate: 'tool_call', ...toolCall, status: 'completed' });
        return true;
      }
    }
    await update({ sessionUpdate: 'tool_call', ...toolCall, status: 'pending' });
    const answer = await client.request('session/request_permission', {
      sessionId,
      toolCall,
      options: [
        { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
      ],
    });
    const allowed = answer.outcome.outcome === 'selected' && answer.outcome.optionId === 'allow';
    await update({ sessionUpdate: 'tool_call_update', toolCallId, status: allowed ? 'completed' : 'failed' });
    return allowed;
  };
  // Epic 17: the agent could not go on. `auth`: a rejected key or an expired sign in (ACP's -32000); `usage`: its usage limit, in
  // the words FAKE_ACP_BUILD_FAIL_TEXT gives (each agent says it its own way).
  if (process.env.FAKE_ACP_BUILD_FAIL === 'auth') throw acp.RequestError.authRequired(undefined, 'Authentication required');
  if (process.env.FAKE_ACP_BUILD_FAIL === 'usage') throw acp.RequestError.internalError(undefined, process.env.FAKE_ACP_BUILD_FAIL_TEXT ?? 'usage limit reached');
  await say(client, sessionId, `Building ${ref}. `);
  // Story 5.7: what the build's agent was started with, for the secrets and allowlist tests.
  if (process.env.FAKE_ACP_BUILD_ENV_DUMP) {
    writeFileSync(process.env.FAKE_ACP_BUILD_ENV_DUMP, Object.entries(process.env).map(([name, value]) => `${name}=${value}`).join('\n'));
    // How the session was opened (epic 17), beside the environment: its mode and the session's added directories.
    writeFileSync(`${process.env.FAKE_ACP_BUILD_ENV_DUMP}.session`, [`session_mode=${mode}`, `additionalDirectories=${JSON.stringify(openedAdditionalDirectories ?? null)}`].join('\n'));
  }
  if (process.env.FAKE_ACP_BUILD_ECHO_KEY === '1') await say(client, sessionId, `The key is ${process.env.ANTHROPIC_API_KEY ?? 'none'}. `);
  const childFile = process.env.FAKE_ACP_BUILD_CHILD;
  if (childFile) {
    // Not detached: it stays in the agent's process group (its tree on Windows), as a build's command does.
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    child.on('error', () => undefined);
    writeFileSync(childFile, `${process.pid} ${child.pid}\n`);
  }
  const inside = join(cwd, 'src', `built-${ref}.txt`);
  if (await ask('call-build-write', inside)) {
    mkdirSync(dirname(inside), { recursive: true });
    writeFileSync(inside, `Built ${ref} by the fake agent.\n`);
  }
  const outside = resolve(cwd, '..', `escape-${ref}.txt`);
  if (await ask('call-build-escape', outside)) writeFileSync(outside, 'escaped\n');
  // Epic 17: FAKE_ACP_BUILD_PROTECTED=1 also tries a protected file inside the worktree (AGENTS.md).
  if (process.env.FAKE_ACP_BUILD_PROTECTED === '1') {
    const protectedFile = join(cwd, 'AGENTS.md');
    if (await ask('call-build-protected', protectedFile)) writeFileSync(protectedFile, 'The agent changed this.\n');
  }
  // The plan: the Markdown file under _bmad-output whose frontmatter names this ticket's id.
  const id = ref.slice(ref.lastIndexOf('.') + 1);
  const plans = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith('.md') && new RegExp(`^ticket:\\s*['"]?${id}['"]?\\s*$`, 'm').test(readFileSync(full, 'utf8'))) plans.push(full);
    }
  };
  if (existsSync(join(cwd, '_bmad-output'))) visit(join(cwd, '_bmad-output'));
  const halt = process.env.FAKE_ACP_BUILD_HALT;
  const blocked = process.env.FAKE_ACP_BUILD_OUTCOME === 'blocked' || (halt !== undefined && halt !== '');
  const reason = halt !== undefined && halt !== '' ? halt : 'The fake agent was told to block.';
  const delay = Number(process.env.FAKE_ACP_BUILD_DELAY_MS ?? '0');
  if (delay > 0) await new Promise((done) => setTimeout(done, delay));
  if (process.env.FAKE_ACP_BUILD_FAIL_TESTS === '1') writeFileSync(join(cwd, '.fake-tests-fail'), 'fail\n');
  for (const plan of plans) {
    const before = readFileSync(plan, 'utf8');
    const status = blocked ? `status: blocked\nblocked_reason: ${JSON.stringify(reason)}` : 'status: built';
    writeFileSync(plan, before.replace(/^status:.*$/m, status));
    if (blocked && reason.startsWith('intent gap')) {
      // As the skill's intent-gap HALT: the attempted change saved as a patch beside the plan, the code reverted.
      rmSync(inside, { force: true });
      const file = `src/fix-${ref}.txt`;
      writeFileSync(plan.replace(/\.md$/, '.patch'), `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n+Fixed ${ref} by the saved patch.\n`);
    }
  }
  const hooks = process.env.FAKE_ACP_BUILD_HOOKS;
  if (hooks) {
    mkdirSync(join(cwd, '.husky'), { recursive: true });
    for (const hook of ['pre-commit', 'commit-msg', 'post-merge', 'post-commit', 'post-checkout', 'pre-merge-commit']) {
      const file = join(cwd, '.husky', hook);
      writeFileSync(file, `#!/bin/sh\ntouch "${join(hooks, hook)}"\n`);
      chmodSync(file, 0o755);
    }
  }
  try {
    const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${join(cwd, '.no-hooks')}`, '-c', 'user.name=Fake Agent', '-c', 'user.email=fake@example.com', ...args], { cwd, stdio: 'ignore' });
    git('add', '-A');
    git('commit', '--no-verify', '-m', `Build ${ref}`);
  } catch {
    await say(client, sessionId, 'The commit failed. ');
  }
  await say(client, sessionId, `${blocked ? 'Blocked' : 'Built'} ${ref}.`);
  return { stopReason: 'end_turn' };
}
