/**
 * Looking back on an epic in core (story 7.1, the tracer): the use-case
 * calls the Retrospectives guard first, so a project with it off is never
 * read; the epic must be one the board has (the board's own guards, the
 * script trust among them, run first and their refusals pass through); the
 * epic's folder is `<output folder>/<initiative folder>/<epic>`, built from
 * safe names only; the skill must be in the catalog; a look-back is a chat
 * session of kind `planning` whose first message is the agent's invocation
 * of the skill on the epic's folder.
 */
import { CatalogSkill, TicketEpic, type BmadPiece, type BmadSetupStatus, type Catalog, type TicketsResponse, type WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  createChat,
  createRetrospectives,
  FeatureOffError,
  NotFoundError,
  ScriptsNotTrustedError,
  ValidationError,
  type AgentPort,
  type AgentSession,
  type BmadCatalogPort,
  type Core,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir, unusedCatalogParts } from './helpers.js';

const UNKNOWN = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId;
const SKILL = 'bmad-retrospective';
const SKILLS = [CatalogSkill.parse({ name: SKILL, description: 'Look back.' }), CatalogSkill.parse({ name: 'bmad-spec', description: 'Write a spec.' })];
const CATALOG: Catalog = { modules: [], skills: SKILLS, agents: [], entryAction: null, capabilities: { plain_labels: true, ticket_tree: true } };
const SET_UP: BmadSetupStatus = { state: 'current', outputFolder: '_bmad-output', bundledVersion: '7.0.0', installedVersion: '7.0.0', problems: [] };
const epic = (slug: string) => TicketEpic.parse({ slug, id: null, status: 'active', after: [], blocks: [] });
const TREE: TicketsResponse = { tickets: [], problems: [], folder: 'initiative-demo', epics: [epic('epic-one'), epic('epic-two')] };

const PIECES: BmadPiece[] = ['board', 'builds', 'retrospectives'];

/** An agent whose sessions record every prompt and answer at once. */
function promptRecorder(): AgentPort & { prompts: string[] } {
  const prompts: string[] = [];
  const session = (id: string): AgentSession => {
    const listeners = new Set<(event: Parameters<Parameters<AgentSession['onEvent']>[0]>[0]) => void>();
    return {
      agentSessionId: id,
      async prompt(text) {
        prompts.push(text);
        for (const listener of listeners) listener({ type: 'message_chunk', text: 'ok' });
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
    skillInvocation: (skill, idea) => (idea === undefined ? `run-skill:${skill}` : `run-skill:${skill} on:${idea}`),
    listAuthMethods: async () => [],
    startSession: async () => session(`agent-${++opened}`),
    reopenSession: async (input) => ({ session: session(input.agentSessionId), restored: 'resumed' }),
  };
}

function setup(pieces: BmadPiece[] = PIECES) {
  const core: Core = openTestCore(tempDir(), undefined, { availableBmadPieces: ['planning', 'board', 'builds', 'retrospectives'] });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  if (pieces.length > 0) core.permissions.updateSettings(workspace.id, { bmadPieces: pieces });
  const state = { tree: TREE as TicketsResponse | Error, catalog: CATALOG, status: SET_UP, onCatalogRead: () => {} };
  const reads: string[] = [];
  const catalog: Pick<BmadCatalogPort, 'catalog' | 'setupStatus'> = {
    catalog: async (repoPath) => {
      reads.push(repoPath);
      state.onCatalogRead();
      return state.catalog;
    },
    setupStatus: async () => state.status,
  };
  const board = {
    tickets: async () => {
      reads.push('tickets');
      if (state.tree instanceof Error) throw state.tree;
      return state.tree;
    },
  };
  const agent = promptRecorder();
  const chat = createChat({ dataDir: tempDir(), entities: core.entities, sessionEvents: core.sessionEvents, agents: soleAgent(agent) });
  const retrospectives = createRetrospectives({ bmad: core.bmad, entities: core.entities, board, catalog, chat, agent, skill: SKILL });
  return { core, workspace, retrospectives, state, reads, chat, agent };
}

describe('look back on an epic (story 7.1)', () => {
  it('starts a planning session whose first message invokes the skill on the epic folder', async () => {
    const { retrospectives, workspace, chat, agent } = setup();
    const session = await retrospectives.lookBack(workspace.id, 'epic-two');
    expect(session.kind).toBe('planning');
    expect(session.autoTitle).toBe('Look back on this epic, epic-two');
    await chat.settled();
    expect(agent.prompts).toEqual([`run-skill:${SKILL} on:_bmad-output/initiative-demo/epic-two`]);
    await chat.close();
  });

  it('with Retrospectives off, refuses with feature_off and reads nothing', async () => {
    const { retrospectives, workspace, reads, core } = setup(['board']);
    await expect(retrospectives.lookBack(workspace.id, 'epic-one')).rejects.toThrow(FeatureOffError);
    expect(reads).toEqual([]);
    expect(core.entities.listSessions(workspace.id)).toEqual([]);
  });

  it('Planning on does not stand in for Retrospectives', async () => {
    const { retrospectives, workspace, reads } = setup(['planning', 'board']);
    await expect(retrospectives.lookBack(workspace.id, 'epic-one')).rejects.toThrow(FeatureOffError);
    expect(reads).toEqual([]);
  });

  it('an unknown workspace is not found', async () => {
    const { retrospectives } = setup();
    await expect(retrospectives.lookBack(UNKNOWN, 'epic-one')).rejects.toThrow(NotFoundError);
  });

  it('a malformed epic name is invalid and an epic the board lacks is not found; neither creates a session', async () => {
    const { retrospectives, workspace, core, reads } = setup();
    for (const bad of ['', '../x', 'a/b', '-x', '.hidden', 'a'.repeat(129), 'two words']) {
      await expect(retrospectives.lookBack(workspace.id, bad), JSON.stringify(bad)).rejects.toThrow(ValidationError);
    }
    expect(reads).toEqual([]);
    await expect(retrospectives.lookBack(workspace.id, 'epic-three')).rejects.toThrow(NotFoundError);
    expect(core.entities.listSessions(workspace.id)).toEqual([]);
  });

  it('the board\'s refusals pass through, creating nothing', async () => {
    const { retrospectives, workspace, state, core, chat } = setup();
    state.tree = new ScriptsNotTrustedError();
    await expect(retrospectives.lookBack(workspace.id, 'epic-one')).rejects.toThrow(ScriptsNotTrustedError);
    expect(core.entities.listSessions(workspace.id)).toEqual([]);
    await chat.close();
  });

  it('an initiative folder or output folder that is not one safe name starts nothing', async () => {
    const { retrospectives, workspace, state, core } = setup();
    for (const folder of ['../x', 'a/b', '', null]) {
      state.tree = { ...TREE, folder };
      await expect(retrospectives.lookBack(workspace.id, 'epic-one'), String(folder)).rejects.toThrow(NotFoundError);
    }
    state.tree = TREE;
    state.status = { ...SET_UP, outputFolder: null };
    await expect(retrospectives.lookBack(workspace.id, 'epic-one')).rejects.toThrow(NotFoundError);
    state.status = { ...SET_UP, outputFolder: '../out' };
    await expect(retrospectives.lookBack(workspace.id, 'epic-one')).rejects.toThrow(NotFoundError);
    expect(core.entities.listSessions(workspace.id)).toEqual([]);
  });

  it('a nested output folder is kept in the epic folder', async () => {
    const { retrospectives, workspace, state, chat, agent } = setup();
    state.status = { ...SET_UP, outputFolder: 'docs/bmad' };
    await retrospectives.lookBack(workspace.id, 'epic-one');
    await chat.settled();
    expect(agent.prompts).toEqual([`run-skill:${SKILL} on:docs/bmad/initiative-demo/epic-one`]);
    await chat.close();
  });

  it('a project whose BMad Method lacks the skill is not found, creating nothing', async () => {
    const { retrospectives, workspace, state, core } = setup();
    state.catalog = { ...CATALOG, skills: [SKILLS[1]!] };
    await expect(retrospectives.lookBack(workspace.id, 'epic-one')).rejects.toThrow(NotFoundError);
    expect(core.entities.listSessions(workspace.id)).toEqual([]);
  });

  it('a Retrospectives turned off while the catalog is read starts nothing', async () => {
    const { retrospectives, workspace, state, core } = setup();
    state.onCatalogRead = () => core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    await expect(retrospectives.lookBack(workspace.id, 'epic-one')).rejects.toThrow(FeatureOffError);
    expect(core.entities.listSessions(workspace.id)).toEqual([]);
  });
});
