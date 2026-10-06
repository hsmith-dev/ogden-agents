/**
 * `local-model-memory` (epic 14 story 14.3): a deterministic in-memory
 * `LocalModelPort`, the stub core's tests and contract tests use in place of
 * a real endpoint. A target is known by its base URL; any other is
 * `unreachable`. It calls nothing and holds no key.
 */
import type { LocalFailure, LocalFailureKind, LocalModelInfo, LocalModelPort, LocalModelTarget, StructuredRequest, StructuredResult } from '@ogden-agents/core';

export interface MemoryEndpoint {
  models: readonly LocalModelInfo[];
  /** The key it asks for; a call with another (or none) is `key_refused`. */
  requireKey?: string | undefined;
  /** The whole endpoint fails with this kind. */
  failWith?: LocalFailureKind | undefined;
  /** What `structuredComplete` answers for a model, by model id (default: `{}`). */
  structured?: Readonly<Record<string, unknown>> | undefined;
}

const WORDS: Readonly<Record<LocalFailureKind, string>> = {
  unreachable: "The server isn't answering.",
  timeout: 'The server took too long to answer.',
  key_refused: "The server didn't accept the key.",
  not_openai: "The server didn't answer the way an OpenAI compatible server does.",
  http: 'The server answered with an error.',
  too_large: 'The server sent back more than expected.',
  redirected: 'The server sent us somewhere else.',
  model_not_found: "The server doesn't have that model.",
  context_full: "That is longer than the model's context.",
  bad_answer: "The model's answer was not in the shape asked for.",
  unsupported: 'That is not available.',
};

const failure = (kind: LocalFailureKind): LocalFailure => ({ ok: false, kind, reason: WORDS[kind] });

export function createMemoryLocalModel(endpoints: Readonly<Record<string, MemoryEndpoint>> = {}): LocalModelPort & {
  /** Every call it got: the method and the base URL, never a key. */
  readonly calls: ReadonlyArray<{ method: string; baseUrl: string }>;
} {
  const calls: Array<{ method: string; baseUrl: string }> = [];
  const open = (method: string, target: LocalModelTarget): MemoryEndpoint | LocalFailure => {
    calls.push({ method, baseUrl: target.baseUrl });
    const endpoint = endpoints[target.baseUrl];
    if (endpoint === undefined) return failure('unreachable');
    if (endpoint.failWith !== undefined) return failure(endpoint.failWith);
    if (endpoint.requireKey !== undefined && endpoint.requireKey !== target.key) return failure('key_refused');
    return endpoint;
  };
  const isFailure = (value: MemoryEndpoint | LocalFailure): value is LocalFailure => 'ok' in value;
  return {
    calls,
    async probe(target) {
      const endpoint = open('probe', target);
      return isFailure(endpoint) ? endpoint : { ok: true, models: endpoint.models.map((model) => model.id) };
    },
    async listModels(target) {
      const endpoint = open('listModels', target);
      return isFailure(endpoint) ? endpoint : { ok: true, models: [...endpoint.models] };
    },
    async structuredComplete(target, request: StructuredRequest): Promise<StructuredResult> {
      const endpoint = open('structuredComplete', target);
      if (isFailure(endpoint)) return endpoint;
      if (!endpoint.models.some((model) => model.id === request.model)) return failure('model_not_found');
      return { ok: true, value: endpoint.structured?.[request.model] ?? {}, mode: 'json_schema' };
    },
  };
}
