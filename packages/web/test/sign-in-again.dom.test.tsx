// @vitest-environment happy-dom
/**
 * The Sign in again notice's React wiring (story 9.6; 9.4 review F5), in a
 * DOM: the auth effect (a sign-in this notice started resends the chat's
 * last message once it finishes), the event effect (a second sign-in started
 * elsewhere disarms it) and the start-request observer passed to `useSignIn`
 * (a start that failed or began no sign-in of its own disarms it). The
 * agents query, the event stream and the sign-in hook are replaced; the
 * rules themselves have unit tests in `sign-in-again.test.tsx`.
 */
import { API_ROUTES, apiPath, type AgentAuthState, type AgentSetupStatus, type CoreEvent } from '@ogden-agents/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignIn } from '../src/agents/agent-setup-api';
import { TooltipProvider } from '../src/ui/tooltip';

/** What the replaced hooks answer; each test sets it, then re-renders. */
const state = vi.hoisted(() => ({
  auth: 'needs_sign_in' as AgentAuthState,
  events: [] as unknown[],
  starts: 0,
  /** The `auth` the notice passed to `useSignIn`: its start-request observer. */
  observer: undefined as { fetch(path: string, init?: RequestInit): Promise<Response> } | undefined,
  /** What `tabAuth.fetch` answers for the observed request. */
  respond: (() => Promise.resolve(new Response('{}'))) as () => Promise<Response>,
}));

vi.mock('@/agents/agent-setup-api', () => ({
  useAgents: () => ({
    data: [
      {
        agentId: 'claude-code',
        displayName: 'Claude Code',
        install: 'installed',
        version: '2.1.0',
        auth: state.auth,
        signInTab: 'page',
      } satisfies AgentSetupStatus as AgentSetupStatus,
    ],
  }),
  useSignIn: (_agentId: string, auth: typeof state.observer): SignIn => {
    state.observer = auth;
    return { start: () => void state.starts++, cancel: () => {}, sendCode: async () => true, link: undefined, code: undefined, busy: false, error: undefined };
  },
}));
vi.mock('@/agents/signing-in', () => ({ SigningIn: () => <div data-testid="signing-in" /> }));
vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: state.events }) }));
vi.mock('@/auth/tab-token', () => ({ tabAuth: { fetch: () => state.respond() } }));

const { SignInAgain, SIGNED_IN_TRY_AGAIN } = await import('../src/chat/sign-in-again');

const START_PATH = apiPath(API_ROUTES.agentSignIn, { agentId: 'claude-code' });

const authEvent = (seq: number, authState: AgentAuthState): CoreEvent =>
  ({ seq, type: 'agent.auth_changed', payload: { agentId: 'claude-code', state: authState } }) as unknown as CoreEvent;

/** Renders the notice; `set` changes what the hooks answer and re-renders, as a query or socket update would. */
function mount() {
  const onTryAgain = vi.fn();
  const node = () => (
    <TooltipProvider>
      <SignInAgain agentId="claude-code" agentName="Claude Code" reason={undefined} canTryAgain onTryAgain={onTryAgain} />
    </TooltipProvider>
  );
  const view = render(node());
  const set = (change: { auth?: AgentAuthState; events?: CoreEvent[] }) => {
    if (change.auth !== undefined) state.auth = change.auth;
    if (change.events !== undefined) state.events = change.events;
    view.rerender(node());
  };
  const notice = () => screen.getByTestId('sign-in-again-notice');
  return { onTryAgain, set, notice };
}

beforeEach(() => {
  state.auth = 'needs_sign_in';
  state.events = [authEvent(1, 'needs_sign_in')];
  state.starts = 0;
  state.observer = undefined;
  state.respond = () => Promise.resolve(new Response('{}'));
});
afterEach(cleanup);

describe('SignInAgain (DOM)', () => {
  it("the auth effect: this notice's own sign-in resends once when it finishes, and says so", () => {
    const { onTryAgain, set, notice } = mount();
    expect(notice().dataset.signIn).toBe('needs_sign_in');
    fireEvent.click(screen.getByTestId('sign-in-again'));
    expect(state.starts).toBe(1);
    // The event arrives first; the agents query follows it.
    set({ events: [authEvent(1, 'needs_sign_in'), authEvent(2, 'signing_in')] });
    set({ auth: 'signing_in' });
    expect(notice().dataset.signIn).toBe('signing_in');
    expect(onTryAgain).not.toHaveBeenCalled();
    set({ auth: 'signed_in' });
    expect(onTryAgain).toHaveBeenCalledTimes(1);
    expect(notice().dataset.signIn).toBe('signed_in');
    expect(notice()).toHaveProperty('textContent', expect.stringContaining(SIGNED_IN_TRY_AGAIN));
    // Re-renders with the same state resend nothing more.
    set({ auth: 'signed_in' });
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it('the auth effect: a sign-in finished without its Sign in says so, but resends nothing', () => {
    const { onTryAgain, set, notice } = mount();
    set({ auth: 'signing_in' });
    set({ auth: 'signed_in' });
    expect(notice().dataset.signIn).toBe('signed_in');
    expect(onTryAgain).not.toHaveBeenCalled();
  });

  it('the event effect: a second sign-in started elsewhere after the click disarms it', () => {
    const { onTryAgain, set } = mount();
    fireEvent.click(screen.getByTestId('sign-in-again'));
    set({ events: [authEvent(1, 'needs_sign_in'), authEvent(2, 'signing_in')] });
    set({ events: [authEvent(1, 'needs_sign_in'), authEvent(2, 'signing_in'), authEvent(3, 'signing_in')] });
    set({ auth: 'signing_in' });
    set({ auth: 'signed_in' });
    expect(onTryAgain).not.toHaveBeenCalled();
  });

  // A 9.4 bug this test found (fixed in 9.6): `observeAuth` dropped `armedAfter` once the agents query said `signing_in`.
  it('the event effect: a second sign-in seen after the agents query says signing_in still disarms it', () => {
    const { onTryAgain, set } = mount();
    fireEvent.click(screen.getByTestId('sign-in-again'));
    set({ events: [authEvent(1, 'needs_sign_in'), authEvent(2, 'signing_in')] });
    set({ auth: 'signing_in' });
    set({ events: [authEvent(1, 'needs_sign_in'), authEvent(2, 'signing_in'), authEvent(3, 'signing_in')] });
    set({ auth: 'signed_in' });
    expect(onTryAgain).not.toHaveBeenCalled();
  });

  it('the start observer: a start request that failed disarms it', async () => {
    const { onTryAgain, set } = mount();
    fireEvent.click(screen.getByTestId('sign-in-again'));
    state.respond = () => Promise.resolve(new Response('{}', { status: 409 }));
    await act(() => state.observer!.fetch(START_PATH, { method: 'POST' }));
    set({ auth: 'signing_in' });
    set({ auth: 'signed_in' });
    expect(onTryAgain).not.toHaveBeenCalled();
  });

  it('the start observer: a start that began no sign-in of its own disarms it; one that did keeps it armed', async () => {
    const superseded = mount();
    fireEvent.click(screen.getByTestId('sign-in-again'));
    state.respond = () => Promise.resolve(Response.json({ state: 'needs_sign_in' }));
    await act(async () => {
      await state.observer!.fetch(START_PATH, { method: 'POST' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    superseded.set({ auth: 'signing_in' });
    superseded.set({ auth: 'signed_in' });
    expect(superseded.onTryAgain).not.toHaveBeenCalled();
    cleanup();

    state.auth = 'needs_sign_in';
    const started = mount();
    fireEvent.click(screen.getByTestId('sign-in-again'));
    state.respond = () => Promise.resolve(Response.json({ state: 'signing_in' }));
    await act(async () => {
      await state.observer!.fetch(START_PATH, { method: 'POST' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Another request through the same observer is not the start: it changes nothing.
    state.respond = () => Promise.reject(new Error('offline'));
    await act(() => expect(state.observer!.fetch('/api/v1/agents', {})).rejects.toThrow('offline'));
    started.set({ auth: 'signing_in' });
    started.set({ auth: 'signed_in' });
    expect(started.onTryAgain).toHaveBeenCalledTimes(1);
  });
});
