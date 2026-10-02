// @vitest-environment happy-dom
/**
 * The BMad Method section's wiring (story 10.5), in a DOM: each choice sends
 * one `PATCH settings` with the pieces the shared rule gives, the status
 * line says what else changed once saved, a refusal reverts the switches and
 * shows the server's message as an alert, a change from another tab updates
 * the switches without a status line, and opening the page at `#bmad-method`
 * focuses the section's heading once. Story 4.2: turning on a piece that
 * runs the project's scripts in a project not yet trusted opens the trust
 * dialog first; Allow trusts, then saves; Cancel changes nothing. The
 * settings API is replaced (the
 * settings query is a real query on a test client, so saved answers and
 * other tabs' changes land as they would); nothing reaches a server.
 */
import {
  BMAD_OFF_TEXT,
  BMAD_ON_TEXT,
  BMAD_PIECES,
  BMAD_COMING_SOON_REASON,
  SCRIPT_TRUST_TITLE,
  type BmadPiece,
  type BmadPieceAvailability,
  type WorkspaceSettings,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../src/ui/tooltip';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

const state = vi.hoisted(() => ({
  available: [] as BmadPieceAvailability[] | undefined,
  /** Each PATCH body's pieces. */
  patches: [] as BmadPiece[][],
  /** How the next PATCH answers: saved settings, or a refusal. */
  answer: undefined as undefined | ((pieces: BmadPiece[]) => Promise<WorkspaceSettings>),
  /** How many times the project was trusted (story 4.2), and how the next trust answers. */
  trusts: 0,
  trustAnswer: undefined as undefined | (() => Promise<WorkspaceSettings>),
  /** The router's location hash (without `#`), and who to tell when it changes. */
  hash: '',
  hashListeners: new Set<() => void>(),
}));

vi.mock('@tanstack/react-router', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useRouterState: <T,>({ select }: { select: (router: { location: { hash: string } }) => T }): T =>
      select({
        location: {
          hash: useSyncExternalStore(
            (listener) => {
              state.hashListeners.add(listener);
              return () => state.hashListeners.delete(listener);
            },
            () => state.hash,
          ),
        },
      }),
  };
});

/** An in-app navigation to another hash. */
const navigateToHash = (hash: string) =>
  act(() => {
    state.hash = hash;
    for (const listener of state.hashListeners) listener();
  });

vi.mock('@/workspaces/workspace-settings-api', async () => {
  const actual = await vi.importActual<typeof import('../src/workspaces/workspace-settings-api')>('../src/workspaces/workspace-settings-api');
  return {
    createLatestGate: actual.createLatestGate,
    useWorkspaceSettings: (wsId: string) =>
      useQuery({ queryKey: ['workspace-settings', wsId], queryFn: (): Promise<WorkspaceSettings> => new Promise(() => {}), staleTime: Number.POSITIVE_INFINITY }),
    useBmadPieces: () => ({ data: state.available, error: undefined }),
    updateBmadPieces: (_wsId: string, pieces: BmadPiece[]) => {
      state.patches.push([...pieces]);
      return state.answer!(pieces);
    },
    trustProjectScripts: () => {
      state.trusts++;
      return state.trustAnswer!();
    },
  };
});

const { BmadMethodSection } = await import('../src/workspaces/bmad-method-section');

const shipping = (...available: BmadPiece[]): BmadPieceAvailability[] =>
  BMAD_PIECES.map((piece) => (available.includes(piece) ? { piece, available: true } : { piece, available: false, reason: BMAD_COMING_SOON_REASON }));

/** Settings as the server answers them; trusted by default, so the 10.5 tests see no trust dialog. */
const settings = (bmadPieces: BmadPiece[], bmadScriptsTrusted = true): WorkspaceSettings => ({ cautionLevel: 'ask_every_time', bmadPieces, bmadScriptsTrusted });

function mount(stored: BmadPiece[], { trusted = true }: { trusted?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['workspace-settings', WS], settings(stored, trusted));
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <BmadMethodSection wsId={WS} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const sw = (id: string) => screen.getByTestId(id);
  const isOn = (id: string) => sw(id).getAttribute('aria-checked') === 'true';
  const status = () => screen.getByTestId('bmad-status').textContent;
  /** Clicks a switch and lets the save's answer land. */
  const click = async (id: string) => {
    await act(async () => {
      fireEvent.click(sw(id));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return { client, sw, isOn, status, click };
}

beforeEach(() => {
  state.available = shipping('planning', 'board', 'builds');
  state.patches = [];
  state.answer = (pieces) => Promise.resolve(settings(pieces));
  state.trusts = 0;
  state.trustAnswer = () => Promise.resolve(settings([], true));
  state.hash = '';
  state.hashListeners.clear();
});
afterEach(cleanup);

describe('BmadMethodSection (DOM)', () => {
  it('main on with Planning and Board shipped: PATCH both, status says BMad is on', async () => {
    const { isOn, status, click } = mount([]);
    await click('bmad-use');
    expect(state.patches).toEqual([['planning', 'board']]);
    expect(isOn('bmad-use')).toBe(true);
    expect(isOn('bmad-planning')).toBe(true);
    expect(isOn('bmad-board')).toBe(true);
    expect(status()).toBe(BMAD_ON_TEXT);
  });

  it('main on with only Board shipped: PATCH Board alone', async () => {
    state.available = shipping('board');
    const { click } = mount([]);
    await click('bmad-use');
    expect(state.patches).toEqual([['board']]);
  });

  it('Unattended builds on: Board turns on too and the status line says so', async () => {
    state.available = shipping('board', 'builds');
    const { isOn, status, click } = mount([]);
    await click('bmad-builds');
    expect(state.patches).toEqual([['board', 'builds']]);
    expect(isOn('bmad-board')).toBe(true);
    expect(status()).toBe(`${BMAD_ON_TEXT} Board was turned on too, because the feature you chose needs it.`);
  });

  it('Board off: Unattended builds goes too, and the files-stay line is said', async () => {
    const { isOn, status, click } = mount(['board', 'builds']);
    await click('bmad-board');
    expect(state.patches).toEqual([[]]);
    expect(isOn('bmad-builds')).toBe(false);
    expect(isOn('bmad-use')).toBe(false);
    expect(status()).toBe(`Unattended builds was turned off too, because it needs the feature you turned off. ${BMAD_OFF_TEXT}`);
    expect(status()).toContain('Your BMad files stay in this project.');
  });

  it('main off: every piece off, no confirmation, and the files-stay line', async () => {
    const { isOn, status, click } = mount(['planning', 'board']);
    await click('bmad-use');
    expect(state.patches).toEqual([[]]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    for (const piece of BMAD_PIECES) expect(isOn(`bmad-${piece}`)).toBe(false);
    expect(status()).toBe(BMAD_OFF_TEXT);
  });

  it('a stored piece now unavailable can be turned off', async () => {
    state.available = shipping();
    const { sw, click } = mount(['planning']);
    expect(sw('bmad-planning').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('bmad-planning-coming-soon').textContent).toBe('Coming soon');
    await click('bmad-planning');
    expect(state.patches).toEqual([[]]);
  });

  it('a refusal reverts the switches and shows the server message as an alert', async () => {
    let refuse: (error: Error) => void = () => {};
    state.answer = () => new Promise((_resolve, reject) => (refuse = reject));
    const { isOn, status, click } = mount([]);
    await click('bmad-planning');
    // Optimistic while the save is in flight.
    expect(isOn('bmad-planning')).toBe(true);
    await act(async () => {
      refuse(new Error("This BMad Method feature isn't in this version of Ogden Agents yet, so it can't be turned on."));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(isOn('bmad-planning')).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain("isn't in this version of Ogden Agents yet");
    expect(status()).toBe('');
  });

  it('a change from another tab updates the switches without a status line', async () => {
    const { client, isOn, status, click } = mount([]);
    await click('bmad-use');
    expect(status()).toBe(BMAD_ON_TEXT);
    await act(async () => {
      client.setQueryData(['workspace-settings', WS], settings(['planning', 'board', 'builds']));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(isOn('bmad-builds')).toBe(true);
    expect(status()).toBe('');
    await act(async () => {
      client.setQueryData(['workspace-settings', WS], settings([]));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(isOn('bmad-use')).toBe(false);
    expect(status()).toBe('');
    expect(state.patches).toHaveLength(1);
  });

  it("another tab going away and back to this tab's pieces leaves the line blank, and clears a refusal", async () => {
    const { client, status, click } = mount([]);
    await click('bmad-use');
    expect(status()).toBe(BMAD_ON_TEXT);
    const other = async (pieces: BmadPiece[]) =>
      act(async () => {
        client.setQueryData(['workspace-settings', WS], settings(pieces));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    await other([]);
    await other(['planning', 'board']);
    expect(status()).toBe('');

    state.answer = () => Promise.reject(new Error('Nope.'));
    await click('bmad-builds');
    expect(screen.getByRole('alert').textContent).toContain('Nope.');
    await other(['planning']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('switches are disabled while a save is in flight', async () => {
    state.answer = () => new Promise(() => {});
    const { sw, click } = mount([]);
    await click('bmad-planning');
    for (const id of ['bmad-use', ...BMAD_PIECES.map((piece) => `bmad-${piece}`)]) expect(sw(id).hasAttribute('disabled'), id).toBe(true);
    expect(state.patches).toHaveLength(1);
  });

  it('opened at #bmad-method: once loaded, the heading is scrolled into view and focused', () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    state.hash = 'bmad-method';
    mount([]);
    const heading = screen.getByRole('heading', { name: 'BMad Method' });
    expect(document.activeElement).toBe(heading);
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('opened at #bmad-method while the pieces list fails to load: still focused once the settings load', () => {
    state.available = undefined;
    state.hash = 'bmad-method';
    mount([]);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'BMad Method' }));
  });

  it('opened without the anchor: focus stays put until an in-app link arrives at it, each arrival once', () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    mount([]);
    const heading = screen.getByRole('heading', { name: 'BMad Method' });
    expect(document.activeElement).not.toBe(heading);
    navigateToHash('bmad-method');
    expect(document.activeElement).toBe(heading);
    expect(scrolled).toHaveBeenCalledTimes(1);
    act(() => heading.blur());
    navigateToHash('');
    navigateToHash('bmad-method');
    expect(document.activeElement).toBe(heading);
    expect(scrolled).toHaveBeenCalledTimes(2);
  });
});

describe('BmadMethodSection: the script trust (story 4.2, DOM)', () => {
  /** Lets pending promises (a trust, then a save) settle. */
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    });

  it('Board on in an untrusted project opens the dialog first; Cancel changes nothing', async () => {
    const { isOn, click } = mount([], { trusted: false });
    await click('bmad-board');
    expect(screen.getByRole('alertdialog').textContent).toContain(SCRIPT_TRUST_TITLE);
    expect(state.patches).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByTestId('script-trust-cancel'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(state.patches).toEqual([]);
    expect(state.trusts).toBe(0);
    expect(isOn('bmad-board')).toBe(false);
  });

  it('Allow trusts the project, then saves the choice', async () => {
    const { isOn, click } = mount([], { trusted: false });
    await click('bmad-board');
    fireEvent.click(screen.getByTestId('script-trust-confirm'));
    await settle();
    expect(state.trusts).toBe(1);
    expect(state.patches).toEqual([['board']]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(isOn('bmad-board')).toBe(true);
  });

  it('the main switch asks too (it turns on Board); a failed Allow says why and saves nothing', async () => {
    state.trustAnswer = () => Promise.reject(new Error('Ogden Agents could not reach the server.'));
    mount([], { trusted: false });
    await click();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('script-trust-confirm'));
    await settle();
    expect(screen.getByRole('alertdialog').textContent).toContain('could not reach the server');
    expect(state.patches).toEqual([]);

    async function click() {
      await act(async () => {
        fireEvent.click(screen.getByTestId('bmad-use'));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  });

  it('Planning alone, turning pieces off, and a trusted project never ask', async () => {
    const untrusted = mount([], { trusted: false });
    await untrusted.click('bmad-planning');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(state.patches).toEqual([['planning']]);
    cleanup();

    state.patches = [];
    const off = mount(['board'], { trusted: false });
    await off.click('bmad-board');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(state.patches).toEqual([[]]);
    cleanup();

    state.patches = [];
    const trusted = mount([]);
    await trusted.click('bmad-board');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(state.patches).toEqual([['board']]);
    expect(state.trusts).toBe(0);
  });
});
