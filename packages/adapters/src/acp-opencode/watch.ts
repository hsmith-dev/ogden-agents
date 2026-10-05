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
/** How many looks in a row must find it unreachable before the turn is ended. */
export const WATCH_MISSES = 2;
/** How long one look waits. */
export const WATCH_TIMEOUT_MS = 2_000;

export interface EndpointWatchOptions {
  intervalMs?: number | undefined;
  misses?: number | undefined;
  fetch?: typeof fetch | undefined;
}

/** Whether a look found the server not there (anything else, even a refused key, means it is running). */
const gone = (result: Awaited<ReturnType<typeof probeEndpoint>>) => !result.ok && (result.kind === 'unreachable' || result.kind === 'timeout' || result.kind === 'redirected');

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
        let stop!: (error: AgentError) => void;
        const stopped = new Promise<never>((_, reject) => (stop = reject));
        stopped.catch(() => undefined);
        let looking = false;
        const timer = setInterval(() => {
          if (looking) return;
          looking = true;
          void look()
            .then((result) => {
              misses = gone(result) ? misses + 1 : 0;
              if (misses >= (options.misses ?? WATCH_MISSES)) {
                // The harness would retry for a minute: end the turn now, and stop it.
                stop(new AgentError('agent_failed', FAILURE_WORDS.notRunning));
                void session.cancel().catch(() => undefined);
              }
            })
            .finally(() => {
              looking = false;
            });
        }, options.intervalMs ?? WATCH_INTERVAL_MS);
        try {
          return await Promise.race([session.prompt(text), stopped]);
        } finally {
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
