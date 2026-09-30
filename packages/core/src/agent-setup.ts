/**
 * The agent setup use-case (story 9.1): every supported agent's install and
 * sign-in state, and signing in with the user's own account through each
 * agent's {@link AgentSetupPort}. Core names no agent (AD-1): the ports do.
 *
 * Only core appends events (AD-11): each sign-in state change becomes an
 * `agent.auth_changed` event, which never carries the sign-in URL, a pasted
 * code or a key (AD-15, AD-16). The URL goes back only to the caller of
 * {@link AgentSetup.signIn}, for its `no-store` response.
 *
 * One sign-in runs per agent: starting a new one cancels the one before.
 */
import {
  AGENTS_STREAM,
  SignInCodeRequest,
  type AgentAuthMethodKind,
  type AgentAuthState,
  type AgentSetupStatus,
  type SignInResponse,
} from '@ogden-agents/shared';
import type { AgentSetupPort, AgentSignIn } from './agent-setup-port.js';
import { CoreError, NotFoundError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';

/**
 * An agent setup step that failed, with plain words for the user in
 * `message` (never a secret). Adapters throw it when a sign-in can't start.
 */
export class AgentSetupError extends CoreError {
  override readonly name = 'AgentSetupError';
  constructor(message: string, options: { cause?: unknown } = {}) {
    super('agent_setup_failed', message);
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** A sign-in code was sent, but no sign-in that takes one is in progress for the agent. */
export class SignInNotPendingError extends CoreError {
  override readonly name = 'SignInNotPendingError';
  constructor(agentId: string) {
    super('sign_in_not_pending', `no sign-in is in progress for ${agentId}`);
  }
}

export interface AgentSetup {
  /** Every supported agent's setup, with a sign-in in progress or the last failure laid over what its port reports. */
  list(): Promise<AgentSetupStatus[]>;
  /**
   * Starts signing in to `agentId`, cancelling a sign-in already running for
   * it. Resolves with `signing_in` and the URL to open (a secret: only for a
   * `no-store` response), or `failed` when it couldn't start (the reason is
   * in the event and in {@link list}).
   */
  signIn(agentId: string): Promise<SignInResponse>;
  /** Types a code the user pasted into the running sign-in. Never logged, evented or stored. */
  submitCode(agentId: string, code: string): Promise<void>;
  /** Stops the running sign-in, if there is one. Idempotent. */
  cancelSignIn(agentId: string): Promise<void>;
  /** Stops every sign-in (server stop). Appends nothing. */
  dispose(): Promise<void>;
}

export interface AgentSetupOptions {
  /** Called with every failure, for the log. Never carries the URL, a code or the agent's output. */
  onFailure?: (agentId: string, step: string, error: unknown) => void;
}

interface Flight {
  /** Set once the port's `signIn` resolved. */
  handle: AgentSignIn | undefined;
  /** Cancelled (or superseded, or disposed) before or after the handle arrived. */
  stopped: boolean;
}

export function createAgentSetup(events: EventLog, ports: readonly AgentSetupPort[], options: AgentSetupOptions = {}): AgentSetup {
  const byId = new Map(ports.map((port) => [port.agentId, port]));
  const flights = new Map<string, Flight>();
  /** The last failed sign-in's plain reason, shown until the next sign-in starts or the agent reports signed in. */
  const lastFailure = new Map<string, string>();
  let disposed = false;

  const portFor = (agentId: string): AgentSetupPort => {
    const port = byId.get(agentId);
    if (port === undefined) throw new NotFoundError('agent', agentId);
    return port;
  };

  const failed = (port: AgentSetupPort) => `${port.displayName} couldn't finish signing in. Try again.`;

  const report = (agentId: string, step: string, error: unknown) => {
    try {
      options.onFailure?.(agentId, step, error);
    } catch {
      // Logging must never change the outcome.
    }
  };

  const announce = (agentId: string, state: AgentAuthState, extra: { method?: AgentAuthMethodKind; reason?: string } = {}) => {
    if (disposed) return;
    try {
      events.append({ type: 'agent.auth_changed', workspaceId: null, streamId: AGENTS_STREAM, payload: { agentId, state, ...extra } });
    } catch (error) {
      // Only a closed log (the server is stopping) lands here.
      report(agentId, 'append', error);
    }
  };

  const stop = async (flight: Flight) => {
    flight.stopped = true;
    try {
      await flight.handle?.cancel();
    } catch {
      // Cancelling is best effort; the adapter's own timeout still stops it.
    }
  };

  const follow = (agentId: string, port: AgentSetupPort, flight: Flight, handle: AgentSignIn) => {
    handle.done.then(
      (outcome) => {
        if (flights.get(agentId) !== flight) return;
        flights.delete(agentId);
        if (outcome === 'signed_in') {
          lastFailure.delete(agentId);
          announce(agentId, 'signed_in', { method: 'subscription' });
        } else if (outcome === 'failed') {
          lastFailure.set(agentId, failed(port));
          announce(agentId, 'failed', { reason: failed(port) });
        } else {
          announce(agentId, 'needs_sign_in');
        }
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
    async list() {
      return Promise.all(
        ports.map(async (port): Promise<AgentSetupStatus> => {
          let status: AgentSetupStatus;
          try {
            status = await port.status();
          } catch (error) {
            report(port.agentId, 'status', error);
            status = {
              agentId: port.agentId,
              displayName: port.displayName,
              install: 'not_installed',
              version: null,
              auth: 'needs_sign_in',
              reason: `Ogden Agents couldn't check ${port.displayName}. Try again.`,
            };
          }
          if (flights.has(port.agentId)) {
            const { reason: _reason, method: _method, ...rest } = status;
            return { ...rest, auth: 'signing_in' };
          }
          const failure = lastFailure.get(port.agentId);
          if (status.auth === 'signed_in') lastFailure.delete(port.agentId);
          else if (failure !== undefined) return { ...status, auth: 'failed', reason: failure };
          return status;
        }),
      );
    },

    async signIn(agentId) {
      const port = portFor(agentId);
      if (disposed) throw new AgentSetupError(failed(port));
      const previous = flights.get(agentId);
      const flight: Flight = { handle: undefined, stopped: false };
      // Claimed before any await, so two clicks run one sign-in.
      flights.set(agentId, flight);
      lastFailure.delete(agentId);
      if (previous !== undefined) await stop(previous);
      announce(agentId, 'signing_in');

      let handle: AgentSignIn;
      try {
        handle = await port.signIn();
      } catch (error) {
        report(agentId, 'start', error);
        if (flights.get(agentId) !== flight) return { state: 'needs_sign_in', url: null };
        flights.delete(agentId);
        const reason = error instanceof AgentSetupError ? error.message : failed(port);
        lastFailure.set(agentId, reason);
        announce(agentId, 'failed', { reason });
        return { state: 'failed', url: null };
      }
      if (flight.stopped || flights.get(agentId) !== flight) {
        // Cancelled, superseded or disposed while it started.
        await handle.cancel().catch(() => {});
        return { state: 'needs_sign_in', url: null };
      }
      flight.handle = handle;
      follow(agentId, port, flight, handle);
      return { state: 'signing_in', url: handle.url };
    },

    async submitCode(agentId, code) {
      portFor(agentId);
      const parsed = SignInCodeRequest.safeParse({ code });
      // The code is never echoed, not even in the error.
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'That is not a sign-in code.', []);
      const handle = flights.get(agentId)?.handle;
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
      await stop(flight);
      announce(agentId, 'needs_sign_in');
    },

    async dispose() {
      disposed = true;
      const running = [...flights.values()];
      flights.clear();
      await Promise.all(running.map(stop));
    },
  };
}
