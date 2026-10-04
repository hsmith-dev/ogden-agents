// @vitest-environment happy-dom
/**
 * Welcome's first-project question in a DOM (story 10.4): asked on a first
 * run with Simple chats preselected, BMad Method greyed (and marked Coming
 * soon only once it is known nothing ships), Simple chats giving the dialog
 * `bmadPieces: []`, not asked when a project exists, and adding held until
 * it is known whether to ask. The queries and the dialog are replaced.
 */
import { BMAD_COMING_SOON_REASON, BMAD_PIECES, type BmadPiece, type BmadPieceAvailability, type OnboardingState } from '@ogden-agents/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectStep } from '../src/routes/welcome-page';
import { TooltipProvider } from '../src/ui/tooltip';

const state = vi.hoisted(() => ({
  onboarding: { welcomeCompleted: false } as OnboardingState | undefined,
  projects: [] as unknown[] | undefined,
  pieces: undefined as BmadPieceAvailability[] | undefined,
  dialog: { open: false, bmadPieces: undefined as readonly string[] | undefined },
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => {} }));
vi.mock('@/onboarding/onboarding-api', () => ({
  useOnboarding: () => ({ data: state.onboarding, isError: false }),
  useCompleteWelcome: () => ({ mutate: () => {}, isPending: false, isError: false }),
}));
vi.mock('@/workspaces/workspace-api', () => ({ useWorkspaces: () => ({ data: state.projects, isError: false }) }));
vi.mock('@/workspaces/workspace-settings-api', () => ({ useBmadPieces: () => ({ data: state.pieces, isError: false }) }));
vi.mock('@/workspaces/add-project-dialog', () => ({
  AddProjectDialog: (props: { open: boolean; bmadPieces?: readonly string[] }) => {
    state.dialog = { open: props.open, bmadPieces: props.bmadPieces };
    return null;
  },
}));

const all = (available: readonly BmadPiece[]): BmadPieceAvailability[] =>
  BMAD_PIECES.map((piece) => (available.includes(piece) ? { piece, available: true } : { piece, available: false, reason: BMAD_COMING_SOON_REASON }));

const show = () =>
  render(
    <TooltipProvider>
      <ProjectStep workspace={undefined} onOpened={() => {}} onContinue={() => {}} skip={null} />
    </TooltipProvider>,
  );

beforeEach(() => {
  state.onboarding = { welcomeCompleted: false };
  state.projects = [];
  state.pieces = all([]);
  state.dialog = { open: false, bmadPieces: undefined };
});
afterEach(cleanup);

describe("Welcome's first-project question (story 10.4)", () => {
  it('is asked on a first run with Simple chats preselected, and Simple chats gives the project every piece off', () => {
    show();
    expect(screen.getByTestId('first-project-question')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Simple chats' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(state.dialog).toEqual({ open: true, bmadPieces: [] });
  });

  it('greys BMad Method and marks it Coming soon when nothing ships; without the mark while that is loading', () => {
    show();
    expect((screen.getByRole('radio', { name: 'BMad Method' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('first-project-bmad-coming-soon')).toBeTruthy();
    cleanup();
    state.pieces = undefined;
    show();
    expect((screen.getByRole('radio', { name: 'BMad Method' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('first-project-bmad-coming-soon')).toBeNull();
  });

  it('BMad Method gives the project Planning and Board when they ship', () => {
    state.pieces = all(['planning', 'board']);
    show();
    fireEvent.click(screen.getByRole('radio', { name: 'BMad Method' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(state.dialog).toEqual({ open: true, bmadPieces: ['planning', 'board'] });
  });

  it('is not asked when a project exists, and the dialog gets no pieces (the default applies)', () => {
    state.projects = [{ id: 'ws_1' }];
    show();
    expect(screen.queryByTestId('first-project-question')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(state.dialog).toEqual({ open: true, bmadPieces: undefined });
  });

  it('holds Add project until it is known whether to ask', () => {
    state.projects = undefined;
    show();
    const add = screen.getByRole('button', { name: 'Add project' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(add);
    expect(state.dialog.open).toBe(false);
  });
});
