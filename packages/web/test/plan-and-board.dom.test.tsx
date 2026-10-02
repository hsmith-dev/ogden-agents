// @vitest-environment happy-dom
/**
 * The bare Plan and Board pages' bodies (story 4.1), in a DOM: the Plan page
 * lists the catalog's skills, and Start creates a planning session and hands
 * it on (the page opens it); a refused start says why and leaves the list.
 * The Board page lists the tickets with their ref, title, state and status,
 * and what couldn't be read. Both have loading, error and empty states.
 * Story 4.2: a Board refused with `scripts_not_trusted` shows the trust
 * prompt, and Allow trusts the project and fetches the tickets again. The
 * REST calls go to a fake `tabAuth.fetch`.
 */
import {
  API_ROUTES,
  apiPath,
  BOARD_EMPTY_TITLE,
  BOARD_LOADING_TEXT,
  CatalogSkill,
  PLAN_EMPTY_TITLE,
  PLAN_LOADING_TEXT,
  SCRIPT_TRUST_TITLE,
  SCRIPTS_NOT_TRUSTED_MESSAGE,
  TICKETS_UNAVAILABLE_MESSAGE,
  TicketsResponse,
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
  title: null,
  adapterRefs: {},
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const state = vi.hoisted(() => ({
  catalog: [] as unknown,
  tickets: {} as unknown,
  start: undefined as unknown,
  calls: [] as string[],
  bodies: [] as unknown[],
  trust: undefined as unknown,
}));

const reply = (answer: unknown): Promise<Response> => {
  if (answer === 'pending') return new Promise(() => {});
  const failure = answer as { status?: number; message?: string; code?: string };
  if (typeof failure.status === 'number') {
    return Promise.resolve(new Response(JSON.stringify({ error: { code: failure.code ?? 'tickets_unavailable', message: failure.message } }), { status: failure.status }));
  }
  return Promise.resolve(Response.json(answer, { status: 200 }));
};

vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      state.calls.push(`${method} ${path}`);
      if (path.endsWith('/catalog')) {
        const catalog = state.catalog;
        const whole = { modules: [], skills: catalog, agents: [], entryAction: null, capabilities: { plain_labels: false, ticket_tree: true } };
        return reply(catalog === 'pending' || (catalog as { status?: number }).status !== undefined ? catalog : whole);
      }
      if (path.endsWith('/bmad/script-trust')) return reply(state.trust);
      if (path.endsWith('/planning-sessions')) {
        state.bodies.push(JSON.parse(String(init.body)));
        return reply(state.start);
      }
      if (path.endsWith('/tickets')) return reply(state.tickets);
      return new Response('{}', { status: 404 });
    },
  },
}));

const { PlanSkills } = await import('../src/planning/plan-skills');
const { BoardTickets } = await import('../src/planning/board-tickets');
const { TooltipProvider } = await import('../src/ui/tooltip');

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

const SKILLS: CatalogSkill[] = [
  CatalogSkill.parse({ name: 'bmad-spec', description: 'Condense any input into a short spec.' }),
  CatalogSkill.parse({ name: 'bmad-ticket', description: 'Create and manage tickets.' }),
];
const TICKETS: TicketsResponse = TicketsResponse.parse({
  tickets: [
    { ref: '1.1', id: 1, epic: 'epic-first', title: 'Build the first thing', type: 'story', status: 'in-review', state: 'review', blocked_reason: '' },
    { ref: '1.2', id: 2, epic: 'epic-first', title: 'Build the second thing', type: 'story', status: '', state: 'planned', blocked_reason: '' },
  ],
  problems: [],
});

beforeEach(() => {
  state.catalog = SKILLS;
  state.tickets = TICKETS;
  state.start = { session: SESSION };
  state.calls = [];
  state.bodies = [];
  state.trust = { settings: { cautionLevel: 'ask_every_time', bmadPieces: ['board'], bmadScriptsTrusted: true } };
});
afterEach(cleanup);

describe('Plan page body (story 4.1)', () => {
  it('lists the skills, and Start creates a planning session and hands it on', async () => {
    const started: Session[] = [];
    mount(<PlanSkills wsId={WS} onStarted={(session) => void started.push(session)} />);
    await settle();
    const rows = screen.getAllByTestId('skill-row');
    expect(rows.map((row) => row.getAttribute('data-skill'))).toEqual(['bmad-spec', 'bmad-ticket']);
    expect(rows[0]!.textContent).toContain('Condense any input into a short spec.');
    fireEvent.click(screen.getByRole('button', { name: 'Start bmad-spec' }));
    await settle();
    expect(state.calls).toContain(`POST ${apiPath(API_ROUTES.workspacePlanningSessions, { wsId: WS })}`);
    expect(state.bodies).toEqual([{ skill: 'bmad-spec' }]);
    expect(started.map((session) => session.id)).toEqual([SESSION.id]);
  });

  it('a refused start says why and keeps the list', async () => {
    state.start = { status: 404, message: "That doesn't exist in this project any more." };
    const started: Session[] = [];
    mount(<PlanSkills wsId={WS} onStarted={(session) => void started.push(session)} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Start bmad-ticket' }));
    await settle();
    expect(screen.getByTestId('plan-start-error').textContent).toBe("That doesn't exist in this project any more.");
    expect(screen.getAllByTestId('skill-row')).toHaveLength(2);
    expect(started).toEqual([]);
  });

  it('a failed hand-off (navigation) says why and frees the Start buttons', async () => {
    mount(<PlanSkills wsId={WS} onStarted={() => Promise.reject(new Error('Could not open the session.'))} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Start bmad-spec' }));
    await settle();
    expect(screen.getByTestId('plan-start-error').textContent).toBe('Could not open the session.');
    expect(screen.getByRole('button', { name: 'Start bmad-ticket' }).getAttribute('aria-disabled')).toBe('false');
  });

  it('shows loading, then empty; and an error with the server’s message', async () => {
    state.catalog = 'pending';
    mount(<PlanSkills wsId={WS} onStarted={() => {}} />);
    await settle();
    expect(screen.getByRole('status').textContent).toBe(PLAN_LOADING_TEXT);
    cleanup();

    state.catalog = [];
    mount(<PlanSkills wsId={WS} onStarted={() => {}} />);
    await settle();
    expect(screen.getByTestId('plan-empty').textContent).toContain(PLAN_EMPTY_TITLE);
    cleanup();

    state.catalog = { status: 409, message: 'This BMad Method feature is off in this project.' };
    mount(<PlanSkills wsId={WS} onStarted={() => {}} />);
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('This BMad Method feature is off in this project.');
  });
});

describe('Board page body (story 4.1)', () => {
  it('lists each ticket’s ref, title, state and status in order', async () => {
    mount(<BoardTickets wsId={WS} />);
    await settle();
    const rows = screen.getAllByTestId('ticket-row');
    expect(rows.map((row) => row.getAttribute('data-ref'))).toEqual(['1.1', '1.2']);
    expect(rows[0]!.textContent).toContain('Build the first thing');
    expect(screen.getAllByTestId('ticket-state').map((badge) => badge.textContent)).toEqual(['review', 'planned']);
    // Only a ticket with a status shows one.
    expect(screen.getAllByTestId('ticket-status').map((status) => status.textContent)).toEqual(['in-review']);
    expect(screen.queryByTestId('board-problems')).toBeNull();
  });

  it('lists what couldn’t be read', async () => {
    state.tickets = { ...TICKETS, problems: ['epic-first/x-plan.md: ticket 9 names no entry; skipped'] };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(screen.getByTestId('board-problems').textContent).toContain('ticket 9 names no entry');
  });

  it('shows loading, then empty; and tickets_unavailable’s plain message', async () => {
    state.tickets = 'pending';
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(screen.getByRole('status').textContent).toBe(BOARD_LOADING_TEXT);
    cleanup();

    state.tickets = { tickets: [], problems: [] };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(screen.getByTestId('board-empty').textContent).toContain(BOARD_EMPTY_TITLE);
    cleanup();

    state.tickets = { status: 503, message: TICKETS_UNAVAILABLE_MESSAGE };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(screen.getByRole('alert').textContent).toBe(TICKETS_UNAVAILABLE_MESSAGE);
  });
});

describe('Board page body: the script trust (story 4.2)', () => {
  it('scripts_not_trusted shows the trust prompt; Allow trusts the project and fetches the tickets again', async () => {
    state.tickets = { status: 409, code: 'scripts_not_trusted', message: SCRIPTS_NOT_TRUSTED_MESSAGE };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(screen.getByTestId('script-trust-prompt').textContent).toContain(SCRIPT_TRUST_TITLE);
    expect(screen.queryByTestId('ticket-row')).toBeNull();
    state.tickets = TICKETS;
    fireEvent.click(screen.getByTestId('script-trust-allow'));
    await settle();
    expect(state.calls).toContain(`PUT ${apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId: WS })}`);
    expect(screen.queryByTestId('script-trust-prompt')).toBeNull();
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(2);
  });

  it('a refused Allow says why and keeps the prompt', async () => {
    state.tickets = { status: 409, code: 'scripts_not_trusted', message: SCRIPTS_NOT_TRUSTED_MESSAGE };
    state.trust = { status: 404, code: 'not_found', message: 'There is no such project.' };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    fireEvent.click(screen.getByTestId('script-trust-allow'));
    await settle();
    expect(screen.getByTestId('script-trust-error').textContent).toBe('There is no such project.');
    expect(screen.getByTestId('script-trust-prompt')).toBeTruthy();
  });

  it('another 409 (Board off) is shown as a plain error, not the prompt', async () => {
    state.tickets = { status: 409, code: 'feature_off', message: 'This BMad Method feature is off in this project.' };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(screen.queryByTestId('script-trust-prompt')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('This BMad Method feature is off in this project.');
  });
});
