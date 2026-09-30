import { AgentsResponse, API_ROUTES, apiPath, SignInResponse, type AgentSetupStatus } from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { call, ChatApiError, postJson } from '@/chat/chat-api';
import { useEventStream } from '@/events/event-stream';

/**
 * The agent setup REST calls (story 9.1), sent with this tab's token, the
 * agents query every card shares, and {@link useSignIn}, the one sign-in
 * action Settings: Agents, Welcome (9.5) and Sign in again (9.4) reuse.
 *
 * The sign-in URL is a secret-like value (AD-15): it is kept only in this
 * tab's memory (component state) and never stored, logged or put in a URL
 * of ours; a pasted code is sent once and never kept.
 */

type Auth = Pick<TabAuth, 'fetch'>;

const UNREACHABLE = "Couldn't reach Ogden Agents. Check that it is still running, then try again.";

export const AGENTS_QUERY_KEY = ['agents'] as const;

/** `GET /api/v1/agents`. */
export async function fetchAgents(auth: Auth = tabAuth): Promise<AgentSetupStatus[]> {
  const json = await call(auth, API_ROUTES.agents, {}, "Ogden Agents couldn't check your agents");
  return AgentsResponse.parse(json).agents;
}

/** `POST /api/v1/agents/:agentId/sign-in`: starts signing in; the URL comes back only here. */
export async function startSignIn(agentId: string, auth: Auth = tabAuth): Promise<SignInResponse> {
  const json = await call(auth, apiPath(API_ROUTES.agentSignIn, { agentId }), { method: 'POST' }, "Ogden Agents couldn't start signing in");
  return SignInResponse.parse(json);
}

/** A request answered 204. */
async function callNoContent(auth: Auth, path: string, init: RequestInit, fallback: string): Promise<void> {
  let response: Response;
  try {
    response = await auth.fetch(path, init);
  } catch {
    throw new ChatApiError(UNREACHABLE, 0);
  }
  if (response.ok) return;
  let message = `${fallback} (error ${response.status}).`;
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === 'string') message = body.error.message;
  } catch {
    // Not JSON: keep the fallback.
  }
  throw new ChatApiError(message, response.status);
}

/** `DELETE /api/v1/agents/:agentId/sign-in`: stops a sign-in in progress. */
export const cancelSignIn = (agentId: string, auth: Auth = tabAuth) =>
  callNoContent(auth, apiPath(API_ROUTES.agentSignIn, { agentId }), { method: 'DELETE' }, "Ogden Agents couldn't cancel signing in");

/** `POST /api/v1/agents/:agentId/sign-in/code`: types the pasted code into the sign-in. */
export const sendSignInCode = (agentId: string, code: string, auth: Auth = tabAuth) =>
  callNoContent(auth, apiPath(API_ROUTES.agentSignInCode, { agentId }), postJson({ code }), "Ogden Agents couldn't send the code");

/** The seq of the newest `agent.*` event received, or 0. */
function lastAgentSeq(events: readonly { seq: number; type: string }[]): number {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type.startsWith('agent.')) return events[i]!.seq;
  return 0;
}

/** Every agent's setup, read over REST and refetched whenever an `agent.*` event arrives (such as `agent.auth_changed`). */
export function useAgents() {
  const queryClient = useQueryClient();
  const { events } = useEventStream();
  const seq = lastAgentSeq(events);
  useEffect(() => {
    if (seq > 0) void queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY });
  }, [seq, queryClient]);
  return useQuery<AgentSetupStatus[]>({ queryKey: AGENTS_QUERY_KEY, queryFn: () => fetchAgents(), retry: 1 });
}

export interface SignIn {
  /**
   * Starts signing in. Call it straight from the click: with `signInTab:
   * 'page'` it opens the new tab synchronously (so no popup blocker stops
   * it), cuts its `opener`, and sends it to the URL once the server answers.
   */
  start(signInTab: AgentSetupStatus['signInTab']): void;
  cancel(): void;
  /** Sends a code pasted from the sign-in page; resolves `true` once it was typed in. */
  sendCode(code: string): Promise<boolean>;
  /** The sign-in page, for a link, when this tab didn't open it (the agent opens its own, or the popup was blocked). */
  link: string | undefined;
  /** Whether a request is running (start, cancel or a code). */
  busy: boolean;
  /** Plain words for the last request that failed. */
  error: string | undefined;
}

/** The one sign-in action (9.1), shared by Settings: Agents, Welcome (9.5) and Sign in again (9.4). */
export function useSignIn(agentId: string, auth: Auth = tabAuth): SignIn {
  const queryClient = useQueryClient();
  const [link, setLink] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const refresh = useCallback(() => void queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY }), [queryClient]);
  const failure = (caught: unknown, fallback: string) => setError(caught instanceof Error ? caught.message : fallback);

  const start = (signInTab: AgentSetupStatus['signInTab']) => {
    // Opened now, inside the click, or a popup blocker refuses it.
    let tab: Window | null = null;
    if (signInTab === 'page') {
      tab = window.open('', '_blank');
      if (tab !== null) tab.opener = null;
    }
    setBusy(true);
    setError(undefined);
    setLink(undefined);
    startSignIn(agentId, auth).then(
      (reply) => {
        setBusy(false);
        if (reply.state === 'signing_in' && reply.url !== null) {
          if (tab !== null && !tab.closed) tab.location.href = reply.url;
          else setLink(reply.url);
        } else {
          tab?.close();
        }
        refresh();
      },
      (caught: unknown) => {
        tab?.close();
        setBusy(false);
        failure(caught, "Ogden Agents couldn't start signing in. Try again.");
        refresh();
      },
    );
  };

  const cancel = () => {
    setBusy(true);
    setError(undefined);
    cancelSignIn(agentId, auth).then(
      () => {
        setBusy(false);
        setLink(undefined);
        refresh();
      },
      (caught: unknown) => {
        setBusy(false);
        failure(caught, "Ogden Agents couldn't cancel signing in. Try again.");
      },
    );
  };

  const sendCode = async (code: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await sendSignInCode(agentId, code, auth);
      return true;
    } catch (caught) {
      failure(caught, "Ogden Agents couldn't send the code. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { start, cancel, sendCode, link, busy, error };
}
