// @vitest-environment happy-dom
/**
 * The Plan home (story 4.6) and the bare Board page's body (story 4.1), in a
 * DOM: the Plan home shows "Start from an idea" (Enter starts a planning
 * session on the catalog's entry action with the idea; a blank idea asks
 * for one and sends nothing; a refused start says why under the field; no
 * entry action shows it disabled with one sentence), then the skills in the
 * UX groups with their plain text, the skill name only in Developer mode,
 * and a "New" tag; each Start creates a planning session and hands it on.
 * With Planning off, the feature-off notice and a link to the settings, and
 * no catalog request. The Board page lists the tickets with their ref, title, state and status,
 * and what couldn't be read. Both have loading, error and empty states.
 * Story 4.2: a Board refused with `scripts_not_trusted` shows the trust
 * prompt, and Allow trusts the project and fetches the tickets again.
 * Story 4.14: a Board refused with `bmad_not_downloaded` offers Download
 * BMad Method, which posts once, says it is downloading, then fetches the
 * tickets again; a failed download says why and keeps the button. The
 * REST calls go to a fake `tabAuth.fetch`.
 */
import {
  API_ROUTES,
  apiPath,
  BMAD_DOWNLOAD_INTEGRITY_MESSAGE,
  BMAD_DOWNLOAD_LABEL,
  BMAD_NOT_DOWNLOADED_MESSAGE,
  BMAD_NOT_DOWNLOADED_TEXT,
  BOARD_EMPTY_TITLE,
  BOARD_LOADING_TEXT,
  CatalogSkill,
  APPEARANCE_STORAGE_KEY,
  FEATURE_OFF_MESSAGE,
  PLAN_EMPTY_TITLE,
  PLAN_IDEA_UNAVAILABLE_TEXT,
  PLAN_LOADING_TEXT,
  PLAN_OPEN_SETTINGS_LABEL,
  PLAN_PROJECT_LOADING_TEXT,
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
  entryAction: null as string | null,
  pieces: ['planning', 'board'] as string[],
  tickets: {} as unknown,
  start: undefined as unknown,
  calls: [] as string[],
  bodies: [] as unknown[],
  trust: undefined as unknown,
  source: undefined as unknown,
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
        const whole = { modules: [], skills: catalog, agents: [], entryAction: state.entryAction, capabilities: { plain_labels: false, ticket_tree: true } };
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
      return new Response('{}', { status: 404 });
    },
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: { children: ReactNode; to: string; params: { wsId: string } }) => (
    <a href={to.replace('$wsId', params.wsId)} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [] }) }));

const { PlanHome } = await import('../src/planning/plan-home');
const { PlanPieceGate } = await import('../src/planning/plan-piece-gate');
const { BoardTickets } = await import('../src/planning/board-tickets');
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

  it('with no entry action, the idea shows disabled with one sentence and sends nothing', async () => {
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    expect(screen.getByRole('heading', { name: 'Start from an idea', level: 2 })).toBeTruthy();
    expect(ideaInput().disabled).toBe(true);
    expect(screen.getByTestId('plan-idea-unavailable').textContent).toBe(PLAN_IDEA_UNAVAILABLE_TEXT);
    expect(screen.getByTestId('plan-idea-start').getAttribute('aria-disabled')).toBe('true');
    // The reason reaches the focusable Start too, not only the disabled field.
    expect(screen.getByTestId('plan-idea-start').getAttribute('aria-describedby')).toBe('plan-idea-unavailable');
    fireEvent.submit(ideaInput().closest('form')!);
    await settle();
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
    <PlanPieceGate wsId={WS}>
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
    mount(page());
    await settle();
    expect(screen.queryByTestId('plan-feature-off')).toBeNull();
    expect(screen.getByTestId('plan-idea')).toBeTruthy();
    expect(state.calls).toContain(`GET ${apiPath(API_ROUTES.workspaceCatalog, { wsId: WS })}`);
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
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(2);
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
