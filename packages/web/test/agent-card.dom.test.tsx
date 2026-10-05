// @vitest-environment happy-dom
/**
 * Epic 6 entry 7 in the agent card: the version, the agent's own notes,
 * Uninstall (asked once more) and Sign out when the agent offers them, no
 * Install where it can't be installed, and no code box for a sign-in that
 * never asks for one.
 */
import type { AgentSetupStatus } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const actions = { uninstall: vi.fn(), signOut: vi.fn(), busy: undefined as 'uninstall' | 'sign_out' | undefined, error: undefined as string | undefined };
const signIn = { start: vi.fn(), cancel: vi.fn(), sendCode: vi.fn(), link: undefined, code: undefined, busy: false, error: undefined };

vi.mock('../src/agents/agent-setup-api', async (importActual) => ({
  ...(await importActual<typeof import('../src/agents/agent-setup-api')>()),
  useAgentActions: () => actions,
  useSignIn: () => signIn,
  useInstall: () => ({ start: vi.fn(), busy: false, error: undefined }),
  useApiKey: () => ({ save: vi.fn(), remove: vi.fn(), busy: false, error: undefined }),
}));

const { AgentCard } = await import('../src/agents/agent-card');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const card = (agent: Partial<AgentSetupStatus>) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentCard agent={{ agentId: 'antigravity', displayName: 'Antigravity', provider: 'Google', install: 'installed', version: '1.3.0', auth: 'needs_sign_in', ...agent }} />
    </QueryClientProvider>,
  );

describe('the agent card (epic 6 entry 7)', () => {
  it('says plainly when the agent is not available on this computer, with no Install', () => {
    card({ install: 'not_installed', version: null, canInstall: false, reason: "Antigravity isn't available on this computer." });
    expect(screen.getByTestId('agent-unavailable').textContent).toBe("Antigravity isn't available on this computer.");
    expect(screen.queryByRole('button', { name: /Install/ })).toBeNull();
  });

  it('shows what Install downloads beside the button', () => {
    card({ install: 'not_installed', version: null, installNote: 'Downloads about 112 MB from Google.' });
    expect(screen.getByTestId('agent-install-note').textContent).toBe('Downloads about 112 MB from Google.');
    expect(screen.getByRole('button', { name: /Install/ })).toBeTruthy();
  });

  it('installed: the version, the sign-in note, and Uninstall asked once more', () => {
    card({ canUninstall: true, signInNote: 'Finish signing in with Google in a browser on this computer.', installNote: 'Uninstall keeps your chats.' });
    expect(screen.getByTestId('agent-version').textContent).toBe('Version 1.3.0');
    expect(screen.getByTestId('agent-sign-in-note').textContent).toContain('browser on this computer');
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
    expect(actions.uninstall).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Uninstall Antigravity?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('group', { name: 'Uninstall Antigravity?' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Uninstall' }).at(-1)!);
    expect(actions.uninstall).toHaveBeenCalledOnce();
  });

  it("shows the agent's plain-words notices (epic 12, 12.3), whatever its state, and nothing when it has none", () => {
    card({ auth: 'signed_in', method: 'subscription', canSignOut: true, notices: ["Codex keeps its sign-in in a file in Ogden Agents' data folder.", 'Codex downloads OpenAI’s plugins list when it starts.'] });
    expect(screen.getAllByTestId('agent-notice').map((notice) => notice.textContent)).toEqual([
      "Codex keeps its sign-in in a file in Ogden Agents' data folder.",
      'Codex downloads OpenAI’s plugins list when it starts.',
    ]);
    cleanup();
    card({ install: 'not_installed', version: null, notices: ['It uses the network.'] });
    expect(screen.getByTestId('agent-notice').textContent).toBe('It uses the network.');
    cleanup();
    card({ auth: 'signed_in' });
    expect(screen.queryByTestId('agent-notices')).toBeNull();
  });

  it('signed in with an account it can sign out of: Sign out', () => {
    card({ auth: 'signed_in', method: 'subscription', canSignOut: true });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(actions.signOut).toHaveBeenCalledOnce();
  });

  it('no Uninstall or Sign out for an agent that does not offer them', () => {
    card({ auth: 'signed_in', method: 'subscription' });
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull();
  });

  it('signing in: no code box when the sign-in never asks for one', () => {
    card({ auth: 'signing_in', signInTakesCode: false });
    expect(screen.queryByLabelText('Paste the code')).toBeNull();
    cleanup();
    card({ auth: 'signing_in' });
    expect(screen.getByLabelText('Paste the code')).toBeTruthy();
  });
});

describe('an API key only agent (Codex; user decision, 2026-10-05)', () => {
  const NOTICE = "Codex uses your own OpenAI API key. Signing in with a ChatGPT account isn't supported here, because OpenAI's terms don't allow other apps to use subscription sign-in.";
  const codex: Partial<AgentSetupStatus> = { agentId: 'codex', displayName: 'Codex', provider: 'OpenAI', version: '2.1.1', apiKeyOnly: true, notices: [NOTICE], apiKey: { saved: false } };

  it('says why there is no sign in, offers no Sign in, and asks for the key', () => {
    card(codex);
    expect(screen.getByTestId('agent-notice').textContent).toBe(NOTICE);
    expect(screen.getByTestId('agent-state').textContent).toContain('needs an API key');
    expect(screen.queryByRole('button', { name: /Sign in/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add an API key' })).toBeTruthy();
  });

  it('says the key is in use once it is saved, and offers Remove key', () => {
    card({ ...codex, auth: 'signed_in', method: 'api_key', apiKey: { saved: true, lastFour: '2468' } });
    expect(screen.getByTestId('agent-state').textContent).toContain('using your API key');
    expect(screen.getByTestId('agent-api-key-saved').textContent).toContain('2468');
    expect(screen.getByRole('button', { name: 'Remove key' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sign in|Sign out/ })).toBeNull();
  });

  it('shows the notice before it is installed too', () => {
    card({ ...codex, install: 'not_installed', version: null, apiKey: undefined });
    expect(screen.getByTestId('agent-notice').textContent).toBe(NOTICE);
  });
});

describe('Grok, an xAI API access token only agent (user decision, 2026-10-05)', () => {
  const NOTICE = "Grok works with your own xAI API access token only. Signing in with an account isn't supported here.";
  const grok: Partial<AgentSetupStatus> = { agentId: 'grok', displayName: 'Grok', provider: 'xAI', version: '1.0.49', apiKeyOnly: true, apiKeyName: 'xAI API access token', notices: [NOTICE], apiKey: { saved: false } };

  it('says why there is no sign in in every state, offers no Sign in, and asks for the token', () => {
    card({ ...grok, install: 'not_installed', version: null, apiKey: undefined });
    expect(screen.getByTestId('agent-notice').textContent).toBe(NOTICE);
    cleanup();
    card(grok);
    expect(screen.getByTestId('agent-notice').textContent).toBe(NOTICE);
    expect(screen.getByTestId('agent-state').textContent).toContain('needs an xAI API access token');
    expect(screen.queryByRole('button', { name: /Sign in/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add an xAI API access token' })).toBeTruthy();
  });

  it('says the token is in use once saved, with Remove token, and still the reason', () => {
    card({ ...grok, auth: 'signed_in', method: 'api_key', apiKey: { saved: true, lastFour: '2468' } });
    expect(screen.getByTestId('agent-state').textContent).toContain('using your xAI API access token');
    expect(screen.getByTestId('agent-api-key-saved').textContent).toBe('xAI API access token saved …2468');
    expect(screen.getByRole('button', { name: 'Remove token' })).toBeTruthy();
    expect(screen.getByTestId('agent-notice').textContent).toBe(NOTICE);
  });
});
