// @vitest-environment happy-dom
/**
 * `TourController` (backlog story 19) in a DOM: it arms only on the change
 * from Welcome not done to done (never on arrival, AC1/AC3), opens once a
 * project and its BMad pieces are known, building Plan/Board steps only for
 * the pieces this project actually has on (AC2), and services Settings'
 * Replay (AC4) the same way, for whichever project it names. `TourOverlay`
 * is replaced by a thin reader of the tour store, so this stays a test of
 * the controller's wiring (the overlay has its own test).
 */
import type { BmadPieceAvailability, OnboardingState } from '@ogden-agents/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTour, requestTourReplay, useTourState } from '../src/tour/tour-store';

interface FakeSettings {
  bmadPieces: readonly string[];
}

const state = vi.hoisted(() => ({
  wsId: undefined as string | undefined,
  onboarding: undefined as OnboardingState | undefined,
  settings: undefined as FakeSettings | undefined,
  settingsError: false,
  availability: undefined as BmadPieceAvailability[] | undefined,
  availabilityError: false,
}));

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ wsId: state.wsId }) }));
vi.mock('@/onboarding/onboarding-api', () => ({ useOnboarding: () => ({ data: state.onboarding }) }));
vi.mock('@/workspaces/workspace-settings-api', () => ({
  useWorkspaceSettings: () => ({ data: state.settings, isError: state.settingsError }),
  useBmadPieces: () => ({ data: state.availability, isError: state.availabilityError }),
}));
vi.mock('@/tour/tour-overlay', () => ({
  TourOverlay: () => {
    const { open, steps, index } = useTourState();
    return open ? <div data-testid="tour-open">{steps.map((step) => step.id).join(',')}</div> : null;
  },
}));

import { TourController } from '../src/tour/tour-controller';

beforeEach(() => {
  state.wsId = undefined;
  state.onboarding = undefined;
  state.settings = undefined;
  state.settingsError = false;
  state.availability = undefined;
  state.availabilityError = false;
});

afterEach(() => {
  act(() => closeTour());
  // A stray pending replay from one test must never leak into the next.
  act(() => requestTourReplay(''));
  cleanup();
});

describe('TourController', () => {
  it('never opens for a user whose Welcome was already done when the tab first loads (AC3)', () => {
    state.onboarding = { welcomeCompleted: true };
    state.wsId = 'ws_1';
    state.settings = { bmadPieces: [] };
    state.availability = [];
    render(<TourController />);
    expect(screen.queryByTestId('tour-open')).toBeNull();
  });

  it('arms on the welcomeCompleted transition, then opens once a project and its pieces are known, adapting to this project\'s BMad pieces (AC1, AC2)', () => {
    state.onboarding = { welcomeCompleted: false };
    const { rerender } = render(<TourController />);
    expect(screen.queryByTestId('tour-open')).toBeNull();

    // Welcome finishes; still no project in view yet.
    act(() => {
      state.onboarding = { welcomeCompleted: true };
    });
    rerender(<TourController />);
    expect(screen.queryByTestId('tour-open')).toBeNull();

    // Now on a project with Planning and Board both on.
    act(() => {
      state.wsId = 'ws_1';
      state.settings = { bmadPieces: ['planning', 'board'] };
      state.availability = [
        { piece: 'planning', available: true },
        { piece: 'board', available: true },
      ];
    });
    rerender(<TourController />);
    expect(screen.getByTestId('tour-open').textContent).toBe('chat,sidebar,permissions,plan,board');
  });

  it('skips Plan and Board when neither piece is on for this project (AC2)', () => {
    state.onboarding = { welcomeCompleted: false };
    const { rerender } = render(<TourController />);
    act(() => {
      state.onboarding = { welcomeCompleted: true };
      state.wsId = 'ws_1';
      state.settings = { bmadPieces: [] };
      state.availability = [];
    });
    rerender(<TourController />);
    expect(screen.getByTestId('tour-open').textContent).toBe('chat,sidebar,permissions');
  });

  it("services Settings' Replay for the project it names, with no transition needed (AC4)", () => {
    state.onboarding = { welcomeCompleted: true };
    state.wsId = 'ws_2';
    state.settings = { bmadPieces: [] };
    state.availability = [];
    const { rerender } = render(<TourController />);
    expect(screen.queryByTestId('tour-open')).toBeNull();

    act(() => requestTourReplay('ws_2'));
    rerender(<TourController />);
    expect(screen.getByTestId('tour-open')).toBeTruthy();
  });

  it("ignores a replay request for a different project than the one in view", () => {
    state.onboarding = { welcomeCompleted: true };
    state.wsId = 'ws_3';
    state.settings = { bmadPieces: [] };
    state.availability = [];
    const { rerender } = render(<TourController />);

    act(() => requestTourReplay('ws_other'));
    rerender(<TourController />);
    expect(screen.queryByTestId('tour-open')).toBeNull();
  });
});
