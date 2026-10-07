import type { BmadPiece, BmadPieceAvailability } from '@ogden-agents/shared';
import { visibleWorkspaceTabs } from '@/shell/workspace-tabs';

/**
 * The guided tour (backlog story 19, CAP-16; extends epic 9's Welcome): a
 * short walkthrough shown once, right after onboarding finishes, pointing
 * out the app's main surfaces so a brand-new user knows what they are
 * looking at. Kept pure so it is tested without a browser; the overlay
 * (`tour-overlay.tsx`) and its DOM measurement are the only parts that need
 * one.
 */

export type TourStepId = 'chat' | 'sidebar' | 'permissions' | 'plan' | 'board';

export interface TourStep {
  id: TourStepId;
  title: string;
  description: string;
  /**
   * A CSS selector for the element this step highlights. `null` shows the
   * step centered, with no spotlight: permission cards (AC1) are dynamic —
   * none may be on screen the moment the tour runs — so this step explains
   * them without pointing at one.
   */
  target: string | null;
}

/**
 * The elements each step points at: the same ones `WorkspaceTabsView` (the
 * header's section tabs) and `StatusSidebar` already render, so the tour
 * never needs its own markup to hang off.
 */
export const TOUR_TARGETS = {
  chat: '[data-testid="workspace-tab-chats"]',
  sidebar: '[data-testid="status-sidebar"]',
  plan: '[data-testid="workspace-tab-plan"]',
  board: '[data-testid="workspace-tab-board"]',
} as const;

const BASE_STEPS: readonly TourStep[] = [
  {
    id: 'chat',
    title: 'Chat with your agent',
    description: 'This is where you talk with your agent about the project: ask for changes, ask questions, and read what it did.',
    target: TOUR_TARGETS.chat,
  },
  {
    id: 'sidebar',
    title: 'Your projects',
    description: 'Every project you add lives here, with its chats underneath. Switch between them anytime.',
    target: TOUR_TARGETS.sidebar,
  },
  {
    id: 'permissions',
    title: 'Permission cards',
    description: "When an agent wants to run a command, edit a file, or do something else that needs your say, a card like this shows up in the chat so you can allow or deny it.",
    target: null,
  },
];

/**
 * This project's tour (AC2): the three fixed steps, plus Plan and/or Board,
 * each only when this project actually shows that tab — the same pieces and
 * availability `WorkspaceTabs` already uses, so the tour never disagrees
 * with the tabs underneath it. A project with neither piece on skips both
 * steps entirely.
 */
export function tourSteps(pieces: readonly BmadPiece[] | undefined, availability: readonly BmadPieceAvailability[] | undefined): TourStep[] {
  const visible = new Set(visibleWorkspaceTabs(pieces, availability).map((tab) => tab.id));
  const steps = [...BASE_STEPS];
  if (visible.has('plan')) {
    steps.push({
      id: 'plan',
      title: 'Plan',
      description: "Planning is on for this project: break the work into epics and stories, and follow your agent's progress on Plan.",
      target: TOUR_TARGETS.plan,
    });
  }
  if (visible.has('board')) {
    steps.push({
      id: 'board',
      title: 'Board',
      description: 'Board is on for this project: see every ticket and its status as the work moves through it.',
      target: TOUR_TARGETS.board,
    });
  }
  return steps;
}

/**
 * Whether the tour arms itself to auto-start (AC1): only on the change to
 * Welcome being done, never on arrival. So a user whose Welcome was already
 * done before this ran (`previous` starts `undefined` until it is first
 * seen) never gets the tour out of nowhere, and once it has armed for this
 * run it never arms again (AC3) — the caller keeps that half of the rule.
 */
export function tourArms(previous: boolean | undefined, now: boolean): boolean {
  return previous === false && now;
}

export interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TourSize {
  width: number;
  height: number;
}

/** Keeps `value` inside `[min, max]`; `max < min` (nowhere to fit) keeps it at `min`. */
function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(value, min), max);
}

/**
 * Where the tour card sits: centered when there is nothing to point at,
 * else right under its target (or above, when there isn't room below),
 * always kept fully inside the viewport. Pure geometry, so it's tested
 * without a browser; the overlay feeds it real measurements.
 */
export function placeTourCard(target: TourRect | undefined, viewport: TourSize, card: TourSize, gap = 12, margin = 8): { top: number; left: number } {
  if (target === undefined) {
    return {
      top: clamp((viewport.height - card.height) / 2, margin, viewport.height - card.height - margin),
      left: clamp((viewport.width - card.width) / 2, margin, viewport.width - card.width - margin),
    };
  }
  const below = target.top + target.height + gap;
  const fitsBelow = below + card.height <= viewport.height - margin;
  const top = fitsBelow ? below : target.top - card.height - gap;
  const left = clamp(target.left, margin, viewport.width - card.width - margin);
  return { top: clamp(top, margin, viewport.height - card.height - margin), left };
}
