/**
 * The lessons flow over REST on a real git repo (epic 7, story 7.5), with the
 * fake agent: a next step opens a planning session on the retrospective file
 * (the fake agent edits AGENTS.md), and Save the lessons makes one local
 * commit holding only AGENTS.md and the retrospective, leaving every other
 * change where it was; a repeat answers nothing_to_save, a merge in progress
 * checkout_busy, a missing AGENTS.md agents_file_missing; a worktree created
 * after the commit carries the pitfall; with Retrospectives off or the
 * project untrusted the routes refuse first, and nothing is committed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBmadCatalog, createMemoryTicketStore } from '@ogden-agents/adapters';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  FEATURE_OFF_MESSAGE,
  LESSONS_CHECKOUT_BUSY_MESSAGE,
  LESSONS_NO_AGENTS_FILE_MESSAGE,
  LOOK_BACK_NO_RETROSPECTIVE_MESSAGE,
  LOOK_BACK_STEP_NOT_OFFERED_MESSAGE,
  NOTHING_TO_SAVE_MESSAGE,
  SaveLessonsResponse,
  SessionResponse,
  WorkspaceResponse,
  type BmadPiece,
  type SessionId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createRetrospectiveRepo, RETRO_EPIC, RETRO_EPIC_FOLDER, RETRO_FILE, RETRO_PITFALL, retrospectiveText } from '../../../tests/fixtures/retrospective-repo.js';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const errorOf = async (reply: Response) => ApiErrorBody.parse(await reply.json()).error;
const userMessagesOf = (server: TestServer, sessionId: SessionId) =>
  server.core.events.readAfter(0).flatMap((e) => (e.streamId === sessionId && e.type === 'session.message_completed' && e.payload.role === 'user' ? [e.payload.content] : []));

async function setup({ pieces = ['board', 'retrospectives'], trust = true, agentsFile = true, retrospective = true }: { pieces?: BmadPiece[]; trust?: boolean; agentsFile?: boolean; retrospective?: boolean } = {}) {
  const repo = createRetrospectiveRepo({ agentsFile });
  removeAfterTest(repo.path);
  const real = realpathSync.native(repo.path);
  const ticketStore = createMemoryTicketStore({ repos: { [real]: { tickets: [], folder: 'initiative-demo', epics: [{ slug: RETRO_EPIC, id: 1, status: 'done', after: [], blocks: [] }] } } });
  const bmadCatalog = createMemoryBmadCatalog(
    { [real]: { hasBmad: true, hasOutput: true } },
    {
      [real]: [
        { name: 'bmad-retrospective', description: 'Look back.', scope: 'epic' as const, nexts: [{ skill: 'bmad-project-context', label: 'Add the lessons to AGENTS.md' }] },
        { name: 'bmad-project-context', description: 'Keep AGENTS.md current.' },
        { name: 'bmad-spec', description: 'Spec.' },
      ],
    },
    {
      setup: { [real]: { state: 'current', outputFolder: '_bmad-output', bundledVersion: '7.0.0', installedVersion: '7.0.0', problems: [] } },
      // The board reads the retrospective through the catalog: it is there once the look-back wrote it (the file itself is the repo's).
      documents: { [real]: retrospective ? { [RETRO_FILE]: retrospectiveText('accepted-with-open-items') } : {} },
    },
  );
  const server = await startTestServer({ ticketStore, bmadCatalog });
  const tab = await signIn(server);
  const { workspace } = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json());
  if (pieces.length > 0) expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id }), { bmadPieces: pieces })).status).toBe(200);
  if (trust) expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId: workspace.id }))).status).toBe(200);
  const wsId = workspace.id;
  return {
    repo,
    server,
    tab,
    wsId,
    step: (skill: string, epic = RETRO_EPIC) => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceRetrospectiveSessions, { wsId, epic }), { skill }),
    save: (epic = RETRO_EPIC) => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceRetrospectiveSave, { wsId, epic })),
  };
}

/** What the look-back and the lessons session leave in the repo: the retrospective (new) and the pitfall in AGENTS.md. */
function leaveLessons(repoPath: string) {
  mkdirSync(join(repoPath, RETRO_EPIC_FOLDER), { recursive: true });
  writeFileSync(join(repoPath, RETRO_FILE), retrospectiveText('accepted-with-open-items'));
  writeFileSync(join(repoPath, 'AGENTS.md'), `# Project instructions\n\n- Keep it small.\n- ${RETRO_PITFALL}\n`);
}

describe('a retrospective\'s next step over REST (story 7.5)', () => {
  it('opens a planning session on the retrospective file, and the fake agent edits AGENTS.md', async () => {
    const t = await setup();
    const reply = await t.step('bmad-project-context');
    expect(reply.status).toBe(201);
    const { session } = SessionResponse.parse(await reply.json());
    expect(session.kind).toBe('planning');
    expect(userMessagesOf(t.server, session.id)).toEqual([`/bmad-project-context ${RETRO_FILE}`]);
    await waitFor(() => readFileSync(join(t.repo.path, 'AGENTS.md'), 'utf8').includes(RETRO_PITFALL), 'the lessons in AGENTS.md');
  });

  it('refuses a skill the retrospective does not offer (404), and with Retrospectives off or untrusted, before anything runs', async () => {
    const t = await setup();
    const notOffered = await t.step('bmad-spec');
    expect(notOffered.status).toBe(404);
    expect(await errorOf(notOffered)).toEqual({ code: 'not_found', message: LOOK_BACK_STEP_NOT_OFFERED_MESSAGE });
    expect(t.server.core.entities.listSessions(t.wsId)).toEqual([]);

    const off = await setup({ pieces: ['board'] });
    const refused = await off.step('bmad-project-context');
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toEqual({ code: 'feature_off', message: FEATURE_OFF_MESSAGE });
    const untrusted = await setup({ trust: false });
    expect((await errorOf(await untrusted.step('bmad-project-context'))).code).toBe('scripts_not_trusted');
  });
});

describe('Save the lessons for later builds over REST (story 7.5)', () => {
  it('makes one local commit of exactly AGENTS.md and the retrospective, leaves other changes, and a later worktree carries the pitfall', async () => {
    const t = await setup();
    leaveLessons(t.repo.path);
    writeFileSync(join(t.repo.path, 'mine.txt'), 'my own change\n');
    writeFileSync(join(t.repo.path, 'README.md'), '# changed\n');
    t.repo.git('add', 'README.md');
    const before = t.repo.git('rev-parse', 'HEAD').trim();
    const reply = await t.save();
    expect(reply.status).toBe(200);
    const saved = SaveLessonsResponse.parse(await reply.json());
    expect(saved.paths).toEqual(['AGENTS.md', RETRO_FILE]);
    expect(t.repo.git('rev-list', '--count', `${before}..HEAD`).trim()).toBe('1');
    expect(t.repo.git('rev-parse', 'HEAD').trim()).toBe(saved.revision);
    expect(t.repo.git('show', '--name-only', '--pretty=format:', 'HEAD').split('\n').filter(Boolean).sort()).toEqual(['AGENTS.md', RETRO_FILE].sort());
    // Everything else the user had stays as it was: the staged README and the untracked file.
    expect(t.repo.git('diff', '--cached', '--name-only').trim()).toBe('README.md');
    expect(t.repo.git('status', '--porcelain').split('\n').filter(Boolean).sort()).toEqual(['?? mine.txt', 'M  README.md'].sort());
    // Local only: no remote was touched (there is none), and a worktree from this commit holds the pitfall.
    const worktree = mkdtempSync(join(tmpdir(), 'ogden-agents-lessons-wt-'));
    rmSync(worktree, { recursive: true, force: true });
    t.repo.git('worktree', 'add', '-q', worktree, 'HEAD');
    try {
      expect(readFileSync(join(worktree, 'AGENTS.md'), 'utf8')).toContain(RETRO_PITFALL);
      expect(existsSync(join(worktree, RETRO_FILE))).toBe(true);
    } finally {
      t.repo.git('worktree', 'remove', '--force', worktree);
    }
    // A repeat has nothing to save.
    const again = await t.save();
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toEqual({ code: 'nothing_to_save', message: NOTHING_TO_SAVE_MESSAGE });
  });

  it('refuses during a merge in progress (checkout_busy) and commits nothing', async () => {
    const t = await setup();
    leaveLessons(t.repo.path);
    writeFileSync(join(t.repo.path, '.git', 'MERGE_HEAD'), `${t.repo.git('rev-parse', 'HEAD').trim()}\n`);
    const before = t.repo.git('rev-parse', 'HEAD').trim();
    const reply = await t.save();
    expect(reply.status).toBe(409);
    expect(await errorOf(reply)).toEqual({ code: 'checkout_busy', message: LESSONS_CHECKOUT_BUSY_MESSAGE });
    expect(t.repo.git('rev-parse', 'HEAD').trim()).toBe(before);
  });

  it('refuses a project with no AGENTS.md (agents_file_missing), and with Retrospectives off or untrusted, before any git', async () => {
    const t = await setup({ agentsFile: false });
    mkdirSync(join(t.repo.path, RETRO_EPIC_FOLDER), { recursive: true });
    writeFileSync(join(t.repo.path, RETRO_FILE), retrospectiveText('accepted'));
    const missing = await t.save();
    expect(missing.status).toBe(409);
    expect(await errorOf(missing)).toEqual({ code: 'agents_file_missing', message: LESSONS_NO_AGENTS_FILE_MESSAGE });

    const off = await setup({ pieces: ['board'] });
    leaveLessons(off.repo.path);
    const before = off.repo.git('rev-parse', 'HEAD').trim();
    expect((await errorOf(await off.save())).code).toBe('feature_off');
    const untrusted = await setup({ trust: false });
    leaveLessons(untrusted.repo.path);
    expect((await errorOf(await untrusted.save())).code).toBe('scripts_not_trusted');
    expect(off.repo.git('rev-parse', 'HEAD').trim()).toBe(before);
  });

  it('an epic with no retrospective yet says so (404), an epic the board lacks is not found, and a malformed one is 400', async () => {
    const none = await setup({ retrospective: false });
    const noRetro = await none.save();
    expect(noRetro.status).toBe(404);
    expect(await errorOf(noRetro)).toEqual({ code: 'not_found', message: LOOK_BACK_NO_RETROSPECTIVE_MESSAGE });
    expect((await none.step('bmad-project-context')).status).toBe(404);
    const t = await setup();
    expect((await t.save('epic-nine')).status).toBe(404);
    expect((await t.save('-x')).status).toBe(400);
  });
});
