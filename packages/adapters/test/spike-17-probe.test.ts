// TEMPORARY spike 17.1 probe (removed before review). Runs the shipped session code against the
// fake personalities of Codex, Grok and Antigravity and prints `PROBE17 {json}` lines.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideBuildPermission, nodePathNormalizer, PROTECTED_PATHS, type AgentEvent, type AgentPermissionRequest, type AgentSession } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createAntigravityAgent, createCodexAgent, createGrokAgent } from '../src/index.js';

const fx = (name: string) => join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', name);
const dirs: string[] = [];
const sessions: AgentSession[] = [];
// The long form of the path: a runner's temp folder is an 8.3 short name, which the build policy refuses by design.
const tmp = (p: string) => { const d = realpathSync.native(mkdtempSync(join(tmpdir(), p))); dirs.push(d); return d; };
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const log = (o: unknown) => console.log('PROBE17 ' + JSON.stringify(o));

const AGENTS = [
  { id: 'codex', env: { CODEX_API_KEY: 'sk-proj-' + 'K'.repeat(40) + '4321', CODEX_HOME: '' }, make: () => createCodexAgent({ dataDir: tmp('p17-d-'), server: () => ({ command: process.execPath, args: [fx('fake-codex.mjs')] }) }) },
  { id: 'grok', env: { XAI_API_KEY: 'xai-' + 'K'.repeat(60) + '4321', GROK_HOME: '' }, make: () => createGrokAgent({ dataDir: tmp('p17-d-'), server: () => ({ command: process.execPath, args: [fx('fake-grok.mjs')] }) }) },
  { id: 'antigravity', env: { GEMINI_API_KEY: 'AIza' + 'K'.repeat(31) + '9876' }, make: () => createAntigravityAgent({ dataDir: tmp('p17-d-'), server: () => ({ command: process.execPath, args: [fx('fake-antigravity.mjs'), '--uid='] }) }) },
] as const;

const sandbox = (wt: string) => ({ kind: 'probe', writableRoots: [wt], deniedPaths: [join(wt, '.git', 'hooks')], deniedReads: [], allowedReads: [wt] });

describe('spike 17.1: the shipped build session against each personality', () => {
  for (const a of AGENTS) {
    it(`${a.id}: a sandboxed build session is refused today (fail closed)`, async () => {
      const agent = a.make();
      const env: Record<string, string> = { PATH: process.env.PATH ?? '', ...a.env };
      for (const k of Object.keys(env)) if (env[k] === '') env[k] = tmp('p17-home-');
      const wt = tmp('p17-wt-');
      const failure = await agent.startSession({ cwd: wt, env, sandbox: sandbox(wt) }).catch((e: unknown) => e);
      log({ agent: a.id, sandboxedStart: (failure as { code?: string }).code ?? 'started', message: (failure as Error).message });
      expect(failure).toMatchObject({ code: 'agent_unavailable' });
    });

    it(`${a.id}: core's build policy sees the real paths and its answer reaches the agent`, async () => {
      const agent = a.make();
      const env: Record<string, string> = { PATH: process.env.PATH ?? '', ...a.env };
      for (const k of Object.keys(env)) if (env[k] === '') env[k] = tmp('p17-home-');
      const wt = tmp('p17-wt-');
      mkdirSync(join(wt, 'src'), { recursive: true });
      mkdirSync(join(wt, '.claude'), { recursive: true });
      const outside = tmp('p17-out-');
      symlinkSync(outside, join(wt, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
      const scope = { worktree: wt, gitWritable: [] as string[], protectedPaths: PROTECTED_PATHS };
      const fs = nodePathNormalizer();
      const seen: Array<{ kind?: string | undefined; rawPaths?: readonly string[] | undefined; outcome: string }> = [];
      const session = await agent.startSession({
        cwd: wt,
        env,
        permissionMode: 'ask',
        protectedPaths: PROTECTED_PATHS,
        onPermissionRequest: async (request: AgentPermissionRequest) => {
          const decision = decideBuildPermission(request, scope, fs);
          seen.push({ kind: request.kind, rawPaths: request.rawPaths, outcome: decision.outcome });
          return decision;
        },
      });
      sessions.push(session);
      const events: AgentEvent[] = [];
      session.onEvent((e) => events.push(e));
      const cases: Array<[string, string, string]> = [
        ['inside', join(wt, 'src', 'a.ts'), 'allow_once'],
        ['protected folder', join(wt, '.claude', 'x.md'), 'deny'],
        ['protected file', join(wt, 'AGENTS.md'), 'deny'],
        ['dotdot', join(wt, '..', 'escape.txt'), 'deny'],
        ['symlink out', join(wt, 'link', 'e.txt'), 'deny'],
      ];
      const results: Array<{ case: string; outcome: string; reply: string }> = [];
      for (const [name, path, want] of cases) {
        events.length = 0;
        await session.prompt(`permission-edit ${path}`);
        const reply = events.flatMap((e) => (e.type === 'message_chunk' ? [e.text] : [])).join('');
        const outcome = seen.at(-1)?.outcome ?? 'none';
        results.push({ case: name, outcome, reply });
        expect(outcome, name).toBe(want);
        expect(reply.startsWith(want === 'deny' ? 'Denied' : 'Edited'), `${name}: ${reply}`).toBe(true);
      }
      log({ agent: a.id, skillInvocation: agent.skillInvocation('bmad-build-auto', 'ticket 1.1'), modes: agent.permissionModes, results });
    });
  }
});
