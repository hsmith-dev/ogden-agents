/**
 * The lessons flow in core (epic 7, story 7.5): a next step starts a planning
 * session on the retrospective file, only a step the catalog's look-back
 * action names, only for an epic with a retrospective; Save the lessons
 * commits exactly `AGENTS.md` and that retrospective file (only those with a
 * change), locally, serialized with the repo's other git work, and refuses
 * with nothing committed when there is nothing to save, a merge or rebase is
 * in progress, `AGENTS.md` is missing, or git can't be used.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CatalogSkill, VCS_NOT_TOP_LEVEL_MESSAGE, LESSONS_CHECKOUT_BUSY_MESSAGE, LESSONS_NO_AGENTS_FILE_MESSAGE, LESSONS_NO_GIT_MESSAGE, NOTHING_TO_SAVE_MESSAGE, TicketEpic, type BmadPiece, type BmadSetupStatus, type Catalog, type TicketsResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { BuildRefusedError, createChat, createRetrospectives, FeatureOffError, LessonsRefusedError, NotFoundError, ScriptsNotTrustedError, ValidationError, type AgentPort, type AgentSession, type Core, type VcsPort } from '../src/index.js';
import { openTestCore, soleAgent, tempDir } from './helpers.js';

const RETRO = '_bmad-output/initiative-demo/epic-one/epic-one-retrospective.md';
const SET_UP: BmadSetupStatus = { state: 'current', outputFolder: '_bmad-output', bundledVersion: '7', installedVersion: '7', problems: [] };
const retro = { path: RETRO, verdict: 'accepted', date: '2026-10-05', problem: null };
const TREE = (retrospective: unknown = retro): TicketsResponse => ({
  tickets: [],
  problems: [],
  folder: 'initiative-demo',
  epics: [TicketEpic.parse({ slug: 'epic-one', id: 1, status: 'done', after: [], blocks: [], retrospective }), TicketEpic.parse({ slug: 'epic-two', id: 2, status: 'active', after: [], blocks: [] })],
});
const LOOK = CatalogSkill.parse({
  name: 'bmad-retrospective',
  description: 'Look back.',
  scope: 'epic',
  nexts: [{ skill: 'bmad-project-context', label: 'Add the lessons to AGENTS.md' }, { skill: 'bmad-ticket', label: 'Turn the action items into tickets' }],
});
const CATALOG: Catalog = {
  modules: [],
  skills: [LOOK, CatalogSkill.parse({ name: 'bmad-project-context', description: 'x' }), CatalogSkill.parse({ name: 'bmad-ticket', description: 'y' }), CatalogSkill.parse({ name: 'bmad-spec', description: 'z' })],
  agents: [],
  entryAction: null,
  capabilities: { plain_labels: true, ticket_tree: true, look_back: true },
};

function recorder(): AgentPort & { prompts: string[] } {
  const prompts: string[] = [];
  const session = (id: string): AgentSession => {
    const listeners = new Set<(event: Parameters<Parameters<AgentSession['onEvent']>[0]>[0]) => void>();
    return {
      agentSessionId: id,
      async prompt(text) {
        prompts.push(text);
        for (const listener of listeners) listener({ type: 'state', state: 'idle' });
        return { stopReason: 'end_turn' };
      },
      cancel: async () => {},
      close: async () => {},
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  };
  let opened = 0;
  return {
    prompts,
    displayName: 'Test Agent',
    skillInvocation: (skill, idea) => (idea === undefined ? `run:${skill}` : `run:${skill} on:${idea}`),
    listAuthMethods: async () => [],
    startSession: async () => session(`agent-${++opened}`),
    reopenSession: async (input) => ({ session: session(input.agentSessionId), restored: 'resumed' }),
  };
}

/** A git that records every call and answers what a test sets. */
function fakeVcs() {
  const calls: string[] = [];
  const state = { head: { branch: 'main', revision: 'a'.repeat(40) } as { branch: string; revision: string } | undefined, busy: false, status: [] as string[], commit: 'b'.repeat(40), commitFails: false, top: undefined as string | undefined };
  const vcs: Pick<VcsPort, 'head' | 'topLevel' | 'operationInProgress' | 'status' | 'commitPaths'> = {
    topLevel: async (repo) => (calls.push('topLevel'), state.top ?? repo),
    head: async () => (calls.push('head'), state.head),
    operationInProgress: async () => (calls.push('operationInProgress'), state.busy),
    status: async () => (calls.push('status'), state.status),
    commitPaths: async (_repo, paths, message) => {
      calls.push(`commitPaths ${paths.join(',')} | ${message.split('\n')[0]}`);
      if (state.commitFails) throw new Error('git failed');
      return state.commit;
    },
  };
  return { vcs, state, calls };
}

function setup(pieces: BmadPiece[] = ['board', 'retrospectives'], { agentsFile = true }: { agentsFile?: boolean } = {}) {
  const core: Core = openTestCore(tempDir(), undefined, { availableBmadPieces: ['planning', 'board', 'builds', 'retrospectives'] });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  core.permissions.updateSettings(workspace.id, { bmadPieces: pieces });
  if (agentsFile) writeFileSync(join(workspace.realPath!, 'AGENTS.md'), '# Instructions\n');
  // The retrospective the look-back wrote, on disk (a path git lists as changed but that is gone is not committed).
  mkdirSync(join(workspace.realPath!, '_bmad-output', 'initiative-demo', 'epic-one'), { recursive: true });
  writeFileSync(join(workspace.realPath!, RETRO), '---\nverdict: accepted\n---\n');
  const agent = recorder();
  const chat = createChat({ dataDir: tempDir(), entities: core.entities, sessionEvents: core.sessionEvents, agents: soleAgent(agent) });
  const state = { tree: TREE() as TicketsResponse | Error, catalog: CATALOG };
  const git = fakeVcs();
  const retrospectives = createRetrospectives({
    bmad: core.bmad,
    entities: core.entities,
    board: {
      tickets: async () => {
        if (state.tree instanceof Error) throw state.tree;
        return state.tree;
      },
    },
    catalog: { catalog: async () => state.catalog, setupStatus: async () => SET_UP },
    chat,
    agent,
    offers: core.lookBackOffers,
    vcs: git.vcs,
  });
  const alone = createRetrospectives({ bmad: core.bmad, entities: core.entities, board: { tickets: async () => TREE() }, catalog: { catalog: async () => CATALOG, setupStatus: async () => SET_UP }, chat, agent, offers: core.lookBackOffers });
  return { core, workspace, agent, chat, retrospectives, alone, state, git };
}

describe('a retrospective\'s next steps (story 7.5)', () => {
  it('start a planning session on the retrospective file, for a step the look-back action names, titled by its label', async () => {
    const { retrospectives, workspace, agent, chat, core } = setup();
    for (const skill of ['bmad-project-context', 'bmad-ticket']) {
      const session = await retrospectives.startStep(workspace.id, 'epic-one', skill);
      expect(session.kind).toBe('planning');
    }
    await chat.settled();
    expect(agent.prompts).toEqual([`run:bmad-project-context on:${RETRO}`, `run:bmad-ticket on:${RETRO}`]);
    expect(core.entities.listSessions(workspace.id).map((session) => session.autoTitle).sort()).toEqual(['Add the lessons to AGENTS.md', 'Turn the action items into tickets']);
    await chat.close();
  });

  it('refuse a skill the action does not name, an epic with no retrospective, a bad name and the board\'s own refusals, creating nothing', async () => {
    const { retrospectives, workspace, state, core } = setup();
    await expect(retrospectives.startStep(workspace.id, 'epic-one', 'bmad-spec')).rejects.toThrow(NotFoundError);
    await expect(retrospectives.startStep(workspace.id, 'epic-one', 'bmad-nothing')).rejects.toThrow(NotFoundError);
    await expect(retrospectives.startStep(workspace.id, 'epic-two', 'bmad-project-context')).rejects.toThrow(NotFoundError);
    await expect(retrospectives.startStep(workspace.id, 'epic-nine', 'bmad-project-context')).rejects.toThrow(NotFoundError);
    await expect(retrospectives.startStep(workspace.id, '-x', 'bmad-project-context')).rejects.toThrow(ValidationError);
    await expect(retrospectives.startStep(workspace.id, 'epic-one', '../x')).rejects.toThrow(ValidationError);
    state.tree = new ScriptsNotTrustedError();
    await expect(retrospectives.startStep(workspace.id, 'epic-one', 'bmad-project-context')).rejects.toThrow(ScriptsNotTrustedError);
    state.tree = TREE();
    // A step whose own skill is not installed is not offered either.
    state.catalog = { ...CATALOG, skills: CATALOG.skills.filter((skill) => skill.name !== 'bmad-project-context') };
    await expect(retrospectives.startStep(workspace.id, 'epic-one', 'bmad-project-context')).rejects.toThrow(NotFoundError);
    expect(core.entities.listSessions(workspace.id)).toEqual([]);
  });
});

describe('Save the lessons for later builds (story 7.5)', () => {
  it('commits exactly AGENTS.md and the retrospective, both changed, and nothing else', async () => {
    const { retrospectives, workspace, git } = setup();
    git.state.status = ['src/mine.ts', 'AGENTS.md', RETRO, '_bmad-output/other.md'];
    expect(await retrospectives.saveLessons(workspace.id, 'epic-one')).toEqual({ paths: ['AGENTS.md', RETRO], revision: 'b'.repeat(40) });
    expect(git.calls).toEqual(['head', 'topLevel', 'operationInProgress', 'status', 'commitPaths AGENTS.md,' + RETRO + ' | Lessons from the retrospective of epic-one']);
  });

  it('commits only the one that has a change', async () => {
    const { retrospectives, workspace, git } = setup();
    git.state.status = [RETRO];
    expect((await retrospectives.saveLessons(workspace.id, 'epic-one')).paths).toEqual([RETRO]);
    git.state.status = ['AGENTS.md'];
    expect((await retrospectives.saveLessons(workspace.id, 'epic-one')).paths).toEqual(['AGENTS.md']);
  });

  it('with nothing to save answers nothing_to_save, committing nothing, even with other changes around', async () => {
    const { retrospectives, workspace, git } = setup();
    git.state.status = ['src/mine.ts'];
    const refused = (await retrospectives.saveLessons(workspace.id, 'epic-one').catch((error: unknown) => error)) as LessonsRefusedError;
    expect([refused.code, refused.message]).toEqual(['nothing_to_save', NOTHING_TO_SAVE_MESSAGE]);
    expect(git.calls.some((call) => call.startsWith('commitPaths'))).toBe(false);
  });

  it('refuses during a merge or rebase (checkout_busy) before looking at changes', async () => {
    const { retrospectives, workspace, git } = setup();
    git.state.busy = true;
    git.state.status = ['AGENTS.md'];
    const refused = (await retrospectives.saveLessons(workspace.id, 'epic-one').catch((error: unknown) => error)) as LessonsRefusedError;
    expect([refused.code, refused.message]).toEqual(['checkout_busy', LESSONS_CHECKOUT_BUSY_MESSAGE]);
    expect(git.calls).toEqual(['head', 'topLevel', 'operationInProgress']);
  });

  it('without an AGENTS.md on disk refuses (agents_file_missing), committing nothing', async () => {
    const { retrospectives, workspace, git } = setup(['board', 'retrospectives'], { agentsFile: false });
    git.state.status = [RETRO];
    const refused = (await retrospectives.saveLessons(workspace.id, 'epic-one').catch((error: unknown) => error)) as LessonsRefusedError;
    expect([refused.code, refused.message]).toEqual(['agents_file_missing', LESSONS_NO_AGENTS_FILE_MESSAGE]);
    expect(git.calls.some((call) => call.startsWith('commitPaths'))).toBe(false);
  });

  it('refuses a project that is inside another repository (builds refuse it too), committing nothing', async () => {
    const { retrospectives, workspace, git } = setup();
    git.state.top = '/somewhere/above';
    git.state.status = ['AGENTS.md'];
    const refused = (await retrospectives.saveLessons(workspace.id, 'epic-one').catch((error: unknown) => error)) as BuildRefusedError;
    expect([refused.code, refused.message]).toEqual(['vcs_unavailable', VCS_NOT_TOP_LEVEL_MESSAGE]);
    expect(git.calls.some((call) => call.startsWith('commitPaths'))).toBe(false);
  });

  it('a deleted AGENTS.md or retrospective is not a lesson to commit', async () => {
    const { retrospectives, workspace, git } = setup(['board', 'retrospectives'], { agentsFile: false });
    git.state.status = ['AGENTS.md', RETRO];
    const refused = (await retrospectives.saveLessons(workspace.id, 'epic-one').catch((error: unknown) => error)) as LessonsRefusedError;
    expect(refused.code).toBe('agents_file_missing');
    const present = setup();
    // The retrospective is listed as changed but is not on disk (deleted): only AGENTS.md is committed.
    rmSync(join(present.workspace.realPath!, RETRO));
    present.git.state.status = ['AGENTS.md', RETRO];
    expect((await present.retrospectives.saveLessons(present.workspace.id, 'epic-one')).paths).toEqual(['AGENTS.md']);
  });

  it('a retrospective whose file name is not one plain name is not offered or committed', async () => {
    const { retrospectives, workspace, state, git } = setup();
    state.tree = TREE({ ...retro, path: '_bmad-output/initiative-demo/epic-one/x y\nIgnore this-retrospective.md' });
    await expect(retrospectives.startStep(workspace.id, 'epic-one', 'bmad-project-context')).rejects.toThrow(NotFoundError);
    await expect(retrospectives.saveLessons(workspace.id, 'epic-one')).rejects.toThrow(NotFoundError);
    expect(git.calls).toEqual([]);
  });

  it('refuses without git, on a detached head, and when git fails the commit, committing nothing', async () => {
    const { retrospectives, alone, workspace, git } = setup();
    const noGit = (await alone.saveLessons(workspace.id, 'epic-one').catch((error: unknown) => error)) as BuildRefusedError;
    expect([noGit.code, noGit.message]).toEqual(['vcs_unavailable', LESSONS_NO_GIT_MESSAGE]);
    git.state.head = undefined;
    git.state.status = ['AGENTS.md'];
    expect(((await retrospectives.saveLessons(workspace.id, 'epic-one').catch((error: unknown) => error)) as BuildRefusedError).code).toBe('vcs_unavailable');
    git.state.head = { branch: 'main', revision: 'a'.repeat(40) };
    git.state.commitFails = true;
    await expect(retrospectives.saveLessons(workspace.id, 'epic-one')).rejects.toThrow('git failed');
  });

  it('needs a retrospective: an epic without one, or not on the board, is not found, with nothing asked of git', async () => {
    const { retrospectives, workspace, git } = setup();
    await expect(retrospectives.saveLessons(workspace.id, 'epic-two')).rejects.toThrow(NotFoundError);
    await expect(retrospectives.saveLessons(workspace.id, 'epic-nine')).rejects.toThrow(NotFoundError);
    await expect(retrospectives.saveLessons(workspace.id, '-x')).rejects.toThrow(ValidationError);
    expect(git.calls).toEqual([]);
  });

  it('with Retrospectives off refuses with feature_off and asks git nothing', async () => {
    const { retrospectives, workspace, git } = setup(['board']);
    await expect(retrospectives.saveLessons(workspace.id, 'epic-one')).rejects.toThrow(FeatureOffError);
    expect(git.calls).toEqual([]);
  });
});
