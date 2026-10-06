// @vitest-environment happy-dom
/**
 * The Terminals settings page, the hidden tab and the question when Developer
 * mode is turned off with terminals running (epic 16, story 16.9): Developer
 * mode only, saved part by part, nothing on for a simple user.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const fake = vi.hoisted(() => ({
  developerMode: true,
  settings: { notifyNeedsAttention: false, notifyExited: false, notifyLaunchers: [] as string[], passProxies: false, passSshAgent: false, launcherArgs: {} as Record<string, string>, hidden: false },
  requests: [] as Array<{ method: string; path: string; body?: string }>,
  askFirst: false,
}));
const launcher = (id: string, label: string) => ({ launcher: { id, label, kind: 'cli', executables: {}, defaultArgs: [], promptPatterns: [], showWhenMissing: true }, detection: { launcherId: id, state: 'found' } });

vi.mock('@/appearance/appearance-provider', () => ({
  useAppearance: () => ({ appearance: { developerMode: fake.developerMode, terminalScreenReader: false }, update: () => {} }),
  useDeveloperModeOn: () => fake.developerMode,
}));
vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], store: undefined, caughtUp: true }) }));
vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      fake.requests.push({ method, path, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
      if (path.endsWith('/settings/terminals')) {
        if (method === 'PUT') fake.settings = { ...fake.settings, ...JSON.parse(String(init?.body)) };
        return new Response(JSON.stringify({ settings: fake.settings }));
      }
      if (path.endsWith('/terminals/launchers')) return new Response(JSON.stringify({ launchers: [launcher('claude-code', 'Claude Code'), launcher('codex', 'Codex')] }));
      if (path.endsWith('/settings/developer-mode') && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { developerMode: boolean; panes?: string };
        if (!body.developerMode && fake.askFirst && body.panes === undefined) {
          return new Response(JSON.stringify({ error: { code: 'panes_running', message: '2 terminals are still running. Stop them, or keep them running in the background until Ogden Agents stops?', details: { running: 2 } } }), { status: 409 });
        }
        return new Response(JSON.stringify({ developerMode: body.developerMode, everSet: true }));
      }
      return new Response('{}', { status: 404 });
    },
  },
}));

const { TerminalsSettingsPage } = await import('../src/routes/terminals-settings-page');
const { useDeveloperModeSave } = await import('../src/appearance/developer-mode');

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
const mount = async (node: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  await settle();
};

beforeEach(() => {
  fake.developerMode = true;
  fake.requests.length = 0;
  fake.askFirst = false;
  fake.settings = { notifyNeedsAttention: false, notifyExited: false, notifyLaunchers: [], passProxies: false, passSshAgent: false, launcherArgs: {}, hidden: false };
});
afterEach(() => cleanup());

vi.mock('../src/shell/workspace-header', () => ({ WorkspaceHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));

describe('the Terminals settings page', () => {
  it('without Developer mode says so and asks the server for nothing', async () => {
    fake.developerMode = false;
    await mount(<TerminalsSettingsPage />);
    expect(screen.getByTestId('terminals-settings-developer-mode')).toBeTruthy();
    expect(fake.requests).toEqual([]);
  });

  it('shows everything off, and each switch saves only its own setting', async () => {
    await mount(<TerminalsSettingsPage />);
    expect((screen.getByTestId('terminals-proxies') as HTMLElement).getAttribute('aria-checked')).toBe('false');
    expect((screen.getByTestId('terminals-ssh') as HTMLElement).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByTestId('terminals-proxies'));
    await settle();
    expect(fake.requests.filter((r) => r.method === 'PUT').map((r) => JSON.parse(r.body!))).toEqual([{ passProxies: true }]);
    fireEvent.click(screen.getByTestId('terminals-hidden'));
    await settle();
    expect(JSON.parse(fake.requests.filter((r) => r.method === 'PUT').at(-1)!.body!)).toEqual({ hidden: true });
  });

  it('notifications are per program, and a program\'s own arguments are saved when the field is left', async () => {
    await mount(<TerminalsSettingsPage />);
    fireEvent.click(screen.getByTestId('terminals-notify-codex'));
    await settle();
    expect(JSON.parse(fake.requests.filter((r) => r.method === 'PUT').at(-1)!.body!)).toEqual({ notifyLaunchers: ['codex'] });
    const field = screen.getByTestId('terminals-args-claude-code') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '--model big' } });
    fireEvent.blur(field);
    await settle();
    expect(JSON.parse(fake.requests.filter((r) => r.method === 'PUT').at(-1)!.body!)).toEqual({ launcherArgs: { 'claude-code': '--model big' } });
  });

  it('says what the limits are and how the chat\'s own terminal relates', async () => {
    await mount(<TerminalsSettingsPage />);
    expect(screen.getByTestId('terminals-limits').textContent).toBe('A project can have 8 terminals open at once, and Ogden Agents 16.');
    expect(screen.getByTestId('terminals-chat-note').textContent).toContain('Use the chat\'s Terminal switch');
  });
});

function Switcher() {
  const { save, terminalsQuestion, error } = useDeveloperModeSave();
  return (
    <div>
      <button data-testid="off" onClick={() => save(false)} />
      <button data-testid="off-stop" onClick={() => save(false, 'stop')} />
      <button data-testid="off-keep" onClick={() => save(false, 'keep')} />
      <p data-testid="question">{terminalsQuestion ?? ''}</p>
      <p data-testid="error">{error ?? ''}</p>
    </div>
  );
}

vi.mock('@/api/keep-saved', () => ({ keepSaved: async () => undefined }));

describe('turning Developer mode off with terminals running', () => {
  it('asks what to do with them (the server\'s own words), and saves again with the answer', async () => {
    fake.askFirst = true;
    await mount(<Switcher />);
    fireEvent.click(screen.getByTestId('off'));
    await settle();
    expect(screen.getByTestId('question').textContent).toContain('2 terminals are still running');
    expect(screen.getByTestId('error').textContent).toBe('');
    fireEvent.click(screen.getByTestId('off-keep'));
    await settle();
    expect(screen.getByTestId('question').textContent).toBe('');
    const puts = fake.requests.filter((r) => r.path.endsWith('/developer-mode')).map((r) => JSON.parse(r.body!));
    expect(puts).toEqual([{ developerMode: false }, { developerMode: false, panes: 'keep' }]);
  });

  it('with nothing running it just saves', async () => {
    await mount(<Switcher />);
    fireEvent.click(screen.getByTestId('off'));
    await settle();
    expect(screen.getByTestId('question').textContent).toBe('');
    expect(fake.requests.filter((r) => r.path.endsWith('/developer-mode'))).toHaveLength(1);
  });
});
