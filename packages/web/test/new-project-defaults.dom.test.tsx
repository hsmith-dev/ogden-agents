// @vitest-environment happy-dom
/**
 * Settings → New projects' wiring in a DOM (story 10.4): BMad Method stays
 * shown when its last feature is turned off, whether it was loaded from the
 * server or picked with its radio, and a failed switch shows the option
 * still kept. The REST calls are replaced.
 */
import { BMAD_COMING_SOON_REASON, BMAD_PIECES, type BmadPiece, type BmadPieceAvailability } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewProjectDefaultsSection } from '../src/settings/new-project-defaults';
import { TooltipProvider } from '../src/ui/tooltip';

const state = vi.hoisted(() => ({
  stored: [] as string[],
  failSave: false,
  saves: [] as string[][],
}));

vi.mock('@/api/http', () => ({
  call: async (_auth: unknown, _path: string, init: RequestInit) => {
    if (init.method === 'PATCH') {
      const { bmadPieces } = JSON.parse(String(init.body)) as { bmadPieces: string[] };
      state.saves.push(bmadPieces);
      if (state.failSave) throw new Error('Nope.');
      state.stored = bmadPieces;
    }
    return { defaults: { bmadPieces: state.stored } };
  },
}));
vi.mock('@/workspaces/workspace-settings-api', async (importOriginal) => {
  const all = (available: readonly BmadPiece[]): BmadPieceAvailability[] =>
    BMAD_PIECES.map((piece) => (available.includes(piece) ? { piece, available: true } : { piece, available: false, reason: BMAD_COMING_SOON_REASON }));
  return { ...(await importOriginal<object>()), useBmadPieces: () => ({ data: all(['planning', 'board']), error: null }) };
});

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <NewProjectDefaultsSection />
      </TooltipProvider>
    </QueryClientProvider>,
  );

const checked = (role: 'radio' | 'checkbox', name: string) => screen.getByRole(role, { name }).getAttribute('aria-checked');
const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  state.stored = [];
  state.failSave = false;
  state.saves = [];
});
afterEach(cleanup);

describe('Settings → New projects (story 10.4)', () => {
  it('a default loaded with Planning stays on BMad Method when Planning is turned off', async () => {
    state.stored = ['planning'];
    show();
    await screen.findByRole('checkbox', { name: 'Planning' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Planning' }));
    await settle();
    expect(state.saves).toEqual([[]]);
    expect(checked('radio', 'BMad Method')).toBe('true');
    expect(checked('checkbox', 'Planning')).toBe('false');
  });

  it('BMad Method picked with its radio stays shown when its last feature is turned off', async () => {
    show();
    fireEvent.click(await screen.findByRole('radio', { name: 'BMad Method' }));
    await settle();
    expect(state.saves).toEqual([['planning', 'board']]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Board' }));
    await settle();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Planning' }));
    await settle();
    expect(state.saves.at(-1)).toEqual([]);
    expect(checked('radio', 'BMad Method')).toBe('true');
  });

  it('a failed switch to BMad Method shows Simple chats again, with why', async () => {
    state.failSave = true;
    show();
    fireEvent.click(await screen.findByRole('radio', { name: 'BMad Method' }));
    await settle();
    expect(checked('radio', 'Simple chats')).toBe('true');
    expect(screen.getByTestId('new-projects-error').textContent).toContain('Nope.');
  });
});
