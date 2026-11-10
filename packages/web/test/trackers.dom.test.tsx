// @vitest-environment happy-dom
/**
 * Issue trackers (CAP-35, epic 27): the Settings section adds a GitHub
 * account (repository required) and removes one; the picker is hidden with
 * no account, lists issues, and hands the server's context and chat name
 * to the caller. The page talks only to Ogden Agents' own API (mocked).
 */
import type { Issue, IssueContextResponse, TrackerAccount } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ACCOUNT: TrackerAccount = { id: 'trk_01J9Z3K4M5N6P7Q8R9S0T1V2W3', kind: 'github', label: 'Acme app', scope: 'acme/app', createdAt: '2026-11-10T00:00:00.000Z' };
const ISSUE: Issue = { kind: 'github', key: '42', identifier: '#42', title: 'Login button does nothing', url: 'https://github.com/acme/app/issues/42', status: 'open', assignees: [], description: 'Steps', updatedAt: null };
const PICKED: IssueContextResponse = { issue: ISSUE, context: 'I would like to work on this issue', chatName: '#42 Login button does nothing' };

const api = vi.hoisted(() => ({ accounts: [] as unknown[], add: vi.fn(), remove: vi.fn(), issues: vi.fn(), context: vi.fn() }));
vi.mock('../src/trackers/trackers-api', () => ({
  TRACKER_ACCOUNTS_QUERY_KEY: ['tracker-accounts'],
  useTrackerAccounts: () => ({ data: api.accounts, isError: false, error: undefined, refetch: vi.fn() }),
  addTrackerAccount: api.add,
  removeTrackerAccount: api.remove,
  fetchIssues: api.issues,
  fetchIssueContext: api.context,
}));

const { TrackersSection } = await import('../src/trackers/trackers-section');
const { IssuePicker } = await import('../src/trackers/issue-picker');
const { TooltipProvider } = await import('../src/ui/tooltip');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.accounts = [];
});

const mount = (node: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );

describe('the issue trackers settings', () => {
  it('adds a GitHub account only with a repository, sending the token once', async () => {
    api.add.mockResolvedValue(ACCOUNT);
    mount(<TrackersSection />);
    expect(screen.getByTestId('trackers-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tracker-add'));
    fireEvent.change(screen.getByTestId('tracker-label'), { target: { value: 'Acme app' } });
    fireEvent.change(screen.getByTestId('tracker-token'), { target: { value: 'ghp_x' } });
    expect((screen.getByTestId('tracker-token') as HTMLInputElement).type).toBe('password');
    expect(screen.getByTestId('tracker-submit').hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByTestId('tracker-scope'), { target: { value: 'acme/app' } });
    fireEvent.click(screen.getByTestId('tracker-submit'));
    await waitFor(() => expect(api.add).toHaveBeenCalledWith({ kind: 'github', label: 'Acme app', token: 'ghp_x', scope: 'acme/app' }));
    // Added: the form closes, so the token is no longer on the page.
    await waitFor(() => expect(screen.queryByTestId('tracker-token')).toBeNull());
  });

  it('shows the server’s plain reason when the token is refused', async () => {
    api.add.mockRejectedValue(new Error('The tracker refused the token.'));
    mount(<TrackersSection />);
    fireEvent.click(screen.getByTestId('tracker-add'));
    fireEvent.change(screen.getByTestId('tracker-label'), { target: { value: 'A' } });
    fireEvent.change(screen.getByTestId('tracker-scope'), { target: { value: 'acme/app' } });
    fireEvent.change(screen.getByTestId('tracker-token'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByTestId('tracker-submit'));
    expect((await screen.findByTestId('tracker-form-error')).textContent).toContain('refused the token');
  });

  it('lists an account and removes it', async () => {
    api.accounts = [ACCOUNT];
    api.remove.mockResolvedValue(undefined);
    mount(<TrackersSection />);
    expect(screen.getByTestId('tracker-account-row').textContent).toContain('acme/app');
    fireEvent.click(screen.getByTestId('tracker-account-remove'));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(ACCOUNT.id));
  });
});

describe('From an issue', () => {
  it('is not there with no account', () => {
    mount(<IssuePicker onPicked={() => {}} />);
    expect(screen.queryByTestId('start-from-issue')).toBeNull();
  });

  it('lists recent issues and hands the picked one’s context and name on', async () => {
    api.accounts = [ACCOUNT];
    api.issues.mockResolvedValue([ISSUE]);
    api.context.mockResolvedValue(PICKED);
    const onPicked = vi.fn();
    mount(<IssuePicker onPicked={onPicked} />);
    fireEvent.click(screen.getByTestId('start-from-issue'));
    const row = await screen.findByTestId('issue-picker-issue');
    expect(row.textContent).toContain('#42 Login button does nothing');
    expect(api.issues).toHaveBeenCalledWith(ACCOUNT.id, '');
    await act(async () => {
      fireEvent.click(row);
    });
    expect(api.context).toHaveBeenCalledWith(ACCOUNT.id, '42');
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith(PICKED));
  });
});
