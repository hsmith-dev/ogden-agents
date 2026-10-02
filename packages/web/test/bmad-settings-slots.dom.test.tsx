// @vitest-environment happy-dom
/**
 * The BMad Method section's two slots (story 10.7), in a DOM: a project
 * whose repo already has `_bmad/` and every piece off gets the quiet note
 * (no buttons, whatever Not now said); a plain repo or a piece on gets none;
 * the default line names the app-wide default and links to Settings → New
 * projects in every case; and a slot whose answer is unknown (loading or a
 * failed request) is absent, wrapper and all. The data hooks are replaced;
 * nothing reaches a server.
 */
import {
  BMAD_COMING_SOON_REASON,
  BMAD_NEW_PROJECTS_LINK,
  BMAD_PIECES,
  BMAD_REPO_HAS_BMAD_TEXT,
  type BmadDetection,
  type BmadPiece,
  type NewProjectDefaults,
  type WorkspaceSettings,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../src/ui/tooltip';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

/** A query's answer as the hooks see it. */
interface Answer<T> {
  data: T | undefined;
  isError: boolean;
  error: Error | undefined;
}
const ok = <T,>(data: T): Answer<T> => ({ data, isError: false, error: undefined });
const loading = <T,>(): Answer<T> => ({ data: undefined, isError: false, error: undefined });
const failed = <T,>(): Answer<T> => ({ data: undefined, isError: true, error: new Error("Ogden Agents couldn't load it") });

const state = vi.hoisted(() => ({
  detection: undefined as unknown,
  settings: undefined as unknown,
  defaults: undefined as unknown,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: <T,>({ select }: { select: (router: { location: { hash: string } }) => T }): T => select({ location: { hash: '' } }),
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/workspaces/workspace-settings-api', async () => {
  const actual = await vi.importActual<typeof import('../src/workspaces/workspace-settings-api')>('../src/workspaces/workspace-settings-api');
  return {
    createLatestGate: actual.createLatestGate,
    useWorkspaceSettings: () => state.settings,
    // Nothing shipped: every piece Coming soon (the offer and the note show all the same).
    useBmadPieces: () => ({
      data: BMAD_PIECES.map((piece) => ({ piece, available: false, reason: BMAD_COMING_SOON_REASON })),
      error: undefined,
    }),
    updateBmadPieces: () => new Promise(() => {}),
  };
});

vi.mock('@/workspaces/bmad-detection-api', () => ({ useBmadDetection: () => state.detection }));
vi.mock('@/settings/new-project-defaults', () => ({ useNewProjectDefaults: () => state.defaults }));

const { BmadMethodSection } = await import('../src/workspaces/bmad-method-section');
const { useBmadRepoNoteSlot, useNewProjectsDefaultSlot } = await import('../src/workspaces/bmad-settings-slots');

function Page() {
  const offerSlot = useBmadRepoNoteSlot(WS);
  const defaultSlot = useNewProjectsDefaultSlot();
  return <BmadMethodSection wsId={WS} offerSlot={offerSlot} defaultSlot={defaultSlot} />;
}

function mount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <Page />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const detection = (hasBmad: boolean, offerDismissed = false): Answer<BmadDetection> => ok({ hasBmad, hasOutput: false, offerDismissed });
const settings = (bmadPieces: BmadPiece[]): Answer<WorkspaceSettings> => ok({ cautionLevel: 'ask_every_time', bmadPieces });
const defaults = (bmadPieces: BmadPiece[]): Answer<NewProjectDefaults> => ok({ bmadPieces });

beforeEach(() => {
  state.detection = detection(true);
  state.settings = settings([]);
  state.defaults = defaults([]);
});
afterEach(cleanup);

describe('the BMad Method section slots (story 10.7)', () => {
  it('a _bmad/ repo with every piece off: the note, with no buttons, and the default line with its link', () => {
    mount();
    const note = screen.getByTestId('bmad-offer-slot');
    expect(note.textContent).toBe(BMAD_REPO_HAS_BMAD_TEXT);
    expect(note.textContent).toContain('already has BMad Method files');
    expect(within(note).queryAllByRole('button')).toEqual([]);
    expect(within(note).queryAllByRole('link')).toEqual([]);
    // Context, not the offer: the offer's own element is not here.
    expect(screen.queryByTestId('bmad-offer')).toBeNull();

    const line = screen.getByTestId('bmad-default-slot');
    expect(line.textContent).toBe(`New projects start as Simple chats. ${BMAD_NEW_PROJECTS_LINK}`);
    const link = within(line).getByRole('link', { name: BMAD_NEW_PROJECTS_LINK });
    expect(link.getAttribute('href')).toBe('/settings/new-projects');
    expect(within(line).queryAllByRole('button')).toEqual([]);
  });

  it('the note ignores Not now: it shows after the offer was dismissed', () => {
    state.detection = detection(true, true);
    mount();
    expect(screen.getByTestId('bmad-offer-slot').textContent).toBe(BMAD_REPO_HAS_BMAD_TEXT);
  });

  it('a plain repo: no note, and the default line still shows', () => {
    state.detection = detection(false);
    mount();
    expect(screen.queryByTestId('bmad-offer-slot')).toBeNull();
    expect(screen.queryByTestId('bmad-repo-note')).toBeNull();
    expect(screen.getByTestId('bmad-default-slot').textContent).toContain('New projects start as Simple chats.');
  });

  it('a piece on: no note, and the default line still shows', () => {
    state.settings = settings(['planning']);
    mount();
    expect(screen.queryByTestId('bmad-offer-slot')).toBeNull();
    expect(screen.getByTestId('bmad-default-slot')).toBeTruthy();
  });

  it('the default line names a BMad Method default with its features', () => {
    state.defaults = defaults(['planning', 'board']);
    mount();
    expect(screen.getByTestId('bmad-default-slot').textContent).toBe(`New projects start with BMad Method: Planning and Board. ${BMAD_NEW_PROJECTS_LINK}`);
  });

  it.each([
    ['detection loading', () => (state.detection = loading())],
    ['detection failed', () => (state.detection = failed())],
    ['settings loading', () => (state.settings = loading())],
    ['settings failed', () => (state.settings = failed())],
  ])('%s: no note slot at all', (_what, arrange) => {
    arrange();
    mount();
    expect(screen.queryByTestId('bmad-offer-slot')).toBeNull();
  });

  it.each([
    ['loading', () => (state.defaults = loading())],
    ['failed', () => (state.defaults = failed())],
  ])('the default %s: no default slot at all', (_what, arrange) => {
    arrange();
    mount();
    expect(screen.queryByTestId('bmad-default-slot')).toBeNull();
    // The note doesn't depend on it.
    expect(screen.getByTestId('bmad-offer-slot')).toBeTruthy();
  });
});
