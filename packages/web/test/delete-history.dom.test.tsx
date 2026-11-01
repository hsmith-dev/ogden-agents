// @vitest-environment happy-dom
/**
 * Delete history with chats' own worktrees (27.3): the confirmation says the
 * copies go too (with any changes not committed) when a chat has one, and
 * the one confirmation sends `discardUncommitted`; Confirm waits for the
 * chats; a 409 `uncommitted_changes` all the same asks again. The REST calls
 * are stand-ins.
 */
import { DELETE_AND_DISCARD_LABEL, DELETE_HISTORY_UNCOMMITTED_TEXT, deleteHistoryConfirmText } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  worktree: false,
  deletes: [] as boolean[],
  hold: false,
  release: undefined as (() => void) | undefined,
  results: [] as Array<() => Promise<unknown>>,
}));

vi.mock('@/workspaces/workspace-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/workspaces/workspace-api')>()),
  fetchSessions: async () => {
    if (fake.hold) await new Promise<void>((resolve) => (fake.release = resolve));
    return [{ id: 'ses_1', workspaceId: 'ws_1', kind: 'chat', state: 'idle', worktreePath: fake.worktree ? '/data/cw/abcdefgh' : null, branch: fake.worktree ? 'ogden/chat/ses_1' : null }];
  },
  deleteHistory: async (_wsId: string, discard: boolean) => {
    fake.deletes.push(discard);
    const result = fake.results[fake.deletes.length - 1];
    return result === undefined ? { deletedEvents: 1, deletedSessions: 1, deletedRuns: 0 } : result();
  },
}));

const { DeleteHistorySection } = await import('../src/routes/workspace-settings-page');
const { ChatApiError } = await import('../src/api/http');

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};

async function openDialog() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeleteHistorySection wsId="ws_1" name="repo" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByTestId('delete-history'));
  await flush();
  return screen.getByTestId('delete-history-confirm');
}

beforeEach(() => {
  fake.worktree = false;
  fake.deletes = [];
  fake.results = [];
  fake.hold = false;
  fake.release = undefined;
});

afterEach(() => cleanup());

describe('Delete history and chats’ copies (27.3)', () => {
  it('says only the chats go when no chat has its own worktree', async () => {
    const dialog = await openDialog();
    expect(dialog.textContent).toContain(deleteHistoryConfirmText('repo', false));
  });

  it('says the copies go too, with any changes not committed, and its one confirmation discards them', async () => {
    fake.worktree = true;
    const dialog = await openDialog();
    expect(dialog.textContent).toContain(deleteHistoryConfirmText('repo', true));
    expect(dialog.textContent).toContain('any changes not committed');
    fireEvent.click(screen.getByTestId('delete-history-confirm-button'));
    await flush();
    expect(fake.deletes).toEqual([true]);
    expect(screen.getByTestId('history-deleted')).toBeTruthy();
  });

  it('a refusal for uncommitted changes all the same names them and asks again (fallback)', async () => {
    fake.results = [() => Promise.reject(new ChatApiError('changes', 409, 'uncommitted_changes'))];
    const dialog = await openDialog();
    fireEvent.click(screen.getByTestId('delete-history-confirm-button'));
    await flush();
    expect(fake.deletes).toEqual([false]);
    expect(dialog.textContent).toContain(DELETE_HISTORY_UNCOMMITTED_TEXT);
    expect(screen.getByTestId('delete-history-confirm-button').textContent).toBe(DELETE_AND_DISCARD_LABEL);
    fireEvent.click(screen.getByTestId('delete-history-confirm-button'));
    await flush();
    expect(fake.deletes).toEqual([false, true]);
  });

  it('keeps Confirm disabled until the chats are known', async () => {
    fake.hold = true;
    const dialog = await openDialog();
    const confirm = screen.getByTestId('delete-history-confirm-button');
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(confirm);
    await flush();
    expect(fake.deletes).toEqual([]);
    fake.release?.();
    await flush();
    expect(screen.getByTestId('delete-history-confirm-button').getAttribute('aria-disabled')).toBe('false');
    expect(dialog.textContent).toContain(deleteHistoryConfirmText('repo', false));
  });
});
