/**
 * A port per worktree on the real server (epic 27, 27.7; CAP-35, AD-38),
 * with real git, the fake ACP agent and a real `node setup.js`: in a
 * trusted project with a confirmed setup command, two worktree chats
 * started at once each get their own port, each agent reads a different
 * `PORT`, and each copy holds the setup's file naming its own port.
 * `GET …/location` answers the port and the setup run's state; the run's
 * output is the Problems run route's. A this-folder chat's agent has no
 * `PORT`. The probe is the memory one (the real one is the adapters'
 * test), so parallel test files never race for a port.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES, apiPath, ProjectCommandRunDetail, SessionLocationResponse, SessionResponse, WORKTREE_PORT_RANGE, WorkspaceResponse, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { removeAfterTest, signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', `core.hooksPath=${join(cwd, '.none')}`, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Writes `port.txt` with the PORT it was given, in the folder it runs in. */
const SETUP = "require('node:fs').writeFileSync('port.txt', String(process.env.PORT ?? 'none')); console.log('set up on ' + process.env.PORT);\n";

/** A repo on `main` with `setup.js` committed, so every copy has it. */
function project(): string {
  const repo = removeAfterTest(realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-ports-repo-'))));
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  writeFileSync(join(repo, 'setup.js'), SETUP);
  writeFileSync(join(repo, '.gitignore'), 'port.txt\n');
  git(repo, 'init', '-q', '--initial-branch=main');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  return repo;
}

const agentReplies = (server: TestServer, sessionId: SessionId): string[] =>
  server.core.events.readAfter(0).flatMap((event) => (event.type === 'session.message_completed' && event.streamId === sessionId && event.payload.role === 'agent' ? [event.payload.content] : []));

async function open() {
  const server = await startTestServer({ dataDir: tempDataDir() });
  const tab = await signIn(server);
  const repo = project();
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const chat = async (body: unknown = {}) => {
    const created = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), body);
    expect(created.status).toBe(201);
    return SessionResponse.parse(await created.json()).session;
  };
  const send = async (sesId: SessionId, text: string) => {
    const before = agentReplies(server, sesId).length;
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text })).status).toBe(202);
    await waitFor(() => agentReplies(server, sesId).length > before, 'the reply', 20_000);
    await waitFor(() => server.core.entities.getSession(sesId)?.state === 'idle', 'idle', 20_000);
    return agentReplies(server, sesId).at(-1)!;
  };
  const location = async (sesId: string) => SessionLocationResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.sessionLocation, { wsId, sesId }))).json()).location;
  return { server, tab, wsId, repo, chat, send, location };
}

describe('a port per worktree on the real server (27.7)', () => {
  it('gives two worktree chats started at once their own PORT, and runs the setup in each copy with it', async () => {
    const kit = await open();
    await kit.server.core.bmadScriptTrust.trustScripts(kit.wsId);
    const saved = await request(kit.server, kit.tab, 'PUT', apiPath(API_ROUTES.workspaceProjectCommands, { wsId: kit.wsId }), {
      commands: [{ id: 'setup', label: 'Worktree setup', command: 'node setup.js', source: 'settings', confirmedText: 'node setup.js' }],
    });
    expect(saved.status).toBe(200);

    const [a, b] = await Promise.all([kit.chat({ location: 'worktree' }), kit.chat({ location: 'worktree' })]);
    const ports = [kit.server.core.worktreePorts!.portOf(a.id), kit.server.core.worktreePorts!.portOf(b.id)];
    expect([...ports].sort()).toEqual([WORKTREE_PORT_RANGE.first, WORKTREE_PORT_RANGE.first + 1]);

    // Each agent reads its own PORT (the fake says its last four digits).
    expect(await kit.send(a.id, 'has-env PORT')).toBe(`PORT=set ending ${String(ports[0]).slice(-4)}`);
    expect(await kit.send(b.id, 'has-env PORT')).toBe(`PORT=set ending ${String(ports[1]).slice(-4)}`);

    // Each copy holds the setup's file naming its own port; the project folder none.
    for (const [session, port] of [[a, ports[0]], [b, ports[1]]] as const) {
      await waitFor(() => existsSync(join(session.worktreePath!, 'port.txt')), 'the setup file', 20_000);
      expect(readFileSync(join(session.worktreePath!, 'port.txt'), 'utf8')).toBe(String(port));
    }
    expect(existsSync(join(kit.repo, 'port.txt'))).toBe(false);

    // The Location: the port and the setup's state; its output through the run route.
    await waitFor(async () => {
      const now = await kit.location(a.id);
      return now.kind === 'worktree' && now.setup?.state === 'passed';
    }, 'the setup to pass', 20_000);
    const shown = await kit.location(a.id);
    expect(shown).toMatchObject({ kind: 'worktree', port: ports[0], setup: { state: 'passed' }, putAway: false });
    const runId = shown.kind === 'worktree' ? shown.setup!.runId : '';
    const run = ProjectCommandRunDetail.parse(await (await request(kit.server, kit.tab, 'GET', apiPath(API_ROUTES.workspaceProjectCommandRun, { wsId: kit.wsId, runId }))).json());
    expect(run.output).toContain(`set up on ${ports[0]}`);

    // A chat in this folder: no PORT.
    const plain = await kit.chat();
    expect(await kit.send(plain.id, 'has-env PORT')).toBe('PORT=unset');
    expect(await kit.location(plain.id)).toEqual({ kind: 'this_folder' });
    // Problems never runs the setup command.
    expect((await request(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.workspaceProjectCommandRuns, { wsId: kit.wsId, commandId: 'setup' }), {})).status).toBe(409);
    // Ids, ports and states only in the log.
    const logged = JSON.stringify(kit.server.core.events.readAfter(0).filter((event) => event.type.startsWith('session.port_') || event.type.startsWith('workspace.project_command')));
    expect(logged).not.toContain(a.worktreePath!);
    expect(logged).not.toContain('node setup.js');
  });

  it('runs nothing in an untrusted project; the chat still gets its port', async () => {
    const kit = await open();
    const session = await kit.chat({ location: 'worktree' });
    expect(await kit.location(session.id)).toMatchObject({ kind: 'worktree', port: WORKTREE_PORT_RANGE.first, setup: null });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(existsSync(join(session.worktreePath!, 'port.txt'))).toBe(false);
  });
});
