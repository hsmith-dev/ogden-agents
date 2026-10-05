/**
 * Ogden's own watch over a Local model chat (epic 14 story 14.6; E14-R4). A
 * model server that stops makes the harness retry for 63 to 66 seconds before
 * it says so (spike 14.1), and the chat would look stuck. So Ogden looks at
 * the endpoint itself:
 *
 * - before a message is sent, a stopped server is reported at once (the
 *   message is not sent to a harness that would hang);
 * - while a message is being answered, the endpoint is looked at every few
 *   seconds, and when it stops answering twice in a row the turn is ended with
 *   the "server stopped" words instead of waiting out the harness's retries.
 *
 * A server that answers but is slow (a model still loading) is never cut off:
 * only an endpoint that can't be reached counts. The key is only used for the
 * look itself and never kept.
 */
import { AgentError, type AgentPort, type AgentSession, type StartAgentSession } from '@ogden-agents/core';
import { probeEndpoint } from '../local-model-openai/probe.js';
import { ENDPOINT_KEY_ENV, ENDPOINT_URL_ENV } from './constants.js';
import { FAILURE_WORDS } from './failures.js';

/** How often the endpoint is looked at while a message is being answered. */
export const WATCH_INTERVAL_MS = 4_000;
/** How many looks in a row must find it unreachable (refused, not found) before the turn is ended. */
export const WATCH_MISSES = 2;
/** How many looks in a row may time out before the turn is ended: a server busy with a long prompt answers slowly, so this is much stricter. */
export const WATCH_SLOW_MISSES = 5;
/** How long a stopped turn is given to end by itself before its harness is closed. */
export const WATCH_SETTLE_MS = 3_000;
/** How long one look waits. */
export const WATCH_TIMEOUT_MS = 2_000;

export interface EndpointWatchOptions {
  intervalMs?: number | undefined;
  misses?: number | undefined;
  slowMisses?: number | undefined;
  settleMs?: number | undefined;
  fetch?: typeof fetch | undefined;
}

type Look = Awaited<ReturnType<typeof probeEndpoint>>;
/** Whether a look found the server refusing connections or not there: only that counts as stopped (a refused key, a redirect or a slow answer means something is running). */
const gone = (result: Look) => !result.ok && result.kind === 'unreachable';
/** Whether a look timed out: a busy server, or one that is gone in a way that never answers. */
const slow = (result: Look) => !result.ok && result.kind === 'timeout';

function watched(session: AgentSession, env: Readonly<Record<string, string>>, options: EndpointWatchOptions): AgentSession {
  const baseUrl = env[ENDPOINT_URL_ENV];
  if (baseUrl === undefined || baseUrl === '') return session;
  const key = env[ENDPOINT_KEY_ENV];
  const look = () => probeEndpoint({ baseUrl, key, fetch: options.fetch, timeoutMs: WATCH_TIMEOUT_MS });
  return Object.create(session, {
    prompt: {
      value: async (text: string) => {
        if (gone(await look())) throw new AgentError('agent_failed', FAILURE_WORDS.notRunning);
        let misses = 0;
        let slowMisses = 0;
        let over = false;
        let stop!: (error: AgentError) => void;
        const stopped = new Promise<never>((_, reject) => (stop = reject));
        stopped.catch(() => undefined);
        let looking = false;
        const timer = setInterval(() => {
          if (looking || over) return;
          looking = true;
          void look()
            .then((result) => {
              // A look that finishes after the turn is over changes nothing: it must never cancel a later turn.
              if (over) return;
              misses = gone(result) ? misses + 1 : 0;
              slowMisses = slow(result) ? slowMisses + 1 : 0;
              if (misses >= (options.misses ?? WATCH_MISSES) || slowMisses >= (options.slowMisses ?? WATCH_SLOW_MISSES)) {
                // The harness would retry for a minute: end the turn now, and stop it.
                stop(new AgentError('agent_failed', FAILURE_WORDS.notRunning));
              }
            })
            .finally(() => {
              looking = false;
            });
        }, options.intervalMs ?? WATCH_INTERVAL_MS);
        const inner = session.prompt(text);
        inner.catch(() => undefined);
        try {
          return await Promise.race([inner, stopped]);
        } catch (error) {
          if (!over && error instanceof AgentError && error.message === FAILURE_WORDS.notRunning) {
            // Stop the harness's turn and wait (a moment) for it to end, so its late events never land on a message sent next.
            void session.cancel().catch(() => undefined);
            const ended = await Promise.race([inner.then(() => true, () => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), options.settleMs ?? WATCH_SETTLE_MS))]);
            if (!ended) await session.close().catch(() => undefined);
          }
          throw error;
        } finally {
          over = true;
          clearInterval(timer);
        }
      },
    },
  }) as AgentSession;
}

/** `agent` with the watch over each session it starts or reopens. */
export function withEndpointWatch(agent: AgentPort, options: EndpointWatchOptions = {}): AgentPort {
  const forInput = <T extends StartAgentSession>(input: T) => input.env;
  return {
    get displayName() {
      return agent.displayName;
    },
    get permissionModes() {
      return agent.permissionModes;
    },
    ...(agent.modeFixedAtStart === true ? { modeFixedAtStart: true } : {}),
    async startSession(input) {
      return watched(await agent.startSession(input), forInput(input), options);
    },
    async reopenSession(input) {
      const reopened = await agent.reopenSession(input);
      return { ...reopened, session: watched(reopened.session, forInput(input), options) };
    },
    listAuthMethods: (input) => agent.listAuthMethods(input),
    skillInvocation: (skill, idea) => agent.skillInvocation(skill, idea),
    ...(agent.terminalResume === undefined ? {} : { terminalResume: agent.terminalResume }),
  };
}
