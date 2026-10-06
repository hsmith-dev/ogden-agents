// @vitest-environment happy-dom
/**
 * The reduced-mode notice on Plan and Board (entry 4.11, AD-14), in a DOM:
 *
 * - Plan: a catalog without `plain_labels` shows the notice (its capability
 *   sentence) where "Start from an idea" was, the skills still list by their
 *   description and start; with labels but no entry action, the entry
 *   sentence. The notice is the quiet `info` panel with the info glyph and
 *   one outline Upgrade this project, never an alert.
 * - Upgrade asks first: the confirmation opens with focus on Cancel, Esc and
 *   Cancel close it and send nothing; Upgrade posts `{upgrade: true}` once,
 *   the progress list follows the `bmad.setup_*` events, and once completed
 *   the catalog is fetched again: the notice goes, the done line stays and
 *   takes focus when focus fell to the page, and a persistent polite region
 *   announces the end. A failure says why; the notice's one Upgrade is the
 *   retry. Focus returns to Upgrade when the confirmation closes. A view
 *   mounted mid-run shows the steps and the end; a run that completes with
 *   a capability still missing says no done line.
 * - Board: `reduced_mode` shows the notice (the ticket tree sentence)
 *   instead of the board, with no card menu; a completed upgrade fetches the
 *   tickets again and the board shows, with the upgrade's progress and done
 *   line kept above it.
 *
 * The REST calls go to a fake `tabAuth.fetch`; the events come from a fake
 * stream; the router's Link is a stand-in.
 */
import {
  BMAD_CAPABILITY_REDUCED_TEXT,
  BMAD_SETUP_FAILURE_REASONS,
  BMAD_SETUP_STEP_LABELS,
  BMAD_UPGRADE_CONFIRM_TEXT,
  BMAD_UPGRADE_CONFIRM_TITLE,
  BMAD_UPGRADE_DONE_TEXT,
  BMAD_UPGRADE_LABEL,
  BMAD_UPGRADE_REFUSED_TEXT,
  CatalogSkill,
  PLAN_ENTRY_REDUCED_TEXT,
  REDUCED_MODE_MESSAGE,
  TicketsResponse,
  type BmadCapabilities,
  type CoreEvent,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

const state = vi.hoisted(() => ({
  capabilities: { plain_labels: false, ticket_tree: false, look_back: true } as BmadCapabilities,
  entryAction: null as string | null,
  /** The tickets' answer: `reduced` until upgraded. */
  reduced: true,
  calls: [] as string[],
  bodies: [] as unknown[],
  setupAnswer: undefined as undefined | { status: number; body: unknown },
  events: [] as CoreEvent[],
  listeners: new Set<() => void>(),
}));

vi.mock('@/events/event-stream', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useEventStream: () => {
      const events = useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => state.listeners.delete(listener);
        },
        () => state.events,
      );
      return { events, lastSeq: events.at(-1)?.seq ?? 0, caughtUp: true };
    },
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: { children: ReactNode; to: string; params: { wsId: string; ref?: string } }) => (
    <a href={to.replace('$wsId', params.wsId).replace('$ref', params.ref ?? '')} {...props}>
      {children}
    </a>
  ),
}));

const ROW = { file: null, tracker_id: '', assignee: '', hitl: false, covers: [], after: [], blocks: [], blocked_at: '' };
const TICKETS = TicketsResponse.parse({
  tickets: [{ ...ROW, ref: '1.1', id: 1, epic: 'epic-first', title: 'Build the first thing', type: 'story', status: '', state: 'planned', blocked_reason: '' }],
  problems: [],
});
const SKILLS = [CatalogSkill.parse({ name: 'bmad-help', description: 'Get help with BMad Method in this project.' })];

vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      state.calls.push(`${method} ${path}`);
      if (path.endsWith('/catalog')) {
        return Response.json({ modules: [], skills: SKILLS, agents: [], entryAction: state.entryAction, capabilities: state.capabilities });
      }
      if (path.endsWith('/tickets')) {
        if (state.reduced) return new Response(JSON.stringify({ error: { code: 'reduced_mode', message: REDUCED_MODE_MESSAGE } }), { status: 409 });
        return Response.json(TICKETS);
      }
      if (path.endsWith('/bmad/setup') && method === 'POST') {
        state.bodies.push(init.body === undefined ? undefined : JSON.parse(String(init.body)));
        const answer = state.setupAnswer ?? { status: 202, body: { started: true, setup: { state: 'current', outputFolder: '_bmad-output', bundledVersion: '7.0.0', installedVersion: '7.0.0', problems: [] } } };
        return new Response(JSON.stringify(answer.body), { status: answer.status });
      }
      return new Response('{}', { status: 404 });
    },
  },
}));

const { PlanHome } = await import('../src/planning/plan-home');
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

let nextSeq = 1;
const emit = (...events: Array<{ type: string; payload: unknown }>) =>
  act(() => {
    state.events = [...state.events, ...events.map((event) => ({ ...event, seq: nextSeq++, workspaceId: WS, streamId: WS, ts: '2026-10-02T00:00:00.000Z' }) as unknown as CoreEvent)];
    for (const listener of state.listeners) listener();
  });

const CURRENT = { state: 'current', outputFolder: '_bmad-output', bundledVersion: '7.0.0', installedVersion: '7.0.0', problems: [], missingCapabilities: [] };
const posts = () => state.calls.filter((call) => call.startsWith('POST '));

/** Upgrade this project, then Upgrade in the confirmation. */
async function upgrade() {
  fireEvent.click(screen.getByRole('button', { name: BMAD_UPGRADE_LABEL }));
  await settle();
  fireEvent.click(screen.getByTestId('upgrade-confirm'));
  await settle();
}

/** The server's upgrade run, step by step, ending completed (the files now have both capabilities). */
async function serverUpgrades() {
  emit({ type: 'bmad.setup_started', payload: {} }, { type: 'bmad.setup_progress', payload: { step: 'checking', label: BMAD_SETUP_STEP_LABELS.checking } });
  state.capabilities = { plain_labels: true, ticket_tree: true, look_back: true };
  state.entryAction = 'bmad-help';
  state.reduced = false;
  emit({ type: 'bmad.setup_completed', payload: { status: CURRENT } });
  await settle();
}

beforeEach(() => {
  state.capabilities = { plain_labels: false, ticket_tree: false, look_back: true };
  state.entryAction = null;
  state.reduced = true;
  state.calls = [];
  state.bodies = [];
  state.setupAnswer = undefined;
  state.events = [];
  state.listeners.clear();
});
afterEach(cleanup);

describe('Plan in reduced mode (entry 4.11)', () => {
  it('without plain labels: the notice where the idea was, quiet and never an alert; the skills list by description and start', async () => {
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    expect(screen.queryByTestId('plan-idea')).toBeNull();
    const notices = screen.getAllByTestId('reduced-mode-notice');
    expect(notices).toHaveLength(1);
    expect(notices[0]!.textContent).toContain(BMAD_CAPABILITY_REDUCED_TEXT.plain_labels);
    expect(notices[0]!.getAttribute('data-variant')).toBe('info');
    expect(notices[0]!.querySelector('[data-testid="notice-info-glyph"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: BMAD_UPGRADE_LABEL }).className).toContain('border');
    expect(screen.getByRole('button', { name: 'Start Get help with BMad Method in this project.' })).toBeTruthy();
  });

  it('with labels but no entry action: the entry sentence', async () => {
    state.capabilities = { plain_labels: true, ticket_tree: true, look_back: true };
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    expect(screen.getByTestId('reduced-mode-notice').textContent).toContain(PLAN_ENTRY_REDUCED_TEXT);
  });

  it('nothing is missing: no notice, the idea prompt', async () => {
    state.capabilities = { plain_labels: true, ticket_tree: true, look_back: true };
    state.entryAction = 'bmad-help';
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    expect(screen.queryByTestId('reduced-mode-notice')).toBeNull();
    expect(screen.getByTestId('plan-idea')).toBeTruthy();
  });

  it('Upgrade asks first: focus on Cancel, Esc and Cancel send nothing, and focus returns to Upgrade', async () => {
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: BMAD_UPGRADE_LABEL }));
    await settle();
    const dialog = screen.getByRole('alertdialog', { name: BMAD_UPGRADE_CONFIRM_TITLE });
    expect(dialog.textContent).toContain(BMAD_UPGRADE_CONFIRM_TEXT);
    expect(document.activeElement).toBe(screen.getByTestId('upgrade-confirm-cancel'));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: BMAD_UPGRADE_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: BMAD_UPGRADE_LABEL }));
    await settle();
    fireEvent.click(screen.getByTestId('upgrade-confirm-cancel'));
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: BMAD_UPGRADE_LABEL }));
    expect(posts()).toEqual([]);
  });

  it('confirmed: posts {upgrade: true} once, shows the progress, then the notice goes and the done line stays', async () => {
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    await upgrade();
    expect(posts()).toEqual([`POST /api/v1/workspaces/${WS}/bmad/setup`]);
    expect(state.bodies).toEqual([{ upgrade: true }]);
    expect(screen.getByTestId('bmad-setup-panel').getAttribute('data-phase')).toBe('starting');
    expect(screen.getByRole('button', { name: BMAD_UPGRADE_LABEL }).getAttribute('aria-disabled')).toBe('true');

    emit({ type: 'bmad.setup_started', payload: {} }, { type: 'bmad.setup_progress', payload: { step: 'copying_skills', label: BMAD_SETUP_STEP_LABELS.copying_skills } });
    expect(screen.getAllByTestId('bmad-setup-step').map((step) => step.getAttribute('data-state'))).toEqual(['done', 'current', 'pending', 'pending']);
    const catalogReads = state.calls.filter((call) => call.endsWith('/catalog')).length;

    state.capabilities = { plain_labels: true, ticket_tree: true, look_back: true };
    state.entryAction = 'bmad-help';
    emit({ type: 'bmad.setup_completed', payload: { status: CURRENT } });
    await settle();
    expect(state.calls.filter((call) => call.endsWith('/catalog')).length).toBeGreaterThan(catalogReads);
    expect(screen.queryByTestId('reduced-mode-notice')).toBeNull();
    expect(screen.getByTestId('bmad-upgrade-done').textContent).toBe(BMAD_UPGRADE_DONE_TEXT);
    expect(screen.getByTestId('reduced-mode-announcement').textContent).toBe(BMAD_UPGRADE_DONE_TEXT);
    // The focused Upgrade button went with the notice: focus is on the done line, not the page.
    expect(document.activeElement).toBe(screen.getByTestId('bmad-upgrade-done'));
    expect(screen.getByTestId('plan-idea')).toBeTruthy();
  });

  it('a view mounted mid-run shows the steps and the end; a run that completes still lacking a capability shows no done line', async () => {
    emit({ type: 'bmad.setup_started', payload: {} }, { type: 'bmad.setup_progress', payload: { step: 'checking', label: BMAD_SETUP_STEP_LABELS.checking } });
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    expect(screen.getAllByTestId('bmad-setup-step').map((step) => step.getAttribute('data-state'))).toEqual(['current', 'pending', 'pending', 'pending']);
    emit({ type: 'bmad.setup_completed', payload: { status: { ...CURRENT, missingCapabilities: ['plain_labels'] } } });
    await settle();
    expect(screen.getByTestId('bmad-setup-panel').getAttribute('data-phase')).toBe('done');
    expect(screen.queryByTestId('bmad-upgrade-done')).toBeNull();
    expect(screen.getByTestId('reduced-mode-notice')).toBeTruthy();
  });

  it('a failed upgrade says why and offers Upgrade again (after the confirmation); a refused start says why', async () => {
    mount(<PlanHome wsId={WS} onStarted={() => {}} />);
    await settle();
    await upgrade();
    emit({ type: 'bmad.setup_started', payload: {} }, { type: 'bmad.setup_failed', payload: { reason: BMAD_SETUP_FAILURE_REASONS.upgrade_refused } });
    await settle();
    expect(screen.getByTestId('bmad-setup-failed').textContent).toContain(BMAD_UPGRADE_REFUSED_TEXT);
    expect(screen.getByTestId('reduced-mode-announcement').textContent).toBe(BMAD_UPGRADE_REFUSED_TEXT);
    // One Upgrade: the notice's is the retry.
    expect(screen.getAllByRole('button', { name: BMAD_UPGRADE_LABEL })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: BMAD_UPGRADE_LABEL }));
    await settle();
    expect(screen.getByRole('alertdialog', { name: BMAD_UPGRADE_CONFIRM_TITLE })).toBeTruthy();
    state.setupAnswer = { status: 409, body: { error: { code: 'bmad_upgrade_refused', message: BMAD_UPGRADE_REFUSED_TEXT } } };
    fireEvent.click(screen.getByTestId('upgrade-confirm'));
    await settle();
    expect(screen.getByTestId('bmad-setup-error').textContent).toBe(BMAD_UPGRADE_REFUSED_TEXT);
    expect(state.bodies).toEqual([{ upgrade: true }, { upgrade: true }]);
  });
});

describe('Board in reduced mode (entry 4.11)', () => {
  it('reduced_mode: the notice instead of the board, no card menu; a completed upgrade shows the tickets', async () => {
    mount(<BoardTickets wsId={WS} />);
    await settle();
    expect(screen.getByTestId('reduced-mode-notice').textContent).toContain(BMAD_CAPABILITY_REDUCED_TEXT.ticket_tree);
    expect(screen.queryByTestId('board')).toBeNull();
    expect(screen.queryByTestId('ticket-card')).toBeNull();
    expect(screen.queryByRole('button', { name: /Change status/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    await upgrade();
    expect(state.bodies).toEqual([{ upgrade: true }]);
    await serverUpgrades();
    expect(screen.queryByTestId('reduced-mode-notice')).toBeNull();
    expect(screen.getAllByTestId('ticket-card')).toHaveLength(1);
    // The upgrade's progress and done line stay above the board, and focus went to the done line.
    expect(screen.getByTestId('bmad-setup-steps')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId('bmad-upgrade-done'));
  });
});
