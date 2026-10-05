/**
 * Signing in with the user's own account (story 9.1; moved out of
 * `agent-setup.ts` by story 6.9 to keep it under 600 lines): one sign-in per
 * agent, a new one cancelling the one before; its outcome becomes an
 * `agent.auth_changed` event through the use-case's `announce`. The URL and
 * any code go back only to the caller.
 */
import { SignInCodeRequest, SignInResponse, type AgentAuthMethodKind, type AgentAuthState } from '@ogden-agents/shared';
import type { AgentSetupPort, AgentSignIn, AgentSubscriptionState } from './agent-setup-port.js';
import { AgentSetupError, SignInNotPendingError, newFlight, type AgentSetup, type Flight } from './agent-setup-types.js';
import { ValidationError } from './errors.js';

/** What the sign-ins share with the rest of the agent setup use-case. */
export interface SignInContext {
  /** The sign-in running for each agent. */
  flights: Map<string, Flight>;
  /** The last failed sign-in's plain reason, per agent. */
  lastFailure: Map<string, string>;
  portFor(agentId: string): AgentSetupPort;
  /** Whether the server is stopping. */
  disposed(): boolean;
  report(agentId: string, step: string, error: unknown): void;
  announce(agentId: string, state: AgentAuthState, extra?: { method?: AgentAuthMethodKind; reason?: string }): void;
  setSubscription(agentId: string, state: AgentSubscriptionState): void;
  keyFor(port: AgentSetupPort): string | undefined;
  readSubscription(port: AgentSetupPort): Promise<void>;
}

const failed = (port: AgentSetupPort) => `${port.displayName} couldn't finish signing in. Try again.`;

/** Stops a sign-in: marks it stopped and cancels its handle, best effort. */
export const stopSignIn = async (flight: Flight) => {
  flight.stopped = true;
  flight.settle();
  try {
    await flight.handle?.cancel();
  } catch {
    // Cancelling is best effort; the adapter's own timeout still stops it.
  }
};

/** Signing in, a code typed for it, and cancelling it: the use-case's sign-in methods. */
export function createSignIns(ctx: SignInContext): Pick<AgentSetup, 'signIn' | 'submitCode' | 'cancelSignIn'> {
  const { flights, lastFailure, portFor, report, announce, setSubscription, keyFor, readSubscription } = ctx;

  const follow = (agentId: string, port: AgentSetupPort, flight: Flight, handle: AgentSignIn) => {
    handle.done.then(
      (outcome) => {
        if (flights.get(agentId) !== flight) return;
        flights.delete(agentId);
        if (outcome === 'signed_in') {
          lastFailure.delete(agentId);
          // The subscription now comes first: a saved key stops being used.
          setSubscription(agentId, 'signed_in');
          announce(agentId, 'signed_in', { method: 'subscription' });
        } else if (outcome === 'failed') {
          lastFailure.set(agentId, failed(port));
          announce(agentId, 'failed', { reason: failed(port) });
        } else {
          announce(agentId, 'needs_sign_in');
        }
        if (outcome !== 'signed_in' && keyFor(port) !== undefined) void readSubscription(port);
      },
      (error: unknown) => {
        report(agentId, 'sign_in', error);
        if (flights.get(agentId) !== flight) return;
        flights.delete(agentId);
        lastFailure.set(agentId, failed(port));
        announce(agentId, 'failed', { reason: failed(port) });
      },
    );
  };

  return {
    async signIn(agentId) {
      const port = portFor(agentId);
      if (ctx.disposed()) throw new AgentSetupError(failed(port));
      const previous = flights.get(agentId);
      const flight = newFlight();
      // Claimed before any await, so two clicks run one sign-in.
      flights.set(agentId, flight);
      lastFailure.delete(agentId);
      if (previous !== undefined) await stopSignIn(previous);
      announce(agentId, 'signing_in');

      let handle: AgentSignIn;
      try {
        handle = await port.signIn();
      } catch (error) {
        report(agentId, 'start', error);
        flight.settle();
        if (flights.get(agentId) !== flight) return { state: 'needs_sign_in', url: null };
        flights.delete(agentId);
        const reason = error instanceof AgentSetupError ? error.message : failed(port);
        lastFailure.set(agentId, reason);
        announce(agentId, 'failed', { reason });
        return { state: 'failed', url: null };
      }
      if (flight.stopped || flights.get(agentId) !== flight) {
        // Cancelled, superseded or disposed while it started.
        flight.settle();
        await handle.cancel().catch(() => {});
        return { state: 'needs_sign_in', url: null };
      }
      flight.handle = handle;
      flight.settle();
      follow(agentId, port, flight, handle);
      // A code the user types on the sign-in page (a device code), when the agent gives one: like the URL, only in this answer.
      // A code the answer's schema would refuse is dropped: the sign-in still goes on, with its URL.
      const code = handle.userCode !== undefined && SignInResponse.shape.code.safeParse(handle.userCode).success ? handle.userCode : undefined;
      return { state: 'signing_in', url: handle.url, ...(code === undefined ? {} : { code }) };
    },

    async submitCode(agentId, code) {
      portFor(agentId);
      const parsed = SignInCodeRequest.safeParse({ code });
      // The code is never echoed, not even in the error.
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'That is not a sign-in code.', []);
      const flight = flights.get(agentId);
      // The page offers the code box once the sign-in is announced, which is before the port's sign-in has started: wait for it.
      if (flight !== undefined && flight.handle === undefined && !flight.stopped) await flight.started;
      const handle = flight !== undefined && !flight.stopped && flights.get(agentId) === flight ? flight.handle : undefined;
      if (handle?.submitCode === undefined) throw new SignInNotPendingError(agentId);
      try {
        await handle.submitCode(parsed.data.code);
      } catch (error) {
        report(agentId, 'submit_code', error);
        throw new SignInNotPendingError(agentId);
      }
    },

    async cancelSignIn(agentId) {
      portFor(agentId);
      const flight = flights.get(agentId);
      if (flight === undefined) return;
      flights.delete(agentId);
      await stopSignIn(flight);
      announce(agentId, 'needs_sign_in');
    },
  };
}
