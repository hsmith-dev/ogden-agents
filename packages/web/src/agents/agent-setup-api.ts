import { AgentSetupStatus, AgentsResponse, API_ROUTES, apiPath, SignInResponse } from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { call, callNoContent, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useEventStream } from '@/events/event-stream';

/**
 * The agent setup REST calls (story 9.1), sent with this tab's token, the
 * agents query every card shares, and {@link useSignIn}, the one sign-in
 * action Settings: Agents, Welcome (9.5) and Sign in again (9.4) reuse.
 *
 * The sign-in URL is a secret-like value (AD-15): it is kept only in this
 * tab's memory (component state) and never stored, logged or put in a URL
 * of ours; a pasted code is sent once and never kept. So is an API key
 * (9.2): sent once in a `PUT`, never kept, and never read back (the server
 * returns only its last 4 characters). Install (9.3) asks the server to
 * install the agent; its progress and outcome arrive as `agent.install_*`
 * events, which refetch the agents query.
 */

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

/** `POST /api/v1/agents/:agentId/install`: starts installing (202), or answers with the install already running. */
export async function installAgent(agentId: string, auth: Auth = tabAuth): Promise<AgentSetupStatus> {
  const json = await call(auth, apiPath(API_ROUTES.agentInstall, { agentId }), { method: 'POST' }, "Ogden Agents couldn't start the install");
  return AgentSetupStatus.parse(json);
}

/** `DELETE /api/v1/agents/:agentId/sign-in`: stops a sign-in in progress. */
export const cancelSignIn = (agentId: string, auth: Auth = tabAuth) =>
  callNoContent(auth, apiPath(API_ROUTES.agentSignIn, { agentId }), { method: 'DELETE' }, "Ogden Agents couldn't cancel signing in");

/** `POST /api/v1/agents/:agentId/sign-in/code`: types the pasted code into the sign-in. */
export const sendSignInCode = (agentId: string, code: string, auth: Auth = tabAuth) =>
  callNoContent(auth, apiPath(API_ROUTES.agentSignInCode, { agentId }), postJson({ code }), "Ogden Agents couldn't send the code");

/** `PUT /api/v1/agents/:agentId/api-key`: checks the key and keeps it in the keychain. */
export const saveApiKey = (agentId: string, apiKey: string, auth: Auth = tabAuth) =>
  callNoContent(
    auth,
    apiPath(API_ROUTES.agentApiKey, { agentId }),
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey }) },
    "Ogden Agents couldn't save the API key",
  );

/** `DELETE /api/v1/agents/:agentId/api-key`: removes the key from the keychain. */
export const removeApiKey = (agentId: string, auth: Auth = tabAuth) =>
  callNoContent(auth, apiPath(API_ROUTES.agentApiKey, { agentId }), { method: 'DELETE' }, "Ogden Agents couldn't remove the API key");

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

export interface ApiKeyActions {
  /** Sends the key once; resolves `true` once it was saved. The caller clears its field either way. */
  save(apiKey: string): Promise<boolean>;
  remove(): void;
  /** Whether a request is running. */
  busy: boolean;
  /** Plain words for the last request that failed (never the key). */
  error: string | undefined;
}

/** Saving and removing an agent's API key (9.2), for Settings: Agents and Welcome (9.5). */
export function useApiKey(agentId: string, auth: Auth = tabAuth): ApiKeyActions {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY });

  const save = async (apiKey: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await saveApiKey(agentId, apiKey, auth);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ogden Agents couldn't save the API key. Try again.");
      return false;
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const remove = () => {
    setBusy(true);
    setError(undefined);
    removeApiKey(agentId, auth).then(
      () => {
        setBusy(false);
        refresh();
      },
      (caught: unknown) => {
        setBusy(false);
        setError(caught instanceof Error ? caught.message : "Ogden Agents couldn't remove the API key. Try again.");
        refresh();
      },
    );
  };

  return { save, remove, busy, error };
}

export interface InstallAction {
  /** Asks the server to install the agent; the card then follows the agents query. */
  start(): void;
  /** Whether the request is running. */
  busy: boolean;
  /** Plain words for a request that failed (not an install that failed: that is the agent's `reason`). */
  error: string | undefined;
}

/** Install (9.3), for Settings: Agents and Welcome (9.5). */
export function useInstall(agentId: string, auth: Auth = tabAuth): InstallAction {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const start = () => {
    setBusy(true);
    setError(undefined);
    installAgent(agentId, auth).then(
      (agent) => {
        setBusy(false);
        queryClient.setQueryData<AgentSetupStatus[]>(AGENTS_QUERY_KEY, (agents) => agents?.map((known) => (known.agentId === agent.agentId ? agent : known)));
      },
      (caught: unknown) => {
        setBusy(false);
        setError(caught instanceof Error ? caught.message : "Ogden Agents couldn't start the install. Try again.");
        void queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY });
      },
    );
  };

  return { start, busy, error };
}
