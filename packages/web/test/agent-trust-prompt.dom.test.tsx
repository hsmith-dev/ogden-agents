// @vitest-environment happy-dom
/**
 * The trust prompt where an agent asks for it (epic 12, 12.3; EXPERIENCE.md
 * "Agent needs a trusted project"): worded for the agent and the project's
 * own scripts, settings, hooks and MCP servers, it allows the project through
 * the same call the Board's prompt uses, and says when the files changed.
 */
import { PROJECT_TRUST_ALLOW, PROJECT_TRUST_CHANGED_TITLE, PROJECT_TRUST_TEXT, PROJECT_TRUST_TITLE, SCRIPT_TRUST_ALLOW } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const trust = vi.hoisted(() => ({ calls: [] as string[], fail: false }));

vi.mock('../src/workspaces/workspace-settings-api', async (importActual) => ({
  ...(await importActual<typeof import('../src/workspaces/workspace-settings-api')>()),
  trustProjectScripts: async (wsId: string) => {
    trust.calls.push(wsId);
    if (trust.fail) throw new Error('nope');
    return { cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: true };
  },
}));

const { ScriptTrustPrompt } = await import('../src/workspaces/script-trust-prompt');

afterEach(() => {
  cleanup();
  trust.calls = [];
  trust.fail = false;
});

const show = (props: Partial<Parameters<typeof ScriptTrustPrompt>[0]> & { onTrusted?: () => void } = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ScriptTrustPrompt wsId="ws_1" onTrusted={() => {}} {...props} />
    </QueryClientProvider>,
  );

describe('the trust prompt for an agent (12.3)', () => {
  it('names the agent and what it runs, and Trust project allows the project', async () => {
    const onTrusted = vi.fn();
    show({ agentName: 'Grok', onTrusted });
    expect(screen.getByTestId('script-trust-prompt').textContent).toContain(PROJECT_TRUST_TITLE('Grok'));
    expect(screen.getByTestId('script-trust-prompt').textContent).toContain(PROJECT_TRUST_TEXT('Grok'));
    expect(PROJECT_TRUST_TEXT('Grok')).toMatch(/agent settings, hooks and MCP servers/);
    expect(screen.getByTestId('script-trust-allow').textContent).toBe(PROJECT_TRUST_ALLOW);
    fireEvent.click(screen.getByTestId('script-trust-allow'));
    await waitFor(() => expect(onTrusted).toHaveBeenCalledOnce());
    expect(trust.calls).toEqual(['ws_1']);
  });

  it('says the files changed when the project was trusted before', () => {
    show({ agentName: 'Grok', changed: true });
    expect(screen.getByTestId('script-trust-prompt').getAttribute('data-changed')).toBe('true');
    expect(screen.getByTestId('script-trust-prompt').textContent).toContain(PROJECT_TRUST_CHANGED_TITLE('Grok'));
  });

  it('a refusal shows its reason and leaves the prompt; without an agent it is the Board’s wording', async () => {
    trust.fail = true;
    show({ agentName: 'Grok' });
    fireEvent.click(screen.getByTestId('script-trust-allow'));
    expect((await screen.findByTestId('script-trust-error')).textContent).toBe('nope');
    cleanup();
    show();
    expect(screen.getByTestId('script-trust-allow').textContent).toBe(SCRIPT_TRUST_ALLOW);
  });
});
