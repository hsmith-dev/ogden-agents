// @vitest-environment happy-dom
/**
 * Worktree retention in the UI (epic 27, 27.6): Settings, Projects,
 * Worktrees (the cap as a whole number from 1 to 100, saved with PUT, and
 * the plain sentence that ignored files aren't kept and staged changes come
 * back unstaged), and Workspace settings' Put-away copies (newest first,
 * each branch with its saved files and Restore, the server's sentence when
 * Restore couldn't finish). The REST calls are stand-ins.
 */
import {
  putAwayFilesText,
  RESTORE_PATH_TAKEN_TEXT,
  restoreWorktreeLabel,
  WORKTREE_PUT_AWAY_NOT_KEPT_TEXT,
  WORKTREE_RESTORED_TEXT,
  type PutAwayWorktree,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../src/ui/tooltip';

const fake = vi.hoisted(() => ({
  keep: 15,
  saved: [] as number[],
  worktrees: [] as PutAwayWorktree[],
  restores: [] as string[],
  restoreFails: undefined as string | undefined,
}));

vi.mock('@/shell/workspace-header', () => ({ WorkspaceHeader: ({ title }: { title?: ReactNode }) => <header>{title}</header> }));
vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [] }) }));
vi.mock('@/worktrees/worktree-retention', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/worktrees/worktree-retention')>();
  const { useQuery } = await import('@tanstack/react-query');
  const { ChatApiError } = await import('../src/chat/chat-api');
  return {
    ...real,
    saveWorktreeRetention: async (keep: number) => {
      fake.saved.push(keep);
      fake.keep = keep;
      return { keep };
    },
    useWorktreeRetention: () => useQuery({ queryKey: real.worktreeRetentionQueryKey, queryFn: async () => ({ keep: fake.keep }) }),
    usePutAwayWorktrees: (wsId: string) => useQuery({ queryKey: real.putAwayWorktreesQueryKey(wsId), queryFn: async () => fake.worktrees }),
    useRestoreWorktree: () => async (sesId: string) => {
      fake.restores.push(sesId);
      if (fake.restoreFails !== undefined) throw new ChatApiError(fake.restoreFails, 409, 'restore_failed');
    },
  };
});

const { WorktreesSettingsPage } = await import('../src/routes/worktrees-settings-page');
const { PutAwayCopiesSection } = await import('../src/worktrees/put-away-section');

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => {});
}

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
}

const copy = (n: number, files: number): PutAwayWorktree => ({
  id: `wsn_01J9Z3K4M5N6P7Q8R9S0T1V2W${n}` as PutAwayWorktree['id'],
  sessionId: `ses_01J9Z3K4M5N6P7Q8R9S0T1V2W${n}` as PutAwayWorktree['sessionId'],
  workspaceId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as PutAwayWorktree['workspaceId'],
  branch: `ogden/chat/ses_01J9Z3K4M5N6P7Q8R9S0T1V2W${n}`,
  files,
  cause: 'retention',
  putAwayAt: '2026-11-01T12:00:00.000Z',
});

beforeEach(() => {
  fake.keep = 15;
  fake.saved = [];
  fake.worktrees = [];
  fake.restores = [];
  fake.restoreFails = undefined;
});
afterEach(() => cleanup());

describe('Settings, Projects, Worktrees (27.6)', () => {
  it('shows the cap and saves a new whole number from 1 to 100, saying plainly what is not kept', async () => {
    mount(<WorktreesSettingsPage />);
    await flush();
    const input = (await screen.findByTestId('worktree-retention-keep')) as HTMLInputElement;
    expect(input.value).toBe('15');
    expect(screen.getByTestId('worktree-retention-not-kept').textContent).toBe(WORKTREE_PUT_AWAY_NOT_KEPT_TEXT);
    const save = screen.getByTestId('worktree-retention-keep-save') as HTMLButtonElement;
    fireEvent.change(input, { target: { value: '0' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '101' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.click(save);
    await flush();
    expect(fake.saved).toEqual([3]);
    expect(screen.getByTestId('worktree-retention-keep-saved')).toBeTruthy();
    // No em or en dashes in what the page says.
    expect(document.body.textContent).not.toMatch(/[–—]/);
  });
});

describe("Workspace settings' Put-away copies (27.6)", () => {
  it('stays out of the way with nothing put away', async () => {
    mount(<PutAwayCopiesSection wsId="ws_1" />);
    await flush();
    expect(screen.queryByTestId('put-away-section')).toBeNull();
  });

  it('lists each copy with its branch, its saved files and Restore; a failed Restore says why', async () => {
    fake.worktrees = [copy(4, 2), copy(5, 0)];
    mount(<PutAwayCopiesSection wsId="ws_1" />);
    await flush();
    const rows = await screen.findAllByTestId('put-away-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain(fake.worktrees[0]!.branch);
    expect(rows[0]!.textContent).toContain(putAwayFilesText(2));
    expect(rows[1]!.textContent).toContain(putAwayFilesText(0));
    const buttons = screen.getAllByTestId('put-away-restore');
    expect(buttons[0]!.getAttribute('aria-label')).toBe(restoreWorktreeLabel(fake.worktrees[0]!.branch));

    fake.restoreFails = RESTORE_PATH_TAKEN_TEXT;
    fireEvent.click(buttons[0]!);
    await flush();
    expect(screen.getByTestId('put-away-error').textContent).toContain(RESTORE_PATH_TAKEN_TEXT);

    fake.restoreFails = undefined;
    fireEvent.click(screen.getAllByTestId('put-away-restore')[1]!);
    await flush();
    expect(fake.restores).toEqual([fake.worktrees[0]!.sessionId, fake.worktrees[1]!.sessionId]);
    expect(screen.getByTestId('put-away-restored').textContent).toBe(WORKTREE_RESTORED_TEXT);
  });
});
