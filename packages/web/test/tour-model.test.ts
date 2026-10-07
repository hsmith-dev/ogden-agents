import { BMAD_COMING_SOON_REASON, BMAD_PIECES, type BmadPiece, type BmadPieceAvailability } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { placeTourCard, tourArms, TOUR_TARGETS, tourSteps } from '../src/tour/tour-model';

const all = (available: readonly BmadPiece[]): BmadPieceAvailability[] =>
  BMAD_PIECES.map((piece) => (available.includes(piece) ? { piece, available: true } : { piece, available: false, reason: BMAD_COMING_SOON_REASON }));

describe('tourSteps (backlog story 19, AC1 and AC2)', () => {
  it('shows only the three fixed steps with every BMad piece off', () => {
    const steps = tourSteps([], all([]));
    expect(steps.map((step) => step.id)).toEqual(['chat', 'sidebar', 'permissions']);
    expect(steps.find((step) => step.id === 'chat')?.target).toBe(TOUR_TARGETS.chat);
    expect(steps.find((step) => step.id === 'sidebar')?.target).toBe(TOUR_TARGETS.sidebar);
    // Permission cards can't be relied on to exist yet: the step points at nothing.
    expect(steps.find((step) => step.id === 'permissions')?.target).toBeNull();
  });

  it('adds Plan when Planning is on for this project and ships on this install', () => {
    const steps = tourSteps(['planning'], all(['planning', 'board']));
    expect(steps.map((step) => step.id)).toEqual(['chat', 'sidebar', 'permissions', 'plan']);
    expect(steps.find((step) => step.id === 'plan')?.target).toBe(TOUR_TARGETS.plan);
  });

  it('adds Board when Board is on; adds both when both are on', () => {
    expect(tourSteps(['board'], all(['planning', 'board'])).map((step) => step.id)).toEqual(['chat', 'sidebar', 'permissions', 'board']);
    expect(tourSteps(['planning', 'board'], all(['planning', 'board'])).map((step) => step.id)).toEqual(['chat', 'sidebar', 'permissions', 'plan', 'board']);
  });

  it('skips Plan/Board when the piece is on but this install does not ship it (coming soon)', () => {
    expect(tourSteps(['planning', 'board'], all([])).map((step) => step.id)).toEqual(['chat', 'sidebar', 'permissions']);
  });

  it('treats unknown pieces/availability as every BMad piece off', () => {
    expect(tourSteps(undefined, undefined).map((step) => step.id)).toEqual(['chat', 'sidebar', 'permissions']);
  });
});

describe('tourArms (AC1, AC3)', () => {
  it('arms only on the change from not-done to done, never on arrival or when already done', () => {
    expect(tourArms(false, true)).toBe(true);
    expect(tourArms(undefined, true)).toBe(false);
    expect(tourArms(true, true)).toBe(false);
    expect(tourArms(false, false)).toBe(false);
    expect(tourArms(true, false)).toBe(false);
  });
});

describe('placeTourCard', () => {
  const viewport = { width: 1000, height: 800 };
  const card = { width: 320, height: 200 };

  it('centers the card, clamped inside the viewport, when there is nothing to point at', () => {
    expect(placeTourCard(undefined, viewport, card)).toEqual({ top: 300, left: 340 });
  });

  it('places the card below its target when there is room', () => {
    const target = { top: 100, left: 100, width: 50, height: 20 };
    expect(placeTourCard(target, viewport, card)).toEqual({ top: 132, left: 100 });
  });

  it('places the card above its target when there is no room below', () => {
    const target = { top: 750, left: 100, width: 50, height: 20 };
    const result = placeTourCard(target, viewport, card);
    expect(result.top).toBeLessThan(target.top);
    expect(result.top + card.height).toBeLessThanOrEqual(target.top);
  });

  it('keeps the card fully inside the viewport even near an edge', () => {
    const target = { top: 10, left: 990, width: 5, height: 5 };
    const result = placeTourCard(target, viewport, card);
    expect(result.left).toBeGreaterThanOrEqual(8);
    expect(result.left + card.width).toBeLessThanOrEqual(viewport.width - 8);
  });
});
