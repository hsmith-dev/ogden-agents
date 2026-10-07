// @vitest-environment happy-dom
/**
 * The guided tour's overlay (backlog story 19) in a DOM: it follows a
 * step's real target element, Skip and an outside click or Escape both
 * close it with nothing left mounted (AC4, AC5), an outside click's own
 * target still receives it (AC5: the app is never blocked), and Next/Back
 * walk a multi-step sequence ending in Done. Driven through the tour store
 * directly, the way `TourController` drives it, so this stays a test of the
 * overlay, not of the controller's wiring.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TourOverlay } from '../src/tour/tour-overlay';
import { closeTour, startTour } from '../src/tour/tour-store';
import type { TourStep } from '../src/tour/tour-model';

const start = (list: TourStep[]) => act(() => startTour(list));

const steps = (): TourStep[] => [
  { id: 'chat', title: 'Chat with your agent', description: 'Talk with your agent here.', target: '[data-testid="fake-chat-tab"]' },
  { id: 'sidebar', title: 'Your projects', description: 'Every project lives here.', target: '[data-testid="fake-sidebar"]' },
  { id: 'permissions', title: 'Permission cards', description: 'A card like this shows up to ask.', target: null },
];

/** A stand-in page with the real targets the tour's selectors point at, plus a plain button outside the tour entirely. */
function Harness() {
  return (
    <div>
      <button type="button" data-testid="fake-chat-tab" onClick={() => {}}>
        Chats
      </button>
      <aside data-testid="fake-sidebar" />
      <input data-testid="fake-composer" onFocus={() => {}} />
      <TourOverlay />
    </div>
  );
}

afterEach(() => {
  closeTour();
  cleanup();
});

describe('TourOverlay', () => {
  it('renders nothing while the tour is closed', () => {
    render(<Harness />);
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('highlights the current step\'s real target and shows its words', async () => {
    render(<Harness />);
    start(steps());
    await waitFor(() => expect(screen.getByTestId('tour-title').textContent).toBe('Chat with your agent'));
    expect(screen.getByTestId('tour-description').textContent).toBe('Talk with your agent here.');
    // A target step shows a spotlight box; no "Back" on the first step.
    expect(screen.getByTestId('tour-highlight')).toBeTruthy();
    expect(screen.queryByTestId('tour-back')).toBeNull();
    expect(screen.getByTestId('tour-next').textContent).toBe('Next');
  });

  it('the permissions step (no target) shows centered, with no spotlight box', async () => {
    render(<Harness />);
    start(steps());
    fireEvent.click(screen.getByTestId('tour-next'));
    fireEvent.click(screen.getByTestId('tour-next'));
    await waitFor(() => expect(screen.getByTestId('tour-title').textContent).toBe('Permission cards'));
    expect(screen.queryByTestId('tour-highlight')).toBeNull();
    // Last step: no Next, Done instead.
    expect(screen.getByTestId('tour-next').textContent).toBe('Done');
  });

  it('Back and Next walk the sequence; Done (the last Next) closes it', async () => {
    render(<Harness />);
    start(steps());
    await waitFor(() => expect(screen.getByTestId('tour-title').textContent).toBe('Chat with your agent'));
    fireEvent.click(screen.getByTestId('tour-next'));
    await waitFor(() => expect(screen.getByTestId('tour-title').textContent).toBe('Your projects'));
    fireEvent.click(screen.getByTestId('tour-back'));
    await waitFor(() => expect(screen.getByTestId('tour-title').textContent).toBe('Chat with your agent'));
    fireEvent.click(screen.getByTestId('tour-next'));
    fireEvent.click(screen.getByTestId('tour-next'));
    await waitFor(() => expect(screen.getByTestId('tour-next').textContent).toBe('Done'));
    fireEvent.click(screen.getByTestId('tour-next'));
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('Skip closes immediately with nothing left mounted (AC4)', async () => {
    render(<Harness />);
    start(steps());
    await waitFor(() => expect(screen.getByTestId('tour-card')).toBeTruthy());
    fireEvent.click(screen.getByTestId('tour-skip'));
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
    expect(screen.queryByTestId('tour-highlight')).toBeNull();
    expect(screen.queryByTestId('tour-card')).toBeNull();
  });

  it('a pointerdown outside the card closes the tour without swallowing the click (AC5)', async () => {
    render(<Harness />);
    start(steps());
    await waitFor(() => expect(screen.getByTestId('tour-card')).toBeTruthy());
    let clicked = false;
    screen.getByTestId('fake-chat-tab').addEventListener('click', () => (clicked = true));
    fireEvent.pointerDown(screen.getByTestId('fake-chat-tab'));
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
    // The event that closed the tour still reaches, and can act on, the real element underneath.
    fireEvent.click(screen.getByTestId('fake-chat-tab'));
    expect(clicked).toBe(true);
  });

  it('Escape closes the tour', async () => {
    render(<Harness />);
    start(steps());
    await waitFor(() => expect(screen.getByTestId('tour-card')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('a pointerdown inside the card does not close the tour', async () => {
    render(<Harness />);
    start(steps());
    await waitFor(() => expect(screen.getByTestId('tour-card')).toBeTruthy());
    fireEvent.pointerDown(screen.getByTestId('tour-card'));
    expect(screen.queryByTestId('tour-overlay')).toBeTruthy();
  });

  it('shows a dot per step', async () => {
    render(<Harness />);
    start(steps());
    await waitFor(() => expect(screen.getByTestId('tour-dots')).toBeTruthy());
    expect(screen.getByTestId('tour-dots').children).toHaveLength(3);
  });
});
