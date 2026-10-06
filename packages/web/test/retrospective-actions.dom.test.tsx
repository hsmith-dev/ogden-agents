// @vitest-environment happy-dom
/**
 * A retrospective's document card (epic 7, story 7.5), in a DOM: with
 * Retrospectives on it adds the look-back action's further next steps (their
 * labels from the catalog), each starting a planning session on the
 * retrospective file and handing it on, and Save the lessons for later
 * builds with its one line; a save says it was saved, or why not in the
 * server's words. With Retrospectives off, or for any other document, none
 * of it shows and nothing is fetched.
 */
import {
  API_ROUTES,
  apiPath,
  CatalogSkill,
  LESSONS_CHECKOUT_BUSY_MESSAGE,
  LESSONS_SAVED_TEXT,
  NOTHING_TO_SAVE_MESSAGE,
  SAVE_LESSONS_LABEL,
  SAVE_LESSONS_NOTE,
  type Session,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SESSION: Session = {
  id: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4' as Session['id'],
  workspaceId: WS as Session['workspaceId'],
  kind: 'planning',
  state: 'idle',
  driver: 'ui',
  permissionMode: 'ask',
  title: null,
  adapterRefs: {},
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const PATH = '_bmad-output/initiative-demo/epic-one/epic-one-retrospective.md';
const LOOK = CatalogSkill.parse({
  name: 'bmad-retrospective',
  description: 'Look back.',
  scope: 'epic',
  nexts: [{ skill: 'bmad-project-context', label: 'Add the lessons to AGENTS.md' }, { skill: 'bmad-ticket', label: 'Turn the action items into tickets' }],
});

const state = vi.hoisted(() => ({
  pieces: ['board', 'retrospectives'] as string[],
  start: undefined as unknown,
  save: undefined as unknown,
  calls: [] as string[],
  bodies: [] as unknown[],
}));

const reply = (answer: unknown): Promise<Response> => {
  const failure = answer as { status?: number; message?: string; code?: string };
  if (typeof failure.status === 'number') {
    return Promise.resolve(new Response(JSON.stringify({ error: { code: failure.code ?? 'internal_error', message: failure.message } }), { status: failure.status }));
  }
  return Promise.resolve(Response.json(answer, { status: 200 }));
};

vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], caughtUp: true }) }));
vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      state.calls.push(`${method} ${path}`);
      if (path.endsWith('/settings')) return reply({ settings: { cautionLevel: 'ask_every_time', bmadPieces: state.pieces, bmadScriptsTrusted: true } });
      if (path.endsWith('/catalog')) return reply({ modules: [], skills: [LOOK], agents: [], entryAction: null, capabilities: { plain_labels: true, ticket_tree: true, look_back: true } });
      if (path.endsWith('/retrospective/sessions')) {
        state.bodies.push(JSON.parse(String(init.body)));
        return reply(state.start);
      }
      if (path.endsWith('/retrospective/save')) return reply(state.save);
      return new Response('{}', { status: 404 });
    },
  },
}));

const { DocumentCard } = await import('../src/planning/document-card');
const { retrospectiveEpicOf } = await import('../src/planning/retrospective-actions');

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  state.pieces = ['board', 'retrospectives'];
  state.start = { session: SESSION };
  state.save = { paths: ['AGENTS.md', PATH], revision: 'a'.repeat(40) };
  state.calls = [];
  state.bodies = [];
});
afterEach(cleanup);

describe('retrospectiveEpicOf', () => {
  it('names the epic folder a retrospective is in, and nothing for any other document', () => {
    expect(retrospectiveEpicOf(PATH)).toBe('epic-one');
    for (const other of ['_bmad-output/specs/spec-x.md', '_bmad-output/-retrospective.md', 'epic-retrospective.md', 'a/b/c.md', '_bmad-output/../x/y-retrospective.md', '_bmad-output/a b/y-retrospective.md']) {
      expect(retrospectiveEpicOf(other), other).toBeUndefined();
    }
  });
});

describe('a retrospective\'s document card (story 7.5)', () => {
  const card = () => mount(<DocumentCard wsId={WS} path={PATH} next={null} onStarted={started} />);
  const started = vi.fn();
  beforeEach(() => started.mockReset());

  it('shows the catalog\'s next steps and Save the lessons with its one line', async () => {
    card();
    await settle();
    expect(screen.getAllByTestId('retrospective-step').map((button) => [button.getAttribute('data-skill'), button.textContent])).toEqual([
      ['bmad-project-context', 'Add the lessons to AGENTS.md'],
      ['bmad-ticket', 'Turn the action items into tickets'],
    ]);
    expect(screen.getByTestId('retrospective-save').textContent).toBe(SAVE_LESSONS_LABEL);
    expect(screen.getByTestId('retrospective-save-note').textContent).toBe(SAVE_LESSONS_NOTE);
  });

  it('a next step starts the planning session for that skill on this epic and hands it on', async () => {
    card();
    await settle();
    fireEvent.click(screen.getAllByTestId('retrospective-step')[0]!);
    await settle();
    expect(state.calls).toContain(`POST ${apiPath(API_ROUTES.workspaceRetrospectiveSessions, { wsId: WS, epic: 'epic-one' })}`);
    expect(state.bodies).toEqual([{ skill: 'bmad-project-context' }]);
    expect(started).toHaveBeenCalledWith(SESSION);
  });

  it('Save the lessons saves once and says so; a refusal says why in the server\'s words', async () => {
    card();
    await settle();
    fireEvent.click(screen.getByTestId('retrospective-save'));
    await settle();
    expect(state.calls).toContain(`POST ${apiPath(API_ROUTES.workspaceRetrospectiveSave, { wsId: WS, epic: 'epic-one' })}`);
    expect(screen.getByTestId('retrospective-save-note').textContent).toBe(LESSONS_SAVED_TEXT);
    expect(screen.queryByTestId('retrospective-error')).toBeNull();

    state.save = { status: 409, code: 'nothing_to_save', message: NOTHING_TO_SAVE_MESSAGE };
    fireEvent.click(screen.getByTestId('retrospective-save'));
    await settle();
    expect(screen.getByTestId('retrospective-error').textContent).toBe(NOTHING_TO_SAVE_MESSAGE);
    expect(screen.getByTestId('retrospective-save-note').textContent).toBe(SAVE_LESSONS_NOTE);

    state.save = { status: 409, code: 'checkout_busy', message: LESSONS_CHECKOUT_BUSY_MESSAGE };
    fireEvent.click(screen.getByTestId('retrospective-save'));
    await settle();
    expect(screen.getByTestId('retrospective-error').textContent).toBe(LESSONS_CHECKOUT_BUSY_MESSAGE);
  });

  it('a refused step says why and hands nothing on', async () => {
    state.start = { status: 404, code: 'not_found', message: "That step isn't offered for this retrospective." };
    card();
    await settle();
    fireEvent.click(screen.getAllByTestId('retrospective-step')[1]!);
    await settle();
    expect(screen.getByTestId('retrospective-error').textContent).toContain("isn't offered");
    expect(started).not.toHaveBeenCalled();
  });

  it('with Retrospectives off, or for another document, shows none of it and fetches no catalog', async () => {
    state.pieces = ['board'];
    card();
    await settle();
    expect(screen.queryByTestId('retrospective-actions')).toBeNull();
    expect(state.calls.some((call) => call.endsWith('/catalog'))).toBe(false);
    cleanup();
    state.pieces = ['board', 'retrospectives'];
    state.calls = [];
    mount(<DocumentCard wsId={WS} path="_bmad-output/specs/spec-x.md" next={null} onStarted={started} />);
    await settle();
    expect(screen.queryByTestId('retrospective-actions')).toBeNull();
    expect(state.calls).toEqual([]);
  });
});
