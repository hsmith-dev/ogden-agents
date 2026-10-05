// @vitest-environment happy-dom
/**
 * The "already uses BMad Method" offer (story 10.3), in a DOM: shown only
 * while the repo has `_bmad/`, every piece is off and Not now wasn't
 * answered; never while the detection failed; Not now hides it at once and
 * is sent to the server; Choose features links to the BMad Method settings
 * section; and a pieces change or Not now in another tab (its event)
 * hides it here. The REST calls go to a fake `tabAuth.fetch`; the event
 * stream and the router's `Link` are replaced.
 */
import {
  API_ROUTES,
  apiPath,
  BMAD_OFFER_CHOOSE,
  BMAD_OFFER_NOT_NOW,
  BMAD_OFFER_TEXT,
  WORKSPACE_SETTINGS_BMAD_ANCHOR,
  type BmadDetection,
  type BmadPiece,
  type CoreEvent,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId;

const state = vi.hoisted(() => ({
  detection: { hasBmad: true, hasOutput: false, offerDismissed: false } as BmadDetection | 'fail',
  pieces: [] as BmadPiece[],
  events: [] as unknown[],
  calls: [] as string[],
  offerFails: false,
}));

vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: state.events }) }));
vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      state.calls.push(`${method} ${path}`);
      if (path.endsWith('/bmad/detection')) {
        return state.detection === 'fail'
          ? new Response(JSON.stringify({ error: { code: 'internal', message: 'Nope.' } }), { status: 500 })
          : Response.json({ detection: state.detection });
      }
      if (path.endsWith('/bmad/offer')) {
        if (state.offerFails) return new Response(JSON.stringify({ error: { code: 'internal', message: 'Not saved.' } }), { status: 500 });
        if (state.detection !== 'fail') state.detection = { ...state.detection, offerDismissed: true };
        return new Response(null, { status: 204 });
      }
      if (path.endsWith('/settings')) return Response.json({ settings: { cautionLevel: 'ask_every_time', bmadPieces: state.pieces } });
      return new Response('{}', { status: 404 });
    },
  },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, hash, children, ...props }: { to: string; params: { wsId: string }; hash: string; children: ReactNode }) => (
    <a href={`${to.replace('$wsId', params.wsId)}#${hash}`} {...props}>
      {children}
    </a>
  ),
}));

const { TooltipProvider } = await import('../src/ui/tooltip');
const { BmadOffer } = await import('../src/workspaces/bmad-offer');
const { bmadOfferVisible } = await import('../src/workspaces/bmad-detection-api');

const DETECTION = apiPath(API_ROUTES.workspaceBmadDetection, { wsId: WS });
const OFFER = apiPath(API_ROUTES.workspaceBmadOffer, { wsId: WS });

/** Renders the offer as the chats page does (keyed by project); `rerender` may switch the project. */
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let wsId: string = WS;
  const node = () => (
    <QueryClientProvider client={client}>
      {/* The blocked notice's glyph has a tooltip, as in the app shell. */}
      <TooltipProvider>
        <BmadOffer key={wsId} wsId={wsId} />
      </TooltipProvider>
    </QueryClientProvider>
  );
  const view = render(node());
  return {
    rerender: (next?: string) => {
      if (next !== undefined) wsId = next;
      view.rerender(node());
    },
  };
}

/** Lets the queries settle. */
const settle = () => act(async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
});

beforeEach(() => {
  state.detection = { hasBmad: true, hasOutput: false, offerDismissed: false };
  state.pieces = [];
  state.events = [{ seq: 1, type: 'server.started', workspaceId: null }];
  state.calls = [];
  state.offerFails = false;
});
afterEach(cleanup);

describe('bmadOfferVisible', () => {
  const found: BmadDetection = { hasBmad: true, hasOutput: false, offerDismissed: false };
  it('is true only with _bmad/, every piece off and no Not now; unknown is false', () => {
    expect(bmadOfferVisible(found, [])).toBe(true);
    expect(bmadOfferVisible({ ...found, hasOutput: true }, [])).toBe(true);
    expect(bmadOfferVisible({ ...found, hasBmad: false, hasOutput: true }, [])).toBe(false);
    expect(bmadOfferVisible({ ...found, offerDismissed: true }, [])).toBe(false);
    expect(bmadOfferVisible(found, ['board'])).toBe(false);
    expect(bmadOfferVisible(undefined, [])).toBe(false);
    expect(bmadOfferVisible(found, undefined)).toBe(false);
  });
});

describe('BmadOffer (DOM)', () => {
  it('shows the offer with Choose features (to the BMad Method settings) and Not now', async () => {
    mount();
    await settle();
    const offer = screen.getByTestId('bmad-offer');
    expect(offer.textContent).toContain(BMAD_OFFER_TEXT);
    const choose = screen.getByTestId('bmad-offer-choose');
    expect(choose.textContent).toBe(BMAD_OFFER_CHOOSE);
    expect(choose.getAttribute('href')).toBe(`/w/${WS}/settings#${WORKSPACE_SETTINGS_BMAD_ANCHOR}`);
    expect(screen.getByTestId('bmad-offer-not-now').textContent).toBe(BMAD_OFFER_NOT_NOW);
    expect(state.calls).toContain(`GET ${DETECTION}`);
  });

  for (const [name, change] of [
    ['a piece is on', () => (state.pieces = ['planning'])],
    ['Not now was answered', () => (state.detection = { hasBmad: true, hasOutput: false, offerDismissed: true })],
    ['the repo has no _bmad/', () => (state.detection = { hasBmad: false, hasOutput: true, offerDismissed: false })],
    ['the detection fails', () => (state.detection = 'fail')],
  ] as const) {
    it(`shows nothing when ${name}`, async () => {
      change();
      mount();
      await settle();
      expect(screen.queryByTestId('bmad-offer')).toBeNull();
    });
  }

  it('Not now hides it at once, is sent to the server, and stays hidden', async () => {
    mount();
    await settle();
    fireEvent.click(screen.getByTestId('bmad-offer-not-now'));
    expect(screen.queryByTestId('bmad-offer')).toBeNull();
    await settle();
    expect(state.calls).toContain(`DELETE ${OFFER}`);
    expect(screen.queryByTestId('bmad-offer')).toBeNull();
  });

  it("Not now in one project doesn't hide another's offer when the page switches project", async () => {
    const OTHER = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W4';
    const view = mount();
    await settle();
    fireEvent.click(screen.getByTestId('bmad-offer-not-now'));
    await settle();
    expect(screen.queryByTestId('bmad-offer')).toBeNull();
    // The other project has its own, unanswered offer.
    state.detection = { hasBmad: true, hasOutput: false, offerDismissed: false };
    view.rerender(OTHER);
    await settle();
    expect(screen.getByTestId('bmad-offer')).toBeTruthy();
    expect(state.calls).toContain(`GET ${apiPath(API_ROUTES.workspaceBmadDetection, { wsId: OTHER as WorkspaceId })}`);
  });

  it('a failed Not now brings the offer back and says why', async () => {
    state.offerFails = true;
    mount();
    await settle();
    fireEvent.click(screen.getByTestId('bmad-offer-not-now'));
    expect(screen.queryByTestId('bmad-offer')).toBeNull();
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Not saved.');
    expect(screen.getByTestId('bmad-offer-not-now')).toBeTruthy();
  });

  it("hides when another tab turns a piece on or answers Not now (the project's events)", async () => {
    const view = mount();
    await settle();
    expect(screen.getByTestId('bmad-offer')).toBeTruthy();
    state.pieces = ['planning'];
    state.events = [...state.events, { seq: 2, type: 'workspace.settings_changed', workspaceId: WS } as unknown as CoreEvent];
    view.rerender();
    await waitFor(() => expect(screen.queryByTestId('bmad-offer')).toBeNull());

    cleanup();
    state.pieces = [];
    state.detection = { hasBmad: true, hasOutput: false, offerDismissed: false };
    state.events = [{ seq: 1, type: 'server.started', workspaceId: null }];
    const other = mount();
    await settle();
    expect(screen.getByTestId('bmad-offer')).toBeTruthy();
    state.detection = { ...state.detection, offerDismissed: true };
    state.events = [...state.events, { seq: 3, type: 'workspace.bmad_offer_dismissed', workspaceId: WS } as unknown as CoreEvent];
    other.rerender();
    await waitFor(() => expect(screen.queryByTestId('bmad-offer')).toBeNull());
  });
});
