/**
 * Asking an OpenAI-compatible endpoint whether it is there and what it
 * serves (`GET {base}/models`), for the Local model: Ogden checks the
 * endpoint itself before a chat starts, because a dead endpoint makes the
 * harness retry for 63 to 66 seconds (spike 14.1) before it says so.
 */
import { EndpointError, callEndpoint, type EndpointCall, type EndpointFailureKind } from './http.js';

export type EndpointProbe = { ok: true; models: string[] } | { ok: false; kind: EndpointFailureKind; status?: number | undefined };

/** The ids a `/models` answer lists, or `undefined` when it isn't a model list. */
export function modelIdsOf(answer: unknown): string[] | undefined {
  const data = (answer as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return undefined;
  const ids = data.flatMap((entry) => {
    const id = (entry as { id?: unknown } | null)?.id;
    return typeof id === 'string' && id !== '' && id.length <= 300 ? [id] : [];
  });
  return [...new Set(ids)];
}

/** Probes the endpoint: its model ids, or why it can't be used. Never throws. */
export async function probeEndpoint(call: EndpointCall): Promise<EndpointProbe> {
  try {
    const ids = modelIdsOf(await callEndpoint(call, 'models'));
    if (ids === undefined) return { ok: false, kind: 'not_openai' };
    return { ok: true, models: ids };
  } catch (error) {
    if (error instanceof EndpointError) return { ok: false, kind: error.kind, ...(error.details.status === undefined ? {} : { status: error.details.status }) };
    return { ok: false, kind: 'unreachable' };
  }
}
