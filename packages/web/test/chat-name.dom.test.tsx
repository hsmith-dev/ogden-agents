// @vitest-environment happy-dom
/**
 * Chat names in a DOM (backlog story 12): the header's Rename opens a field
 * with the shown name; Enter or leaving it saves (normalized), Esc cancels
 * without a request and focus goes back to Rename; an unchanged automatic
 * name sends nothing; a saved rename is announced; a refusal is said; and
 * `session.renamed` events are laid over the lists in log order.
 */
import type { CoreEvent, Session } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatHeaderRename, renamedAnnouncement, useChatRename, withNames } from '../src/chat/chat-name';

const api = vi.hoisted(() => ({ call: (() => undefined) as unknown as import('vitest').Mock }));
vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  call: (...args: unknown[]) => api.call(...args),
}));

afterEach(cleanup);

const SAVED = { id: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3', workspaceId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', kind: 'chat', state: 'idle', driver: 'ui', title: 'Login work', autoTitle: 'Fix the login bug', adapterRefs: {}, createdAt: '2026-10-04T00:00:00.000Z', updatedAt: '2026-10-04T00:00:00.000Z' };

function Header({ name, title }: { name: string; title: string | null }) {
  const rename = useChatRename({ wsId: 'ws_a', sesId: 'ses_a', name, title });
  return <ChatHeaderRename rename={rename} name={name} />;
}

function mount(name = 'Fix the login bug', title: string | null = null, reply: () => unknown = () => ({ session: SAVED })) {
  const fetch = vi.fn(async (_auth: unknown, _path: string, _init: RequestInit) => reply());
  api.call = fetch;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Header name={name} title={title} />
    </QueryClientProvider>,
  );
  return { fetch, rename: screen.getByTestId('chat-rename') };
}

const field = () => screen.getByRole('textbox', { name: 'Chat name' }) as HTMLInputElement;
const body = (fetch: ReturnType<typeof vi.fn>) => JSON.parse(String((fetch.mock.calls[0]?.[2] as RequestInit | undefined)?.body));

describe('renaming from the header', () => {
  it('opens a field with the name, focused; Esc cancels with no request and focus back on Rename', async () => {
    const { fetch, rename } = mount();
    expect(rename.getAttribute('aria-label')).toBe('Rename Fix the login bug');
    fireEvent.click(rename);
    expect(field().value).toBe('Fix the login bug');
    expect(document.activeElement).toBe(field());
    expect(field().maxLength).toBe(160);
    fireEvent.change(field(), { target: { value: 'Other' } });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('chat-rename')));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('Enter saves the normalized name and announces it', async () => {
    const { fetch, rename } = mount();
    fireEvent.click(rename);
    fireEvent.change(field(), { target: { value: '  Login\n  work ' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(String(fetch.mock.calls[0]?.[1])).toBe('/api/v1/workspaces/ws_a/sessions/ses_a/title');
    expect(body(fetch)).toEqual({ title: 'Login work' });
    await waitFor(() => expect(screen.getByTestId('chat-rename-status').textContent).toBe('Chat renamed to Login work'));
  });

  it('leaving the field saves; a blank name clears; the automatic name unchanged sends nothing', async () => {
    const first = mount('Login work', 'Login work');
    fireEvent.click(first.rename);
    fireEvent.change(field(), { target: { value: '   ' } });
    fireEvent.blur(field());
    await waitFor(() => expect(first.fetch).toHaveBeenCalledTimes(1));
    expect(body(first.fetch)).toEqual({ title: null });
    cleanup();

    const second = mount();
    fireEvent.click(second.rename);
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(second.fetch).not.toHaveBeenCalled();
  });

  it('a name over 80 characters is said, and not sent; leaving the field never pulls focus back', async () => {
    const { fetch, rename } = mount();
    fireEvent.click(rename);
    fireEvent.change(field(), { target: { value: 'x'.repeat(81) } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('A chat name can be at most 80 characters.');
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('chat-rename'));
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    fireEvent.blur(field());
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('a refusal is said in plain words, and the field opens again with what was typed', async () => {
    const { rename } = mount('Fix the login bug', null, () => {
      throw new Error('A chat name can be at most 80 characters.');
    });
    fireEvent.click(rename);
    fireEvent.change(field(), { target: { value: 'Something' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A chat name can be at most 80 characters.'));
    fireEvent.click(screen.getByTestId('chat-rename'));
    expect(field().value).toBe('Something');
  });

  it('a cleared name is announced with the name it falls back to', () => {
    expect(renamedAnnouncement(null, 'Fix the login bug')).toBe('Chat name cleared, back to Fix the login bug');
  });
});

describe('withNames', () => {
  it('lays each chat’s latest session.renamed over it, in log order', () => {
    const sessions = [{ id: 'ses_a', title: null, autoTitle: null }, { id: 'ses_b', title: 'B', autoTitle: null }] as unknown as Session[];
    const renamed = (sesId: string, title: string | null, autoTitle: string | null) =>
      ({ type: 'session.renamed', payload: { sessionId: sesId, title, autoTitle, cause: 'user' } }) as unknown as CoreEvent;
    const named = withNames(sessions, [renamed('ses_a', null, 'Auto'), renamed('ses_a', 'Mine', 'Auto')]);
    expect(named.map((s) => [s.title, s.autoTitle])).toEqual([
      ['Mine', 'Auto'],
      ['B', null],
    ]);
    expect(withNames(sessions, [])).toEqual(sessions);
  });
});
