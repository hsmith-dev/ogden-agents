/**
 * What a failed call to an OpenAI-compatible endpoint says, in plain words
 * (epic 14): the host only (never the path, query, credentials or key), and
 * what to do. Names no server product: the endpoint card (story 14.4) adds
 * the product's own advice where it knows the preset.
 */
import type { LocalFailure } from '@ogden-agents/core';
import type { EndpointFailureKind } from './http.js';

/** `baseUrl`'s host and port (`localhost:1234`), or "the server" when it can't be read. Never a path, query or credentials. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || 'the server';
  } catch {
    return 'the server';
  }
}

/** Why the endpoint at `baseUrl` can't be used, in words for the user. */
export function endpointFailureWords(kind: EndpointFailureKind, baseUrl: string, status?: number): string {
  const host = hostOf(baseUrl);
  switch (kind) {
    case 'unreachable':
      return `The server at ${host} isn't answering. Start it, then send your message again.`;
    case 'timeout':
      return `The server at ${host} took too long to answer. Check that it is running, then try again.`;
    case 'key_refused':
      return `The server at ${host} didn't accept the key for it. Check the key in Settings, Agents.`;
    case 'not_openai':
      return `The server at ${host} didn't answer the way an OpenAI compatible server does. Check its address in Settings, Agents.`;
    case 'redirected':
      return `The server at ${host} sent us somewhere else, which Ogden Agents never follows. Check its address in Settings, Agents (it may need https).`;
    case 'too_large':
      return `The server at ${host} sent back more than Ogden Agents expected.`;
    case 'http':
      return `The server at ${host} answered with an error${status === undefined ? '' : ` (${status})`}. Check it is ready, then try again.`;
  }
}

/** A failure as the port reports it: its kind, its status, and the words for it. */
export function failureOf(kind: EndpointFailureKind, baseUrl: string, status?: number): LocalFailure {
  return { ok: false, kind, ...(status === undefined ? {} : { status }), reason: endpointFailureWords(kind, baseUrl, status) };
}
