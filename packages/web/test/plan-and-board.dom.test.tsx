// @vitest-environment happy-dom
/**
 * The Plan home (story 4.6) and the bare Board page's body (story 4.1), in a
 * DOM: the Plan home shows "Start from an idea" (Enter starts a planning
 * session on the catalog's entry action with the idea; a blank idea asks
 * for one and sends nothing; a refused start says why under the field; no
 * entry action shows the reduced-mode notice in its place, entry 4.11), then the skills in the
 * UX groups with their plain text, the skill name only in Developer mode,
 * and a "New" tag; each Start creates a planning session and hands it on.
 * With Planning off, the feature-off notice and a link to the settings, and
 * no catalog request. The Board page lists the tickets with their ref, title, state and status,
 * and what couldn't be read. Both have loading, error and empty states.
 * Story 4.2: a Board refused with `scripts_not_trusted` shows the trust
 * prompt, and Allow trusts the project and fetches the tickets again.
 * Story 4.14: a Board refused with `bmad_not_downloaded` offers Download
 * BMad Method, which posts once, says it is downloading, then fetches the
 * tickets again; a failed download says why and keeps the button.
 * Story 4.9: the board groups tickets by epic in status columns, with each
 * card's one status line ("Waits for 1.2", the blocked reason, else the
 * column), the problems one-liner with Show details, the dropped filter,
 * hostile text shown literally, and a fed `ticket.changed` highlighting the
 * card for 1.2 s; the ticket sheet's loaded, 404, error and close states.
 * Story 4.10: each card's status menu (a button outside the link) lists
 * every status but Done and the current one; a choice sends the PUT with
 * the status the board showed; Blocked asks for a reason first; the card
 * moves only once the refetched tickets say so, announced once; a failure
 * or `ticket_changed` shows its message and refetches; the sheet's menu too.
 * The REST calls go to a fake `tabAuth.fetch`; the event stream, the
 * router's Link is a stand-in; Developer mode is set in the
 * appearance's stored settings.
 */
import {
  API_ROUTES,
  apiPath,
  BMAD_FILES_UNCOMMITTED_MESSAGE,
  COMMIT_PLAN_FILES_LABEL,
  NO_PLAN_FILES_TO_COMMIT_TEXT,
  PLAN_FILES_COMMITTED_TEXT,
  PLAN_UNCOMMITTED_MESSAGE,
  BMAD_DOWNLOAD_INTEGRITY_MESSAGE,
  BMAD_DOWNLOAD_LABEL,
  BMAD_NOT_DOWNLOADED_MESSAGE,
  BMAD_NOT_DOWNLOADED_TEXT,
  BOARD_EMPTY_TITLE,
  BOARD_LOADING_TEXT,
  BOARD_SHOW_DETAILS_LABEL,
  boardProblemsLine,
  type CoreEvent,
  CatalogSkill,
  APPEARANCE_STORAGE_KEY,
  FEATURE_OFF_MESSAGE,
  LOOK_BACK_EPIC_NOT_FOUND_MESSAGE,
  LOOK_BACK_LABEL,
  BMAD_UPGRADE_LABEL,
  PLAN_EMPTY_TITLE,
  PLAN_ENTRY_REDUCED_TEXT,
  PLAN_LOADING_TEXT,
  PLAN_OPEN_SETTINGS_LABEL,
  PLAN_PROJECT_LOADING_TEXT,
  SCRIPT_TRUST_TITLE,
  SCRIPTS_NOT_TRUSTED_MESSAGE,
  TICKET_CHANGED_MESSAGE,
  TICKET_NO_PLAN_TEXT,
  TICKET_NOT_FOUND,
  TICKETS_UNAVAILABLE_MESSAGE,
  TicketDetail,
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
  permissionMode: 'ask',
  title: null,
  adapterRefs: {},
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const state = vi.hoisted(() => ({
  catalog: [] as unknown,
  entryAction: null as string | null,
  pieces: ['planning', 'board'] as string[],
  tickets: {} as unknown,
  start: undefined as unknown,
  calls: [] as string[],
  bodies: [] as unknown[],
  trust: undefined as unknown,
  source: undefined as unknown,
  ticket: undefined as unknown,
  /** The status change's answer, or a function of its body (story 4.10). */
  mark: undefined as unknown,
  /** Build's answer and Commit plan files' answer (story 5.5). */
  build: undefined as unknown,
  commitPlan: undefined as unknown,
  /** Look back's answer (story 7.1). */
  lookBack: undefined as unknown,
}));

/** The event stream's stand-in: `push` appends events and re-renders what reads them. */
const stream = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const value = {
    events: [] as unknown[],
    caughtUp: true,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    push(...more: unknown[]) {
      value.events = [...value.events, ...more];
      for (const listener of listeners) listener();
    },
  };
  return value;
});

vi.mock('@/events/event-stream', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useEventStream: () => ({ events: useSyncExternalStore(stream.subscribe, () => stream.events), caughtUp: useSyncExternalStore(stream.subscribe, () => stream.caughtUp) }),
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: { children: ReactNode; to: string; params: { wsId: string; ref?: string } }) => (
    <a href={to.replace('$wsId', params.wsId).replace('$ref', params.ref ?? '')} {...props}>
      {children}
    </a>
  ),
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
        const whole = { modules: [], skills: catalog, agents: [], entryAction: state.entryAction, capabilities: { plain_labels: true, ticket_tree: true } };
        return reply(catalog === 'pending' || (catalog as { status?: number }).status !== undefined ? catalog : whole);
      }
      if (path.endsWith('/bmad/script-trust')) return reply(state.trust);
      if (path.endsWith('/bmad/source')) return reply(state.source);
      if (path.endsWith('/planning-sessions')) {
        state.bodies.push(JSON.parse(String(init.body)));
        return reply(state.start);
      }
      if (path.endsWith('/tickets')) return reply(state.tickets);
      if (path.endsWith('/settings')) {
        const pieces = state.pieces as unknown;
        return reply(Array.isArray(pieces) ? { settings: { cautionLevel: 'ask_every_time', bmadPieces: pieces } } : pieces);
      }
      if (method === 'PUT' && /\/tickets\/[^/]+\/status$/.test(path)) {
        const body = JSON.parse(String(init.body)) as unknown;
        state.bodies.push(body);
        return reply(typeof state.mark === 'function' ? (state.mark as (body: unknown) => unknown)(body) : state.mark);
      }
      if (/\/tickets\/[^/]+$/.test(path)) return reply(state.ticket);
      if (method === 'POST' && path.endsWith('/commit-plan')) return reply(state.commitPlan);
      if (method === 'POST' && path.endsWith('/builds')) return reply(state.build);
      if (method === 'POST' && path.endsWith('/look-back')) return reply(state.lookBack);
      return new Response('{}', { status: 404 });
    },
  },
}));


const { PlanHome } = await import('../src/planning/plan-home');
const { PlanPieceGate } = await import('../src/planning/plan-piece-gate');
const { BoardTickets } = await import('../src/planning/board-tickets');
const { TicketSheet } = await import('../src/planning/ticket-sheet');
const { TooltipProvider } = await import('../src/ui/tooltip');
const { AppearanceProvider } = await import('../src/appearance/appearance-provider');

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AppearanceProvider>
        <TooltipProvider>{node}</TooltipProvider>
      </AppearanceProvider>
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
  state.entryAction = null;
  state.pieces = ['planning', 'board'];
  window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
  state.tickets = TICKETS;
  state.start = { session: SESSION };
  state.calls = [];
  state.bodies = [];
  state.trust = { settings: { cautionLevel: 'ask_every_time', bmadPieces: ['board'], bmadScriptsTrusted: true } };
  state.source = undefined;
  state.ticket = undefined;
  state.mark = undefined;
  state.build = undefined;
  state.commitPlan = undefined;
  state.lookBack = undefined;
  stream.events = [];
  stream.caughtUp = true;
});
afterEach(cleanup);

describe('Plan home (story 4.6)', () => {
  const NOW = new Date('2026-10-10T00:00:00.000Z');
  const GROUPED: CatalogSkill[] = [
    CatalogSkill.parse({ name: 'bmad-checks', description: 'Review the code.', label: 'Check the work', group: 'checking', installedAt: '2026-10-08T00:00:00.000Z' }),
    CatalogSkill.parse({ name: 'bmad-odd', description: 'An odd one.', group: 'weird', installedAt: '2026-09-30T00:00:00.000Z' }),
    CatalogSkill.parse({ name: 'bmad-plain', description: '', group: null }),
    CatalogSkill.parse({ name: 'bmad-product-brief', description: 'Write a brief.', label: 'Write a product brief', group: 'planning' }),
  ];
  const groups = () => screen.getAllByTestId('plan-group').map((group) => [group.querySelector('h2')!.textContent, ...[...group.querySelectorAll('[data-testid="skill-row"]')].map((row) => row.getAttribute('data-skill'))]);
  const ideaInput = () => screen.getByLabelText('Your idea') as HTMLInputElement;
  const submitIdea = (idea: string) => {
    fireEvent.change(ideaInput(), { target: { value: idea } });
    fireEvent.submit(ideaInput().closest('form')!);
  };
  const posts = () => state.calls.filter((call) => call.startsWith('POST '));

  it('shows the groups in the UX order, unknown and missing last as Other, each skill by its label or description, and New for a recent module', async () => {
    state.catalog = GROUPED;
    mount(<PlanHome wsId={WS} onStarted={() => {}} now={NOW} />);
    await settle();
    expect(groups()).toEqual([
      ['Planning', 'bmad-product-brief'],
      ['Checking work', 'bmad-checks'],
      ['Other', 'bmad-odd', 'bmad-plain'],
    ]);
    expect(screen.getByRole('list', { name: 'Checking work' })).toBeTruthy();
    const text = (skill: string) => screen.getAllByTestId('skill-row').find((row) => row.getAttribute('data-skill') === skill)!;
    // A label shows with its description as the sentence; without one, the description; without either, the name.
    expect(text('bmad-checks').querySelector('[data-testid="skill-text"]')!.textContent).toBe('Check the work');
    expect(text('bmad-checks').querySelector('[data-testid="skill-sentence"]')!.textContent).toBe('Review the code.');
    expect(text('bmad-odd').querySelector('[data-testid="skill-text"]')!.textContent).toBe('An odd one.');
    expect(text('bmad-odd').querySelector('[data-testid="skill-sentence"]')!.textContent).toBe('');
    expect(text('bmad-plain').querySelector('[data-testid="skill-text"]')!.textContent).toBe('bmad-plain');
    // Developer mode off: no skill names anywhere but the fallback above.
    expect(screen.queryAllByTestId('skill-name')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('bmad-product-brief');
    expect(document.body.textContent).not.toContain('bmad-checks');
    // New: installed 2 days before `now`; the other module 10 days before.
    expect(text('bmad-checks').querySelector('[data-testid="skill-new"]')!.textContent).toBe('New');
    expect(text('bmad-odd').querySelector('[data-testid="skill-new"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start Write a product brief' })).toBeTruthy();
  });

  it('Developer mode shows each skill name in mono beside its text', async () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme: 'system', density: 'compact', developerMode: true, terminalScreenReader: false }));
    state.catalog = GROUPED;
    mount(<PlanHome wsId={WS} onStarted={() => {}} now={NOW} />);
    await settle();
    expect(screen.getAllByTestId('skill-name').map((name) => name.textContent)).toEqual(['bmad-product-brief', 'bmad-checks', 'bmad-odd', 'bmad-plain']);
    expect(screen.getAllByTestId('skill-name')[0]!.className).toContain('font-mono');
  });

  it('an idea and Enter start a planning session on the entry action with the idea, and hand it on', async () => {
    state.catalog = GROUPED;
    state.entryAction = 'bmad-product-brief';
    const started: Session[] = [];
    mount(<PlanHome wsId={WS} onStarted={(session) => void started.push(session)} />);
    await settle();
    expect(ideaInput().maxLength).toBe(2000);
    submitIdea('  A booking page for my pottery classes  ');
    await settle();
    expect(posts()).toEqual([`POST ${apiPath(API_ROUTES.workspacePlanningSessions, { wsId: WS })}`]);
    expect(state.bodies).toEqual([{ skill: 'bmad-product-brief', idea: 'A booking page for my pottery classes' }]);
    expect(started.map((session) => session.id)).toEqual([SESSION.id]);
  });

  it('a blank idea asks for one under the field and sends nothing', async () => {
    state.entryAction = 'bmad-product-brief';
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    submitIdea('   ');
    await settle();
    expect(screen.getByTestId('plan-idea-error').textContent).toBe('Write your idea first.');
    expect(ideaInput().getAttribute('aria-invalid')).toBe('true');
    expect(posts()).toEqual([]);
  });

  it('a refused idea says why under the field, keeps the idea, and frees Start', async () => {
    state.entryAction = 'bmad-product-brief';
    state.start = { status: 404, message: "That doesn't exist in this project any more." };
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    submitIdea('A pottery site');
    await settle();
    expect(screen.getByTestId('plan-idea-error').textContent).toBe("That doesn't exist in this project any more.");
    expect(ideaInput().value).toBe('A pottery site');
    expect(screen.getByTestId('plan-idea-start').getAttribute('aria-disabled')).toBe('false');
    expect(screen.getByRole('button', { name: 'Start Condense any input into a short spec.' }).getAttribute('aria-disabled')).toBe('false');
  });

  it('one start at a time: while one is pending, another sends nothing', async () => {
    state.entryAction = 'bmad-product-brief';
    state.start = 'pending';
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    submitIdea('A pottery site');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Start Create and manage tickets.' }));
    submitIdea('Another idea');
    await settle();
    expect(posts()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Start Create and manage tickets.' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('with no entry action, the reduced-mode notice stands where the idea was, with Upgrade, and nothing is sent (entry 4.11)', async () => {
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    expect(screen.queryByTestId('plan-idea')).toBeNull();
    expect(screen.getByTestId('reduced-mode-notice').textContent).toContain(PLAN_ENTRY_REDUCED_TEXT);
    expect(screen.getByRole('button', { name: BMAD_UPGRADE_LABEL })).toBeTruthy();
    // The skills still list and start.
    expect(screen.getAllByTestId('skill-row')).toHaveLength(2);
    expect(posts()).toEqual([]);
  });

  it('a skill’s Start creates a planning session on it and hands it on', async () => {
    const started: Session[] = [];
    mount(<PlanHome wsId={WS} onStarted={(session) => void started.push(session)} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Start Condense any input into a short spec.' }));
    await settle();
    expect(state.bodies).toEqual([{ skill: 'bmad-spec' }]);
    expect(started.map((session) => session.id)).toEqual([SESSION.id]);
  });

  it('a refused start says why and keeps the list; a failed hand-off frees the buttons', async () => {
    state.start = { status: 404, message: "That doesn't exist in this project any more." };
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Start Create and manage tickets.' }));
    await settle();
    expect(screen.getByTestId('plan-start-error').textContent).toBe("That doesn't exist in this project any more.");
    expect(screen.getAllByTestId('skill-row')).toHaveLength(2);
    cleanup();

    state.start = { session: SESSION };
    mount(<PlanHome wsId={WS} onStarted={() => Promise.reject(new Error('Could not open the session.'))} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Start Condense any input into a short spec.' }));
    await settle();
    expect(screen.getByTestId('plan-start-error').textContent).toBe('Could not open the session.');
    expect(screen.getByRole('button', { name: 'Start Create and manage tickets.' }).getAttribute('aria-disabled')).toBe('false');
  });

  it('shows loading, then empty; and an error with the server’s message', async () => {
    state.catalog = 'pending';
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    expect(screen.getByRole('status').textContent).toBe(PLAN_LOADING_TEXT);
    cleanup();

    state.catalog = [];
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    expect(screen.getByTestId('plan-empty').textContent).toContain(PLAN_EMPTY_TITLE);
    cleanup();

    state.catalog = { status: 409, message: 'This BMad Method feature is off in this project.' };
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('This BMad Method feature is off in this project.');
  });
});

describe('Plan piece gate (story 4.6)', () => {
  const page = () => (
    <PlanPieceGate wsId={WS} piece="planning">
      <PlanHome wsId={WS} onStarted={() => {}} />
    </PlanPieceGate>
  );

  it('Planning off: the feature-off notice and a link to the settings, and no catalog request', async () => {
    state.pieces = ['board'];
    mount(page());
    await settle();
    expect(screen.getByTestId('plan-feature-off').textContent).toContain(FEATURE_OFF_MESSAGE);
    const link = screen.getByRole('link', { name: PLAN_OPEN_SETTINGS_LABEL });
    expect(link.getAttribute('href')).toBe(`/w/${WS}/settings`);
    expect(screen.queryByTestId('plan-idea')).toBeNull();
    expect(state.calls.filter((call) => call.endsWith('/catalog'))).toEqual([]);
  });

  it('while the settings load, says the project is loading and asks nothing BMad', async () => {
    state.pieces = 'pending' as unknown as string[];
    mount(page());
    await settle();
    expect(screen.getByRole('status').textContent).toBe(PLAN_PROJECT_LOADING_TEXT);
    expect(state.calls.filter((call) => call.endsWith('/catalog') || call.includes('/bmad/'))).toEqual([]);
  });

  it('settings that can’t be read: their error, not the page (no setup panel, no catalog)', async () => {
    state.pieces = { status: 500, code: 'internal_error', message: "Ogden Agents couldn't load this project's settings" } as unknown as string[];
    mount(page());
    await settle();
    expect(screen.getByTestId('plan-settings-error').textContent).toBe("Ogden Agents couldn't load this project's settings");
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('plan-idea')).toBeNull();
    expect(state.calls.filter((call) => call.endsWith('/catalog') || call.includes('/bmad/'))).toEqual([]);
  });

  it('Planning on: the Plan home, from the catalog', async () => {
    state.entryAction = 'bmad-spec';
    mount(page());
    await settle();
    expect(screen.queryByTestId('plan-feature-off')).toBeNull();
    expect(screen.getByTestId('plan-idea')).toBeTruthy();
    expect(state.calls).toContain(`GET ${apiPath(API_ROUTES.workspaceCatalog, { wsId: WS })}`);
  });
});

describe('Board piece gate (story 4.9, reusing 4.6 gate)', () => {
  const page = () => (
    <PlanPieceGate wsId={WS} piece="board">
      <BoardTickets wsId={WS} />
    </PlanPieceGate>
  );

  it('Board off: the feature-off notice and a link to the settings, and no tickets or BMad request', async () => {
    state.pieces = ['planning'];
    mount(page());
    await settle();
    expect(screen.getByTestId('plan-feature-off').textContent).toContain(FEATURE_OFF_MESSAGE);
    expect(screen.getByRole('link', { name: PLAN_OPEN_SETTINGS_LABEL }).getAttribute('href')).toBe(`/w/${WS}/settings`);
    expect(state.calls.filter((call) => call.includes('/tickets') || call.includes('/bmad/'))).toEqual([]);
  });

  it('Board on: the board, from the tickets', async () => {
    state.pieces = ['board'];
    mount(page());
    await settle();
    expect(screen.queryByTestId('plan-feature-off')).toBeNull();
    expect(state.calls).toContain(`GET ${apiPath(API_ROUTES.workspaceTickets, { wsId: WS })}`);
  });
});

describe('Board page body (story 4.1)', () => {
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
    expect(screen.queryByTestId('ticket-card')).toBeNull();
    state.tickets = TICKETS;
    fireEvent.click(screen.getByTestId('script-trust-allow'));
    await settle();
    expect(state.calls).toContain(`PUT ${apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId: WS })}`);
    expect(screen.queryByTestId('script-trust-prompt')).toBeNull();
    expect(screen.getAllByTestId('ticket-card')).toHaveLength(2);
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

describe('Board page body: downloading BMad Method (story 4.14)', () => {
  const notDownloaded = { status: 409, code: 'bmad_not_downloaded', message: BMAD_NOT_DOWNLOADED_MESSAGE };
  const ready = { state: 'ready', version: '6.13.0', commit: 'a'.repeat(40) };

  it('bmad_not_downloaded offers Download BMad Method; nothing downloads until clicked, then it posts once and fetches the tickets again', async () => {
    state.tickets = notDownloaded;
    state.source = 'pending';
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(screen.getByTestId('bmad-download-prompt').textContent).toContain(BMAD_NOT_DOWNLOADED_TEXT);
    expect(screen.getByTestId('bmad-download').textContent).toBe(BMAD_DOWNLOAD_LABEL);
    expect(state.calls.filter((call) => call.includes('/bmad/source'))).toEqual([]);
    fireEvent.click(screen.getByTestId('bmad-download'));
    await settle();
    // Pending: it says so, and a second click sends nothing more.
    expect(screen.getByTestId('bmad-downloading')).toBeTruthy();
    fireEvent.click(screen.getByTestId('bmad-download'));
    await settle();
    expect(state.calls.filter((call) => call.includes('/bmad/source'))).toEqual([`POST ${API_ROUTES.bmadSource}`]);
    cleanup();

    state.calls.length = 0;
    state.source = ready;
    mount(<BoardTickets wsId={WS} />);
    await settle();
    state.tickets = TICKETS;
    fireEvent.click(screen.getByTestId('bmad-download'));
    await settle();
    expect(state.calls).toContain(`POST ${API_ROUTES.bmadSource}`);
    expect(screen.queryByTestId('bmad-download-prompt')).toBeNull();
    expect(screen.getAllByTestId('ticket-card')).toHaveLength(2);
  });

  it('a failed download says why and keeps the button', async () => {
    state.tickets = notDownloaded;
    state.source = { status: 502, code: 'bmad_download_failed', message: BMAD_DOWNLOAD_INTEGRITY_MESSAGE };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    fireEvent.click(screen.getByTestId('bmad-download'));
    await settle();
    expect(screen.getByTestId('bmad-download-error').textContent).toBe(BMAD_DOWNLOAD_INTEGRITY_MESSAGE);
    expect(screen.getByTestId('bmad-download')).toBeTruthy();
    expect(screen.queryByTestId('bmad-downloading')).toBeNull();
  });
});

/** The fields story 4.2 added, as `tickets.py status` gives them. */
const ROW = { file: null, tracker_id: '', assignee: '', hitl: false, covers: [], after: [], blocks: [], blocked_at: '' };
const HOSTILE = '<img src=x onerror=alert(1)>';
const BOARD: TicketsResponse = TicketsResponse.parse({
  tickets: [
    { ...ROW, ref: '1.1', id: 1, epic: 'epic-planning-and-board', title: 'Build the first thing', type: 'story', status: 'in-review', state: 'review', blocked_reason: '' },
    { ...ROW, ref: '1.2', id: 2, epic: 'epic-planning-and-board', title: 'Build the second thing', type: 'story', status: '', state: 'planned', blocked_reason: '' },
    { ...ROW, ref: '1.3', id: 3, epic: 'epic-planning-and-board', title: 'Build the third thing', type: 'story', status: 'ready-for-dev', state: 'backlog', blocked_reason: '', after: [2] },
    { ...ROW, ref: '1.4', id: 4, epic: 'epic-planning-and-board', title: HOSTILE, type: 'story', status: 'blocked', state: 'in-progress', blocked_reason: 'Needs the API key', blocked_at: '2026-10-01' },
    { ...ROW, ref: '1.5', id: 5, epic: 'epic-planning-and-board', title: 'Gone', type: 'story', status: 'dropped', state: 'dropped', blocked_reason: '' },
    { ...ROW, ref: '2.1', id: 1, epic: 'epic-second', title: 'After the first', type: 'story', status: 'ready-for-dev', state: 'backlog', blocked_reason: '', after: ['1.1'] },
  ],
  problems: [],
  epics: [
    { slug: 'epic-planning-and-board', id: 1, status: 'in-progress', after: [], blocks: [] },
    { slug: 'epic-second', id: 2, status: 'planned', after: [], blocks: [] },
  ],
});

const card = (ref: string) => document.querySelector<HTMLElement>(`[data-testid="ticket-card"][data-ref="${ref}"]`)!;
const changed = (seq: number, ref: string, workspaceId = WS) =>
  ({ id: `evt_${seq}`, seq, at: '2026-10-02T00:00:00.000Z', type: 'ticket.changed', workspaceId, streamId: workspaceId, payload: { ref } }) as unknown as CoreEvent;

describe('Board (story 4.9)', () => {
  beforeEach(() => {
    state.tickets = BOARD;
  });

  it('groups by epic in build order with each card in its column; a planned prerequisite shows Waits for; blocked shows its reason', async () => {
    mount(<BoardTickets wsId={WS} />);
    await settle();
    const epics = screen.getAllByTestId('board-epic');
    expect(epics.map((epic) => epic.getAttribute('data-epic'))).toEqual(['epic-planning-and-board', 'epic-second']);
    expect(epics[0]!.querySelector('h2')!.textContent).toBe('1Planning and board');
    const cards = screen.getAllByTestId('ticket-card');
    expect(Object.fromEntries(cards.map((each) => [each.getAttribute('data-ref'), each.getAttribute('data-column')]))).toEqual({
      '1.1': 'in_review',
      '1.2': 'draft',
      '1.3': 'ready',
      '1.4': 'blocked',
      '2.1': 'ready',
    });
    // Each card is a link to its detail, named by its ref, title and status line.
    expect(card('1.3').getAttribute('href')).toBe(`/w/${WS}/board/1.3`);
    expect(card('1.3').getAttribute('aria-label')).toBe('1.3 Build the third thing, Waits for 1.2');
    expect(card('1.3').querySelector('[data-testid="ticket-status-line"]')!.getAttribute('data-kind')).toBe('waits');
    // 2.1 waits for 1.1 by ref, which is in review: met, so it shows its column.
    expect(card('2.1').getAttribute('aria-label')).toBe('2.1 After the first, Ready');
    expect(card('1.4').getAttribute('aria-label')).toBe(`1.4 ${HOSTILE}, Blocked: Needs the API key`);
    expect(card('1.4').textContent).toContain('Blocked: Needs the API key');
    expect(card('1.1').textContent).toContain('In review');
  });

  it('a met prerequisite (in review or done) shows no Waits for', async () => {
    state.tickets = { ...BOARD, tickets: BOARD.tickets.map((row) => (row.ref === '1.2' ? { ...row, state: 'review', status: 'in-review' } : row)) };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(card('1.3').textContent).not.toContain('Waits for');
    expect(card('1.3').textContent).toContain('Ready');
  });

  it('shows hostile text literally: no element, no link made from it', async () => {
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(card('1.4').textContent).toContain(HOSTILE);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it('what couldn’t be read is one line with Show details; dropped tickets show only with the filter on', async () => {
    state.tickets = { ...BOARD, problems: ['epic-first/x-plan.md: ticket 9 names no entry; skipped', 'b'] };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(screen.getByTestId('board-problems-line').textContent).toBe(boardProblemsLine(2));
    expect(screen.getByTestId('board-problems-list').hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: BOARD_SHOW_DETAILS_LABEL }));
    expect(screen.getByTestId('board-problems-list').hidden).toBe(false);
    expect(screen.getByTestId('board-problems-list').textContent).toContain('ticket 9 names no entry');

    expect(card('1.5')).toBeNull();
    fireEvent.click(screen.getByTestId('board-show-dropped'));
    await settle();
    expect(card('1.5').getAttribute('data-column')).toBe('dropped');
    expect(screen.getByTestId('board-dropped').textContent).toContain('Gone');
  });

  it('a ticket.changed of this workspace refetches and highlights that card for 1.2 s; other workspaces and earlier events are ignored', async () => {
    stream.events = [changed(1, '1.1')];
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(card('1.1').hasAttribute('data-highlighted')).toBe(false);
    const fetchesBefore = state.calls.filter((each) => each.endsWith('/tickets')).length;

    vi.useFakeTimers();
    try {
      act(() => stream.push(changed(2, '1.2', 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2ZZ')));
      expect(card('1.2').hasAttribute('data-highlighted')).toBe(false);
      act(() => stream.push(changed(3, '1.2')));
      // The highlight waits for the refetched tickets.
      expect(card('1.2').hasAttribute('data-highlighted')).toBe(false);
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
      }
      expect(card('1.2').getAttribute('data-highlighted')).toBe('true');
      expect(card('1.1').hasAttribute('data-highlighted')).toBe(false);
      // Never announced: no live region on the board.
      expect(document.querySelector('[aria-live]')).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1199);
      });
      expect(card('1.2').getAttribute('data-highlighted')).toBe('true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(card('1.2').hasAttribute('data-highlighted')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    await settle();
    expect(state.calls.filter((each) => each.endsWith('/tickets')).length).toBe(fetchesBefore + 1);
  });

  it('a failed refetch keeps the board, with a quiet line above and no alert', async () => {
    mount(<BoardTickets wsId={WS} />);
    await settle();
    state.tickets = { status: 503, message: TICKETS_UNAVAILABLE_MESSAGE };
    act(() => stream.push(changed(1, '1.2')));
    await settle();
    expect(screen.getByTestId('board-refetch-error').textContent).toBe(TICKETS_UNAVAILABLE_MESSAGE);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByTestId('ticket-card')).toHaveLength(5);
  });

  it('the sheet’s outlet shows only over a loaded board, never over the trust prompt', async () => {
    state.tickets = { status: 409, code: 'scripts_not_trusted', message: SCRIPTS_NOT_TRUSTED_MESSAGE };
    mount(<BoardTickets wsId={WS} sheet={<div data-testid="sheet-outlet" />} />);
    await settle();
    expect(screen.getByTestId('script-trust-prompt')).toBeTruthy();
    expect(screen.queryByTestId('sheet-outlet')).toBeNull();
    cleanup();

    state.tickets = BOARD;
    mount(<BoardTickets wsId={WS} sheet={<div data-testid="sheet-outlet" />} />);
    await settle();
    expect(screen.getByTestId('sheet-outlet')).toBeTruthy();
  });

  it('a backlog replayed while the stream catches up refetches but highlights nothing', async () => {
    stream.caughtUp = false;
    mount(<BoardTickets wsId={WS} />);
    await settle();
    const fetchesBefore = state.calls.filter((each) => each.endsWith('/tickets')).length;
    act(() => stream.push(changed(1, '1.2')));
    expect(card('1.2').hasAttribute('data-highlighted')).toBe(false);
    await settle();
    expect(state.calls.filter((each) => each.endsWith('/tickets')).length).toBe(fetchesBefore + 1);
  });
});

const DETAIL = TicketDetail.parse({
  ...ROW,
  ref: '1.3',
  id: 3,
  epic: 'epic-planning-and-board',
  title: 'Build the third thing',
  type: 'story',
  status: 'ready-for-dev',
  state: 'backlog',
  blocked_reason: '',
  after: [2, 1],
  description: '[x](javascript:alert(1)) and <b>bold</b>',
  verify: 'The board shows it.',
  references: ['../../etc/passwd'],
  notes: ['A note'],
  unknown: '',
  hasPlan: true,
});

describe('Ticket sheet (story 4.9)', () => {
  beforeEach(() => {
    state.tickets = BOARD;
    state.ticket = { ticket: DETAIL };
  });

  it('shows the title, ref, status, plan summary, check, prerequisites met or waiting, notes and references as plain text', async () => {
    mount(<TicketSheet wsId={WS} ticketRef="1.3" onClose={() => {}} />);
    await settle();
    const sheet = screen.getByTestId('ticket-sheet');
    expect(screen.getByRole('dialog', { name: 'Build the third thing' })).toBeTruthy();
    expect(screen.getByTestId('ticket-sheet-ref').textContent).toBe('1.3');
    expect(screen.getByTestId('ticket-sheet-status').textContent).toContain('Ready');
    expect(screen.getByTestId('ticket-sheet-summary').textContent).toContain('[x](javascript:alert(1)) and <b>bold</b>');
    expect(screen.getByTestId('ticket-sheet-verify').textContent).toContain('The board shows it.');
    const prerequisites = screen.getAllByTestId('ticket-sheet-prerequisite');
    expect(prerequisites.map((each) => [each.textContent, each.getAttribute('data-met')])).toEqual([
      ['1.2Waiting', 'false'],
      ['1.1Met', 'true'],
    ]);
    expect(screen.getByTestId('ticket-sheet-notes').textContent).toContain('A note');
    expect(screen.getByTestId('ticket-sheet-references').textContent).toContain('../../etc/passwd');
    expect(screen.queryByTestId('ticket-sheet-unknown')).toBeNull();
    expect(screen.queryByTestId('ticket-sheet-raw-status')).toBeNull();
    expect(sheet.querySelector('a, b, img')).toBeNull();
  });

  it('with no description says there is no plan summary yet; Developer mode shows the raw status and state', async () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme: 'system', density: 'compact', developerMode: true, terminalScreenReader: false }));
    state.ticket = { ticket: { ...DETAIL, description: '' } };
    mount(<TicketSheet wsId={WS} ticketRef="1.3" onClose={() => {}} />);
    await settle();
    expect(screen.getByTestId('ticket-sheet-summary').textContent).toContain(TICKET_NO_PLAN_TEXT);
    expect(screen.getByTestId('ticket-sheet-raw-status').textContent).toContain('ready-for-dev');
  });

  it('404 says there is no such ticket; another error shows its message', async () => {
    state.ticket = { status: 404, code: 'not_found', message: 'not found' };
    mount(<TicketSheet wsId={WS} ticketRef="1.9" onClose={() => {}} />);
    await settle();
    expect(screen.getByTestId('ticket-sheet-error').textContent).toBe(TICKET_NOT_FOUND('1.9'));
    cleanup();

    state.ticket = { status: 400, code: 'invalid_request', message: 'That is not a ticket reference.' };
    mount(<TicketSheet wsId={WS} ticketRef="1.9" onClose={() => {}} />);
    await settle();
    expect(screen.getByTestId('ticket-sheet-error').textContent).toBe('That is not a ticket reference.');
    cleanup();

    state.ticket = 'pending';
    mount(<TicketSheet wsId={WS} ticketRef="1.9" onClose={() => {}} />);
    await settle();
    expect(screen.getByTestId('ticket-sheet-loading')).toBeTruthy();
  });

  it('without the tickets, prerequisites wait (a skeleton) or, on failure, show as written with no met or waiting word', async () => {
    state.tickets = 'pending';
    mount(<TicketSheet wsId={WS} ticketRef="1.3" onClose={() => {}} />);
    await settle();
    expect(screen.getByTestId('ticket-sheet-prerequisites-loading')).toBeTruthy();
    expect(screen.queryByTestId('ticket-sheet-prerequisite')).toBeNull();
    cleanup();

    state.tickets = { status: 503, message: TICKETS_UNAVAILABLE_MESSAGE };
    mount(<TicketSheet wsId={WS} ticketRef="1.3" onClose={() => {}} />);
    await settle();
    expect(screen.getAllByTestId('ticket-sheet-prerequisite').map((each) => [each.textContent, each.getAttribute('data-met')])).toEqual([
      ['2', null],
      ['1', null],
    ]);
  });

  it('Close and Esc ask to go back to the board', async () => {
    const onClose = vi.fn();
    mount(<TicketSheet wsId={WS} ticketRef="1.3" onClose={onClose} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByTestId('ticket-sheet'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('Changing a status from the board (story 4.10)', () => {
  beforeEach(() => {
    state.tickets = BOARD;
  });

  const trigger = (ref: string) => document.querySelector<HTMLElement>(`[data-testid="ticket-status-trigger"][data-ref="${ref}"]`)!;
  const open = async (ref: string) => {
    fireEvent.keyDown(trigger(ref), { key: 'Enter' });
    await settle();
    return screen.getAllByTestId('ticket-status-item');
  };
  const withStatus = (ref: string, status: string, extra: Record<string, unknown> = {}): TicketsResponse =>
    TicketsResponse.parse({ ...BOARD, tickets: BOARD.tickets.map((row) => (row.ref === ref ? { ...row, status, ...extra } : row)) });

  it('each card has a named menu button outside its link; the menu lists no Done and not the current status', async () => {
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(trigger('1.2').getAttribute('aria-label')).toBe('Change status of 1.2 Build the second thing');
    expect(trigger('1.2').tagName).toBe('BUTTON');
    expect(card('1.2').contains(trigger('1.2'))).toBe(false);
    const planned = await open('1.2');
    // Neither its status nor its column (a planned ticket shows in Draft): no Move to Draft.
    expect(planned.map((item) => item.getAttribute('data-status'))).toEqual(['ready-for-dev', 'in-progress', 'in-review', 'built', 'blocked', 'dropped']);
    expect(planned.map((item) => item.textContent)).toContain('Move to Ready');
    expect(planned.map((item) => item.textContent)).toContain('Drop this ticket');
    expect(planned.some((item) => item.textContent === 'Move to Done')).toBe(false);
    fireEvent.keyDown(screen.getByTestId('ticket-status-menu'), { key: 'Escape' });
    await settle();
    const ready = await open('1.3');
    expect(ready.map((item) => item.getAttribute('data-status'))).not.toContain('ready-for-dev');
    expect(ready.map((item) => item.getAttribute('data-status'))).not.toContain('done');
  });

  it('Move to Ready sends the PUT with the status the board showed; the card moves once the tickets refetch, announced once', async () => {
    state.mark = () => {
      state.tickets = withStatus('1.2', 'ready-for-dev', { state: 'backlog' });
      return { ref: '1.2', status: 'ready-for-dev' };
    };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    const items = await open('1.2');
    fireEvent.click(items.find((item) => item.getAttribute('data-status') === 'ready-for-dev')!);
    await settle();
    expect(state.calls).toContain(`PUT ${apiPath(API_ROUTES.workspaceTicketStatus, { wsId: WS, ref: '1.2' })}`);
    expect(state.bodies).toEqual([{ status: 'ready-for-dev', expectedStatus: '' }]);
    expect(card('1.2').getAttribute('data-column')).toBe('ready');
    expect(screen.getByTestId('board-announcement').textContent).toBe('1.2 moved to Ready');
    expect(screen.getByTestId('board-announcement').getAttribute('role')).toBe('status');
    expect(screen.queryByTestId('board-mark-error')).toBeNull();
  });

  it('while one change saves, every card’s menu waits and the status region says so', async () => {
    state.mark = 'pending';
    mount(<BoardTickets wsId={WS} />);
    await settle();
    fireEvent.click((await open('1.2')).find((item) => item.getAttribute('data-status') === 'ready-for-dev')!);
    await settle();
    expect(screen.getByTestId('board-announcement').textContent).toBe('Saving the status');
    expect(trigger('1.2').getAttribute('aria-disabled')).toBe('true');
    expect(trigger('1.3').getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(trigger('1.3'), { key: 'Enter' });
    await settle();
    expect(screen.queryByTestId('ticket-status-menu')).toBeNull();
  });

  it('a dropped ticket hidden by the filter: the announcement says how to see it', async () => {
    state.mark = () => {
      state.tickets = withStatus('1.2', 'dropped', { state: 'dropped' });
      return { ref: '1.2', status: 'dropped' };
    };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    fireEvent.click((await open('1.2')).find((item) => item.getAttribute('data-status') === 'dropped')!);
    await settle();
    expect(document.querySelector('[data-testid="ticket-card"][data-ref="1.2"]')).toBeNull();
    expect(screen.getByTestId('board-announcement').textContent).toBe('1.2 moved to Dropped. Turn on Show dropped tickets to see it.');
  });

  it('Blocked asks for a reason in a labelled dialog that won’t submit empty, then sends it', async () => {
    state.mark = { ref: '1.3', status: 'blocked' };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    const items = await open('1.3');
    fireEvent.click(items.find((item) => item.getAttribute('data-status') === 'blocked')!);
    await settle();
    expect(screen.getByRole('dialog', { name: 'Why is 1.3 blocked?' })).toBeTruthy();
    const field = screen.getByLabelText('Reason');
    fireEvent.click(screen.getByTestId('ticket-blocked-save'));
    await settle();
    expect(state.bodies).toEqual([]);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId('ticket-blocked-reason-error').textContent).toBe('Say why it is blocked.');
    expect(screen.getByTestId('ticket-blocked-reason-error').getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: '  Needs the API key  ' } });
    fireEvent.click(screen.getByTestId('ticket-blocked-save'));
    await settle();
    expect(state.bodies).toEqual([{ status: 'blocked', blockedReason: 'Needs the API key', expectedStatus: 'ready-for-dev' }]);
    expect(screen.queryByTestId('ticket-blocked-dialog')).toBeNull();
  });

  it('a 503 shows its message as an alert, the card stays in its column and the menu works again', async () => {
    state.mark = { status: 503, code: 'tickets_unavailable', message: TICKETS_UNAVAILABLE_MESSAGE };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    fireEvent.click((await open('1.2')).find((item) => item.getAttribute('data-status') === 'in-progress')!);
    await settle();
    expect(screen.getByTestId('board-mark-error').textContent).toContain(`Couldn't change 1.2's status. ${TICKETS_UNAVAILABLE_MESSAGE}`);
    expect(screen.getByTestId('board-mark-error').getAttribute('role')).toBe('alert');
    expect(card('1.2').getAttribute('data-column')).toBe('draft');
    expect(screen.getByTestId('board-announcement').textContent).toBe('');
    expect(trigger('1.2').getAttribute('aria-disabled')).toBeNull();
    expect((await open('1.2')).length).toBe(6);
  });

  it('ticket_changed shows its message and refetches the tickets', async () => {
    state.mark = () => {
      state.tickets = withStatus('1.2', 'in-progress', { state: 'in-progress' });
      return { status: 409, code: 'ticket_changed', message: TICKET_CHANGED_MESSAGE };
    };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    const before = state.calls.filter((call) => call.endsWith('/tickets')).length;
    fireEvent.click((await open('1.2')).find((item) => item.getAttribute('data-status') === 'ready-for-dev')!);
    await settle();
    expect(screen.getByTestId('board-mark-error').textContent).toContain(TICKET_CHANGED_MESSAGE);
    expect(state.calls.filter((call) => call.endsWith('/tickets')).length).toBe(before + 1);
    // What the files say now, not what was asked for.
    expect(card('1.2').getAttribute('data-column')).toBe('in_progress');
  });

  it('the sheet’s Status section has the same menu; a change is announced and refetches the ticket', async () => {
    state.ticket = { ticket: DETAIL };
    state.mark = () => {
      state.ticket = { ticket: { ...DETAIL, status: 'in-progress', state: 'in-progress' } };
      return { ref: '1.3', status: 'in-progress' };
    };
    mount(<TicketSheet wsId={WS} ticketRef="1.3" onClose={() => {}} />);
    await settle();
    const button = screen.getByRole('button', { name: 'Change status of 1.3 Build the third thing' });
    fireEvent.keyDown(button, { key: 'Enter' });
    await settle();
    const items = screen.getAllByTestId('ticket-status-item');
    expect(items.map((item) => item.getAttribute('data-status'))).not.toContain('done');
    fireEvent.click(items.find((item) => item.getAttribute('data-status') === 'in-progress')!);
    await settle();
    expect(state.bodies).toEqual([{ status: 'in-progress', expectedStatus: 'ready-for-dev' }]);
    expect(screen.getByTestId('ticket-sheet-announcement').textContent).toBe('1.3 moved to In progress');
    expect(screen.getByTestId('ticket-sheet-status').textContent).toContain('In progress');
  });

  it('in the sheet, Blocked asks for the reason inline (no second modal) and Esc closes only the form', async () => {
    state.ticket = { ticket: DETAIL };
    state.mark = { ref: '1.3', status: 'blocked' };
    mount(<TicketSheet wsId={WS} ticketRef="1.3" onClose={() => {}} />);
    await settle();
    fireEvent.keyDown(screen.getByTestId('ticket-status-trigger'), { key: 'Enter' });
    await settle();
    fireEvent.click(screen.getAllByTestId('ticket-status-item').find((item) => item.getAttribute('data-status') === 'blocked')!);
    await settle();
    expect(screen.queryByTestId('ticket-blocked-dialog')).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const form = screen.getByRole('form', { name: 'Why is 1.3 blocked?' });
    expect(screen.getByTestId('ticket-sheet-status').contains(form)).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Waits on the key' } });
    fireEvent.click(screen.getByTestId('ticket-blocked-save'));
    await settle();
    expect(state.bodies).toEqual([{ status: 'blocked', blockedReason: 'Waits on the key', expectedStatus: 'ready-for-dev' }]);
    expect(screen.queryByTestId('ticket-blocked-form')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('ticket-status-trigger'));
  });

  it('a Done ticket (user decision 2026-10-02): a move asks "Reopen this ticket?" first; Cancel and Esc send nothing and give focus back', async () => {
    state.tickets = withStatus('1.2', 'done', { state: 'done' });
    mount(<BoardTickets wsId={WS} />);
    await settle();
    const items = await open('1.2');
    expect(items.map((item) => item.getAttribute('data-status'))).not.toContain('done');
    fireEvent.click(items.find((item) => item.getAttribute('data-status') === 'ready-for-dev')!);
    await settle();
    const dialog = screen.getByRole('alertdialog', { name: 'Reopen this ticket?' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toBe('1.2 is done. It moves to Ready and needs approving again to be done.');
    expect(state.bodies).toEqual([]);
    // Focus starts on Cancel (a confirmation's safe choice).
    expect(document.activeElement).toBe(screen.getByTestId('ticket-reopen-cancel'));
    fireEvent.click(screen.getByTestId('ticket-reopen-cancel'));
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(state.bodies).toEqual([]);
    expect(document.activeElement).toBe(trigger('1.2'));
    fireEvent.click((await open('1.2')).find((item) => item.getAttribute('data-status') === 'in-progress')!);
    await settle();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(state.bodies).toEqual([]);
    expect(card('1.2').getAttribute('data-column')).toBe('done');
  });

  it('a Done ticket: Reopen sends the change with reopen: true', async () => {
    state.tickets = withStatus('1.2', 'done', { state: 'done' });
    state.mark = () => {
      state.tickets = withStatus('1.2', 'ready-for-dev', { state: 'backlog' });
      return { ref: '1.2', status: 'ready-for-dev' };
    };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    fireEvent.click((await open('1.2')).find((item) => item.getAttribute('data-status') === 'ready-for-dev')!);
    await settle();
    fireEvent.click(screen.getByTestId('ticket-reopen-confirm'));
    await settle();
    expect(state.bodies).toEqual([{ status: 'ready-for-dev', expectedStatus: 'done', reopen: true }]);
    expect(card('1.2').getAttribute('data-column')).toBe('ready');
    expect(screen.getByTestId('board-announcement').textContent).toBe('1.2 moved to Ready');
  });

  it('a Done ticket: Blocked asks to reopen, then for its reason, and sends both', async () => {
    state.tickets = withStatus('1.2', 'done', { state: 'done' });
    state.mark = { ref: '1.2', status: 'blocked' };
    mount(<BoardTickets wsId={WS} />);
    await settle();
    fireEvent.click((await open('1.2')).find((item) => item.getAttribute('data-status') === 'blocked')!);
    await settle();
    fireEvent.click(screen.getByTestId('ticket-reopen-confirm'));
    await settle();
    expect(screen.getByRole('dialog', { name: 'Why is 1.2 blocked?' })).toBeTruthy();
    expect(state.bodies).toEqual([]);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Broke again' } });
    fireEvent.click(screen.getByTestId('ticket-blocked-save'));
    await settle();
    expect(state.bodies).toEqual([{ status: 'blocked', blockedReason: 'Broke again', expectedStatus: 'done', reopen: true }]);
  });

  it('in the sheet, a Done ticket asks to reopen inline (no second modal); Esc closes only the confirmation; Reopen sends it', async () => {
    state.ticket = { ticket: { ...DETAIL, status: 'done', state: 'done' } };
    state.mark = { ref: '1.3', status: 'in-progress' };
    mount(<TicketSheet wsId={WS} ticketRef="1.3" onClose={() => {}} />);
    await settle();
    const pickInProgress = async () => {
      fireEvent.keyDown(screen.getByTestId('ticket-status-trigger'), { key: 'Enter' });
      await settle();
      fireEvent.click(screen.getAllByTestId('ticket-status-item').find((item) => item.getAttribute('data-status') === 'in-progress')!);
      await settle();
    };
    await pickInProgress();
    const confirmation = screen.getByRole('alertdialog', { name: 'Reopen this ticket?' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByTestId('ticket-sheet-status').contains(confirmation)).toBe(true);
    expect(document.activeElement).toBe(screen.getByTestId('ticket-reopen-cancel'));
    fireEvent.keyDown(confirmation, { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByTestId('ticket-status-trigger'));
    expect(state.bodies).toEqual([]);
    await pickInProgress();
    fireEvent.click(screen.getByTestId('ticket-reopen-confirm'));
    await settle();
    expect(state.bodies).toEqual([{ status: 'in-progress', expectedStatus: 'done', reopen: true }]);
  });

  it('the sheet shows a failure inline', async () => {
    state.ticket = { ticket: DETAIL };
    state.mark = { status: 409, code: 'status_not_allowed', message: 'Only approving the work marks a ticket done.' };
    mount(<TicketSheet wsId={WS} ticketRef="1.3" onClose={() => {}} />);
    await settle();
    fireEvent.keyDown(screen.getByTestId('ticket-status-trigger'), { key: 'Enter' });
    await settle();
    fireEvent.click(screen.getAllByTestId('ticket-status-item')[0]!);
    await settle();
    expect(screen.getByTestId('ticket-sheet-mark-error').textContent).toBe("Couldn't change 1.3's status. Only approving the work marks a ticket done.");
  });
});

describe('Commit plan files on the board (story 5.5)', () => {
  const READY: TicketsResponse = TicketsResponse.parse({
    tickets: [{ ref: '1.1', id: 1, epic: 'epic-first', title: 'Build the first thing', type: 'story', status: 'ready-for-dev', state: 'backlog', blocked_reason: '' }],
    problems: [],
  });

  it('a Build refused for uncommitted plan files offers Commit plan files, which commits them and says to build again', async () => {
    state.tickets = READY;
    state.build = { status: 409, code: 'plan_uncommitted', message: PLAN_UNCOMMITTED_MESSAGE };
    state.commitPlan = { committed: ['_bmad-output/plan.md'], revision: 'a'.repeat(40) };
    mount(<BoardTickets wsId={WS} builds={{ onStarted: () => {} }} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Build this story 1.1' }));
    await settle();
    expect(screen.getByTestId('board-build-error').textContent).toContain(PLAN_UNCOMMITTED_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: COMMIT_PLAN_FILES_LABEL }));
    await settle();
    expect(state.calls).toContain(`POST ${apiPath(API_ROUTES.workspaceBuildCommitPlan, { wsId: WS, ref: '1.1' })}`);
    expect(screen.queryByTestId('board-build-error')).toBeNull();
    expect(screen.getByTestId('board-plan-committed').textContent).toBe(PLAN_FILES_COMMITTED_TEXT);
  });

  it('offers no Commit plan files for another refusal, and says so when nothing needed committing', async () => {
    state.tickets = READY;
    state.build = { status: 409, code: 'plan_uncommitted', message: BMAD_FILES_UNCOMMITTED_MESSAGE };
    mount(<BoardTickets wsId={WS} builds={{ onStarted: () => {} }} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Build this story 1.1' }));
    await settle();
    expect(screen.getByTestId('board-build-error').textContent).toContain(BMAD_FILES_UNCOMMITTED_MESSAGE);
    expect(screen.queryByRole('button', { name: COMMIT_PLAN_FILES_LABEL })).toBeNull();
    cleanup();

    state.build = { status: 409, code: 'plan_uncommitted', message: PLAN_UNCOMMITTED_MESSAGE };
    state.commitPlan = { committed: [], revision: 'a'.repeat(40) };
    mount(<BoardTickets wsId={WS} builds={{ onStarted: () => {} }} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Build this story 1.1' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: COMMIT_PLAN_FILES_LABEL }));
    await settle();
    expect(screen.getByTestId('board-plan-committed').textContent).toBe(NO_PLAN_FILES_TO_COMMIT_TEXT);
  });
});

describe('Look back on an epic on the board (story 7.1)', () => {
  it('shows Look back on this epic on each epic header only with Retrospectives on', async () => {
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(screen.queryByRole('button', { name: LOOK_BACK_LABEL })).toBeNull();
    cleanup();
    mount(<BoardTickets wsId={WS} lookBack={{ onStarted: () => {} }} />);
    await settle();
    const buttons = screen.getAllByTestId('board-look-back');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe(LOOK_BACK_LABEL);
    expect(buttons[0]!.closest('[data-testid="board-epic"]')!.getAttribute('data-epic')).toBe('epic-first');
  });

  it('posts for that epic and hands the new session on', async () => {
    state.lookBack = { session: SESSION };
    const started = vi.fn();
    mount(<BoardTickets wsId={WS} lookBack={{ onStarted: started }} />);
    await settle();
    fireEvent.click(screen.getByTestId('board-look-back'));
    await settle();
    expect(state.calls).toContain(`POST ${apiPath(API_ROUTES.workspaceEpicLookBack, { wsId: WS, epic: 'epic-first' })}`);
    expect(started).toHaveBeenCalledWith(SESSION.id);
    expect(screen.queryByTestId('board-look-back-error')).toBeNull();
  });

  it('says why in an alert when it is refused, and starts nothing', async () => {
    state.lookBack = { status: 404, code: 'not_found', message: LOOK_BACK_EPIC_NOT_FOUND_MESSAGE };
    const started = vi.fn();
    mount(<BoardTickets wsId={WS} lookBack={{ onStarted: started }} />);
    await settle();
    fireEvent.click(screen.getByTestId('board-look-back'));
    await settle();
    expect(screen.getByTestId('board-look-back-error').textContent).toContain(LOOK_BACK_EPIC_NOT_FOUND_MESSAGE);
    expect(started).not.toHaveBeenCalled();
  });
});
