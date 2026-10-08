import { API_ROUTES, apiPath, RemoteHostKeyCheckResponse, RemoteMachineResponse, RemoteMachinesResponse, type RemoteMachineId } from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { call, callNoContent, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useEventStream } from '@/events/event-stream';

/**
 * The remote-machine REST calls (CAP-24, epic 18 story 18.3; AD-26), sent
 * with this tab's token. Only Ogden Agents' server ever connects to a
 * machine: the page asks it to check or confirm a host key and never opens
 * an SSH connection itself. A machine's private key is never sent to, or
 * read by, this page at all; only its public key line is, for the user to
 * paste into the remote machine's `authorized_keys`.
 */

export const REMOTE_MACHINES_QUERY_KEY = ['remote-machines'] as const;

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchRemoteMachines(auth: Auth = tabAuth) {
  return RemoteMachinesResponse.parse(await call(auth, API_ROUTES.remoteMachines, {}, "Ogden Agents couldn't read your machines")).machines;
}

export async function addRemoteMachine(body: { host: string; port?: number; username: string; label: string }, auth: Auth = tabAuth) {
  return RemoteMachineResponse.parse(await call(auth, API_ROUTES.remoteMachines, postJson(body), "Ogden Agents couldn't add that machine")).machine;
}

export async function renameRemoteMachine(id: RemoteMachineId, label: string, auth: Auth = tabAuth) {
  return RemoteMachineResponse.parse(await call(auth, apiPath(API_ROUTES.remoteMachine, { machineId: id }), json('PATCH', { label }), "Ogden Agents couldn't rename that machine")).machine;
}

export async function removeRemoteMachine(id: RemoteMachineId, auth: Auth = tabAuth) {
  await callNoContent(auth, apiPath(API_ROUTES.remoteMachine, { machineId: id }), { method: 'DELETE' }, "Ogden Agents couldn't remove that machine");
}

/** Reads the machine's live host-key fingerprint, for the page to show before the user confirms it. Never pins anything. */
export async function checkRemoteMachineHostKey(id: RemoteMachineId, auth: Auth = tabAuth) {
  return RemoteHostKeyCheckResponse.parse(await call(auth, apiPath(API_ROUTES.remoteMachineHostKeyCheck, { machineId: id }), { method: 'POST' }, "Ogden Agents couldn't reach that machine"));
}

/** Confirms the fingerprint shown to the user. First confirm generates and stores a fresh keypair; a changed fingerprint is refused outright. */
export async function confirmRemoteMachineHostKey(id: RemoteMachineId, fingerprint: string, auth: Auth = tabAuth) {
  return RemoteMachineResponse.parse(await call(auth, apiPath(API_ROUTES.remoteMachineHostKeyConfirm, { machineId: id }), postJson({ fingerprint, confirm: true }), "Ogden Agents couldn't confirm that host key")).machine;
}

/** The seq of the newest remote-machine event received, or 0. */
function lastRemoteMachineSeq(events: readonly { seq: number; type: string }[]): number {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type === 'settings.remote_machines_changed') return events[i]!.seq;
  return 0;
}

/** The machines, read over REST and read again whenever another tab changes them. */
export function useRemoteMachines() {
  const queryClient = useQueryClient();
  const { events } = useEventStream();
  const seq = lastRemoteMachineSeq(events);
  useEffect(() => {
    if (seq > 0) void queryClient.invalidateQueries({ queryKey: REMOTE_MACHINES_QUERY_KEY });
  }, [seq, queryClient]);
  return useQuery({ queryKey: REMOTE_MACHINES_QUERY_KEY, queryFn: () => fetchRemoteMachines(), retry: 1 });
}
