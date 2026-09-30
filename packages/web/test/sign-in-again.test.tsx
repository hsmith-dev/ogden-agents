import type { AgentAuthState, AgentSetupStatus, CoreEvent } from '@ogden-agents/shared';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SignIn } from '../src/agents/agent-setup-api';
import {
  API_KEY_REFUSED,
  armTracker,
  disarmTracker,
  initialTracker,
  observeAuth,
  observeSignInStarts,
  startAnswered,
  SIGN_IN_AGAIN,
  SIGNED_IN_TRY_AGAIN,
  SignInAgainView,
  type SignInAgainViewProps,
  type SignInTracker,
} from '../src/chat/sign-in-again';
import { TooltipProvider } from '../src/ui/tooltip';

/** Renders `node` inside a router that knows Settings: Agents, so its link gets its href. */
async function renderInRouter(node: ReactNode): Promise<string> {
  const root = createRootRoute({ component: () => <TooltipProvider>{node}</TooltipProvider> });
  const agents = createRoute({ getParentRoute: () => root, path: '/settings/agents' });
  const router = createRouter({ routeTree: root.addChildren([agents]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

const agent = (auth: AgentAuthState, extra: Partial<AgentSetupStatus> = {}): AgentSetupStatus => ({
  agentId: 'claude-code',
  displayName: 'Claude Code',
  install: 'installed',
  version: '2.1.0',
  auth,
  signInTab: 'page',
  ...extra,
});

const signIn = (extra: Partial<SignIn> = {}): SignIn => ({
  start: () => {},
  cancel: () => {},
  sendCode: async () => true,
  link: undefined,
  busy: false,
  error: undefined,
  ...extra,
});

const render = (props: Partial<SignInAgainViewProps>) =>
  renderInRouter(
    <SignInAgainView
      agent={agent('needs_sign_in')}
      signedIn={false}
      signIn={signIn()}
      reason={SIGN_IN_AGAIN}
      canTryAgain
      onSignIn={() => {}}
      onTryAgain={() => {}}
      {...props}
    />,
  );

const escaped = (text: string) => text.replace(/'/g, '&#x27;');

describe('Sign in again notice (story 9.4)', () => {
  it('expired sign-in: says so, with Sign in and Try again', async () => {
    const html = await render({});
    expect(html).toContain('data-sign-in="needs_sign_in"');
    expect(html).toContain('data-error-code="auth_required"');
    expect(html).toContain(SIGN_IN_AGAIN);
    expect(html).toMatch(/data-testid="sign-in-again"[^>]*>.*Sign in</);
    expect(html).toContain('data-testid="try-again"');
    // Nobody is told to open a terminal (AD-21).
    expect(html.toLowerCase()).not.toContain('terminal');
  });

  it('with no message to resend there is Sign in but no Try again; before the agents load, Sign in still shows', async () => {
    expect(await render({ canTryAgain: false })).not.toContain('data-testid="try-again"');
    const loading = await render({ agent: undefined });
    expect(loading).toContain('data-testid="sign-in-again"');
    expect(loading).toContain(SIGN_IN_AGAIN);
  });

  it('signing in: shows 9.1’s signing-in view (link, paste code, Cancel); Try again is disabled', async () => {
    const html = await render({ agent: agent('signing_in'), signIn: signIn({ link: 'https://claude.ai/oauth/authorize?x=1' }) });
    expect(html).toContain('data-sign-in="signing_in"');
    expect(html).toContain('Finish signing in in the tab that just opened.');
    expect(html).toContain('Open the sign-in page');
    expect(html).toContain('Paste the code');
    expect(html).toContain('>Cancel<');
    expect(html).not.toContain('data-testid="sign-in-again"');
    expect(html).toMatch(/aria-disabled="true"[^>]*data-testid="try-again"/);
  });

  it('sign-in failed: the reason and Sign in again', async () => {
    const html = await render({ agent: agent('failed', { reason: "Claude Code couldn't finish signing in. Try again." }) });
    expect(html).toContain('data-sign-in="failed"');
    expect(html).toContain(escaped("Claude Code couldn't finish signing in. Try again."));
    expect(html).toMatch(/data-testid="sign-in-again"[^>]*>.*Sign in again</);
  });

  it('a request that failed shows its words', async () => {
    expect(await render({ signIn: signIn({ error: "Ogden Agents couldn't start signing in. Try again." }) })).toContain('data-testid="agent-request-error"');
  });

  it('signed in: "Signed in. Try again to continue." with Try again enabled and no Sign in', async () => {
    const html = await render({ agent: agent('signed_in', { method: 'subscription' }), signedIn: true });
    expect(html).toContain('data-sign-in="signed_in"');
    expect(html).toContain(SIGNED_IN_TRY_AGAIN);
    expect(html).not.toContain('data-testid="sign-in-again"');
    expect(html).not.toMatch(/aria-disabled="true"[^>]*data-testid="try-again"/);
    expect(html).toContain('data-testid="try-again"');
  });

  it('API key refused: a link to Settings: Agents, no Sign in', async () => {
    const html = await render({ agent: agent('signed_in', { method: 'api_key', apiKey: { saved: true, lastFour: 'abcd' } }) });
    expect(html).toContain('data-sign-in="api_key"');
    expect(html).toContain(API_KEY_REFUSED);
    expect(html).toMatch(/href="\/settings\/agents"[^>]*>Change it in Settings: Agents</);
    expect(html).not.toContain('data-testid="sign-in-again"');
    expect(html).toContain('data-testid="try-again"');
  });

  it('signed in with the subscription but still refused (no sign-in seen here): Sign in again is offered', async () => {
    const html = await render({ agent: agent('signed_in', { method: 'subscription' }) });
    expect(html).toContain('data-sign-in="needs_sign_in"');
    expect(html).toContain('data-testid="sign-in-again"');
  });
});

/** Runs `steps` (auth states, or the user's clicks) through the tracker; returns how many resends fired. */
type Step = AgentAuthState | 'click-sign-in' | 'click-try-again' | 'start-request-failed' | `start-answered-${AgentAuthState}` | undefined;

function run(steps: readonly Step[]): { resends: number; tracker: SignInTracker } {
  let tracker = initialTracker;
  let resends = 0;
  for (const step of steps) {
    if (step === 'click-sign-in') tracker = armTracker(tracker);
    else if (step === 'click-try-again') tracker = disarmTracker(tracker);
    else if (step === 'start-request-failed') tracker = startAnswered(tracker, 'request_failed');
    else if (step?.startsWith('start-answered-')) tracker = startAnswered(tracker, step.slice('start-answered-'.length) as AgentAuthState);
    else {
      const next = observeAuth(tracker, step as AgentAuthState | undefined);
      tracker = next.tracker;
      if (next.resend) resends++;
    }
  }
  return { resends, tracker };
}

describe('Sign in again resends by itself exactly once (user decision B)', () => {
  it('the notice whose Sign in started the sign-in resends once it reaches signed_in', () => {
    const { resends, tracker } = run([undefined, 'needs_sign_in', 'click-sign-in', 'signing_in', 'signed_in']);
    expect(resends).toBe(1);
    expect(tracker.signedIn).toBe(true);
  });

  it('a fast sign-in that skips signing_in still resends once', () => {
    expect(run(['needs_sign_in', 'click-sign-in', 'signed_in']).resends).toBe(1);
  });

  it('repeated or later signed_in states never resend again (no loop if the agent still refuses)', () => {
    const { resends } = run(['needs_sign_in', 'click-sign-in', 'signing_in', 'signed_in', 'signed_in', 'needs_sign_in', 'signed_in', 'signed_in']);
    expect(resends).toBe(1);
  });

  it('another chat’s notice (no Sign in clicked here) shows Signed in but never resends', () => {
    const { resends, tracker } = run(['needs_sign_in', 'signing_in', 'signed_in']);
    expect(resends).toBe(0);
    expect(tracker.signedIn).toBe(true);
  });

  it('Try again clicked while signing in: nothing is resent by itself afterwards', () => {
    expect(run(['needs_sign_in', 'click-sign-in', 'signing_in', 'click-try-again', 'signed_in']).resends).toBe(0);
  });

  it('a failed or cancelled sign-in drops the click; a new Sign in arms it again', () => {
    expect(run(['needs_sign_in', 'click-sign-in', 'signing_in', 'failed', 'signing_in', 'signed_in']).resends).toBe(0);
    expect(run(['needs_sign_in', 'click-sign-in', 'signing_in', 'needs_sign_in', 'signed_in']).resends).toBe(0);
    expect(run(['needs_sign_in', 'click-sign-in', 'signing_in', 'failed', 'click-sign-in', 'signing_in', 'signed_in']).resends).toBe(1);
  });

  it('signed in already when the notice opened is not a sign-in it saw finish', () => {
    const { resends, tracker } = run(['signed_in', 'click-sign-in', 'signed_in']);
    expect(resends).toBe(0);
    expect(tracker.signedIn).toBe(false);
  });

  it('a Sign in whose start request failed (network, 409, refusal) never resends, even when a sign-in finishes elsewhere (review F1)', () => {
    expect(run(['needs_sign_in', 'click-sign-in', 'start-request-failed', 'signing_in', 'signed_in']).resends).toBe(0);
    expect(run(['needs_sign_in', 'click-sign-in', 'start-answered-failed', 'failed', 'signing_in', 'signed_in']).resends).toBe(0);
  });

  it('a start that did not begin its own sign-in disarms; one that did stays armed (review F2)', () => {
    expect(run(['needs_sign_in', 'click-sign-in', 'start-answered-needs_sign_in', 'signing_in', 'signed_in']).resends).toBe(0);
    expect(run(['needs_sign_in', 'click-sign-in', 'start-answered-signing_in', 'signing_in', 'signed_in']).resends).toBe(1);
  });

  it('a second sign-in started after this notice’s click (another tab) disarms it; its own start alone does not (review F2)', () => {
    const authChanged = (seq: number, state: AgentAuthState, agentId = 'claude-code') =>
      ({ type: 'agent.auth_changed', seq, streamId: 'agents', workspaceId: null, id: `evt_${seq}`, at: '2026-09-30T00:00:00.000Z', payload: { agentId, state } }) as unknown as CoreEvent;
    const armed = armTracker(observeAuth(initialTracker, 'needs_sign_in').tracker, 10);
    // An older start (before the click), another agent's, and this click's own: still armed.
    const own = [authChanged(9, 'signing_in'), authChanged(11, 'signing_in', 'other-agent'), authChanged(12, 'signing_in')];
    expect(observeSignInStarts(armed, own, 'claude-code').armed).toBe(true);
    // Another tab's Sign in replaced it (or was replaced by it): disarmed, so only one chat could ever resend.
    const replaced = observeSignInStarts(armed, [...own, authChanged(13, 'signing_in')], 'claude-code');
    expect(replaced.armed).toBe(false);
    expect(observeAuth(observeAuth(replaced, 'signing_in').tracker, 'signed_in').resend).toBe(false);
    // Not armed: nothing to do.
    expect(observeSignInStarts(initialTracker, [authChanged(1, 'signing_in'), authChanged(2, 'signing_in')], 'claude-code')).toBe(initialTracker);
  });

  it('a fresh notice (a new error, or the chat opened again) starts unarmed', () => {
    expect(initialTracker).toEqual({ last: undefined, armed: false, signedIn: false });
    expect(run(['signing_in', 'signed_in']).resends).toBe(0);
  });
});
