/**
 * The port for talking to a model served on the user's own computer or
 * another OpenAI-compatible endpoint (epic 14, AD-1 note: a tool-free model
 * client is not an agent runtime). It can probe an endpoint, list the models
 * it serves and answer one non-streaming request constrained to a
 * caller-supplied JSON schema; it runs no tools and touches no files. Core
 * names no vendor and no server product: the adapter (`local-model-openai`)
 * does the calling, and only the server ever calls (AD-15).
 *
 * Every method takes the endpoint as a {@link LocalModelTarget}: where to
 * call and the key (in memory only, AD-16). The confirmation rule for a host
 * that is not this computer is enforced by `LocalEndpoints.target` (core), the one
 * place that turns an endpoint id into a target (`LocalModels` calls only through it); an adapter never decides it.
 * Methods never throw: a failure is a value with a kind and plain words.
 */

/** Where to call, and the key for it when the endpoint has one. Never logged. */
export interface LocalModelTarget {
  baseUrl: string;
  key?: string | undefined;
  /** The preset the endpoint was made from, when it was: an adapter may read more of that kind of server (sizes, context length) than the OpenAI-compatible list gives. */
  preset?: string | undefined;
}

/** Why a call to an endpoint failed. */
export const LOCAL_FAILURE_KINDS = [
  /** Nothing is listening, or the host is not found. */
  'unreachable',
  /** No answer in time. */
  'timeout',
  /** The server said the key is missing or wrong. */
  'key_refused',
  /** It answered, but not as an OpenAI-compatible server does. */
  'not_openai',
  /** An HTTP error, with its status. */
  'http',
  /** The answer was larger than allowed. */
  'too_large',
  /** It answered with a redirect, which is never followed. */
  'redirected',
  /** The server has no such model. */
  'model_not_found',
  /** The request was longer than the model's context. */
  'context_full',
  /** The answer was not JSON, or did not fit the schema, even after the retry. */
  'bad_answer',
  /** This adapter can't do it (yet). */
  'unsupported',
] as const;
export type LocalFailureKind = (typeof LOCAL_FAILURE_KINDS)[number];

export interface LocalFailure {
  ok: false;
  kind: LocalFailureKind;
  /** The HTTP status, for `http`. */
  status?: number | undefined;
  /** Plain words for the user. Never a key or an answer's text (the address's host and port only). */
  reason: string;
  /** For `bad_answer`: why, as a short token (`not_json`, `off_shape`, `no_way_to_ask`, `bad_schema`). */
  detail?: string | undefined;
}

/** One model an endpoint serves, with what the server reports of it (nothing is guessed). */
export interface LocalModelInfo {
  id: string;
  /** Parameters or size on disk in bytes, where the server reports it. */
  sizeBytes?: number | undefined;
  /** Parameters as the server writes them (`7B`), where it reports them. */
  parameterSize?: string | undefined;
  /** The context window in tokens, where the server reports it. */
  contextTokens?: number | undefined;
  /** Whether the server says it can call tools; `undefined` when it doesn't say. */
  toolCall?: boolean | undefined;
}

export type LocalProbeResult = { ok: true; models: string[] } | LocalFailure;
export type LocalModelsResult = { ok: true; models: LocalModelInfo[] } | LocalFailure;

/** One request for an answer in a fixed JSON shape (epic 15's manager; story 14.8). */
export interface StructuredRequest {
  model: string;
  /** An optional instruction before the prompt. */
  system?: string | undefined;
  prompt: string;
  /** A JSON schema the answer must fit. Ogden validates it itself: the server's constraint is a help, not a guarantee. */
  schema: Readonly<Record<string, unknown>>;
  /** The schema's name for the server (letters, digits, `_` and `-`). */
  schemaName?: string | undefined;
  maxTokens?: number | undefined;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

export type StructuredResult =
  | {
      ok: true;
      /** The parsed answer, validated against the schema. */
      value: unknown;
      /** How the server was asked, from the strictest: what worked tells epic 15 what the model can do. */
      mode: 'json_schema' | 'json_object' | 'prompt';
    }
  | LocalFailure;

export interface LocalModelPort {
  /** Whether the endpoint is there and which models it serves (`GET /models`). */
  probe(target: LocalModelTarget, signal?: AbortSignal): Promise<LocalProbeResult>;
  /** The models it serves with what the server reports of each. */
  listModels(target: LocalModelTarget, signal?: AbortSignal): Promise<LocalModelsResult>;
  /**
   * One non-streaming chat completion constrained to `request.schema` (temperature 0, no tools), validated by Ogden,
   * falling back from `json_schema` to `json_object` to a prompt only. Story 14.8 fills it in the real adapter.
   */
  structuredComplete(target: LocalModelTarget, request: StructuredRequest): Promise<StructuredResult>;
}
