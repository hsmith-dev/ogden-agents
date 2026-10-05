/**
 * `structuredComplete` (epic 14 story 14.8; the hook for epic 15's manager):
 * one non-streaming chat completion constrained to a caller's JSON schema,
 * validated by Ogden. No tools, no files, no streaming; temperature 0; a hard
 * timeout and a size cap on the answer.
 *
 * A server's constraint is a help, not a guarantee, so the answer is parsed and
 * checked here (`json-schema.ts`). The request walks a ladder from the
 * strictest ask to the most lenient, moving down only when a server refuses
 * the ask (HTTP 400 or 422) or answers with something that isn't the shape:
 *   1. `response_format` json_schema (strict)
 *   2. `response_format` json_object, with the schema in the prompt
 *   3. no `response_format`, the schema in the prompt (a code fence is accepted)
 * A model that answered but never in the shape gets one repair request on the
 * last rung, then fails in plain words. At most four requests in all. A key
 * that is refused, a server that is not there, a missing model, a full context
 * or a timeout fail at once with no more tries.
 */
import type { LocalFailure, LocalModelTarget, StructuredRequest, StructuredResult } from '@ogden-agents/core';
import { EndpointError, callEndpoint, type EndpointCall } from './http.js';
import { parseModelJson, schemaProblems } from './json-schema.js';
import { failureOf } from './port.js';

/** The longest the request may wait for the model, whatever the caller asks. */
export const STRUCTURED_MAX_TIMEOUT_MS = 120_000;
export const STRUCTURED_DEFAULT_TIMEOUT_MS = 60_000;
/** The most tokens asked for, and the default. */
export const STRUCTURED_MAX_TOKENS = 4_096;
export const STRUCTURED_DEFAULT_TOKENS = 1_024;
/** The most of an answer that is read. */
export const STRUCTURED_MAX_BYTES = 256 * 1024;
/** The largest schema accepted, as JSON. */
export const MAX_SCHEMA_CHARS = 20_000;

type Mode = 'json_schema' | 'json_object' | 'prompt';
const LADDER: readonly Mode[] = ['json_schema', 'json_object', 'prompt'];

const bad = (reason: string): LocalFailure => ({ ok: false, kind: 'bad_answer', reason });

/** A schema name the server accepts. */
const nameOf = (value: string | undefined): string => (value !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : 'answer');

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function body(request: StructuredRequest, mode: Mode, schemaText: string, messages: Message[]): Record<string, unknown> {
  const withSchema = messages.map((message, index) => (index === 1 && mode !== 'json_schema' ? { ...message, content: `${message.content}\n\nReply with one JSON value that fits this JSON schema, and nothing else:\n${schemaText}` } : message));
  return {
    model: request.model,
    temperature: 0,
    stream: false,
    max_tokens: Math.min(Math.max(1, request.maxTokens ?? STRUCTURED_DEFAULT_TOKENS), STRUCTURED_MAX_TOKENS),
    messages: withSchema,
    ...(mode === 'json_schema' ? { response_format: { type: 'json_schema', json_schema: { name: nameOf(request.schemaName), strict: true, schema: request.schema } } } : {}),
    ...(mode === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
  };
}

/** The message text of a chat completion answer, or `undefined`. */
function contentOf(answer: unknown): string | undefined {
  const choices = (answer as { choices?: unknown } | null)?.choices;
  const content = Array.isArray(choices) ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content : undefined;
  return typeof content === 'string' ? content : undefined;
}

export async function structuredComplete(call: Omit<EndpointCall, 'baseUrl' | 'key'>, target: LocalModelTarget, request: StructuredRequest): Promise<StructuredResult> {
  const schemaText = JSON.stringify(request.schema);
  if (typeof request.schema !== 'object' || request.schema === null || schemaText.length > MAX_SCHEMA_CHARS) return bad('The schema for the answer is not usable.');
  const endpoint: EndpointCall = {
    ...call,
    baseUrl: target.baseUrl,
    key: target.key,
    timeoutMs: Math.min(Math.max(1, request.timeoutMs ?? STRUCTURED_DEFAULT_TIMEOUT_MS), STRUCTURED_MAX_TIMEOUT_MS),
    maxBytes: STRUCTURED_MAX_BYTES,
    signal: request.signal ?? call.signal,
  };
  const messages: Message[] = [
    { role: 'system', content: request.system ?? 'Answer with one JSON value only.' },
    { role: 'user', content: request.prompt },
  ];
  let last: { mode: Mode; reply: string; problem: string } | undefined;

  const attempt = async (mode: Mode, sent: Message[]): Promise<{ ok: true; value: unknown } | { ok: false; refused: boolean; failure?: LocalFailure; reply?: string; problem?: string }> => {
    let answer: unknown;
    try {
      answer = await callEndpoint(endpoint, 'chat/completions', { method: 'POST', body: body(request, mode, schemaText, sent) });
    } catch (error) {
      if (!(error instanceof EndpointError)) return { ok: false, refused: false, failure: failureOf('unreachable', target.baseUrl) };
      const { status, apiCode } = error.details;
      // A server that refuses the ask (400, 422) is tried on the next rung, unless the refusal is about the model or the size.
      if (error.kind === 'http' && (apiCode === 'context_length_exceeded' || apiCode === 'string_above_max_length')) return { ok: false, refused: false, failure: { ok: false, kind: 'context_full', reason: "The model's context is too small for this request." } };
      if (error.kind === 'http' && (status === 404 || apiCode === 'model_not_found')) return { ok: false, refused: false, failure: { ok: false, kind: 'model_not_found', reason: "The server doesn't have that model right now." } };
      if (error.kind === 'http' && (status === 400 || status === 422)) return { ok: false, refused: true };
      return { ok: false, refused: false, failure: failureOf(error.kind, target.baseUrl, status) };
    }
    const reply = contentOf(answer);
    if (reply === undefined) return { ok: false, refused: false, failure: failureOf('not_openai', target.baseUrl) };
    const parsed = parseModelJson(reply) as { json: unknown } | undefined;
    if (parsed === undefined) return { ok: false, refused: false, reply, problem: 'the answer is not JSON' };
    const problems = schemaProblems(parsed.json, request.schema);
    if (problems.length > 0) return { ok: false, refused: false, reply, problem: problems.slice(0, 2).join('; ') };
    return { ok: true, value: parsed.json };
  };

  for (const mode of LADDER) {
    const result = await attempt(mode, messages);
    if (result.ok) return { ok: true, value: result.value, mode };
    if (result.failure !== undefined) return result.failure;
    // A refused ask, or an answer that is not the shape, moves down the ladder.
    if (result.reply !== undefined) last = { mode, reply: result.reply, problem: result.problem ?? 'the answer does not fit' };
  }
  if (last === undefined) return bad('The server did not accept any way of asking for a structured answer.');
  // One repair request on the most lenient rung, with the model's own answer and what was wrong.
  const repair = await attempt('prompt', [...messages, { role: 'assistant', content: last.reply.slice(0, 4_000) }, { role: 'user', content: `That was not valid: ${last.problem}. Reply again with only the corrected JSON.` }]);
  if (repair.ok) return { ok: true, value: repair.value, mode: 'prompt' };
  if (repair.failure !== undefined) return repair.failure;
  return bad(`The model answered, but not in the shape asked for (${repair.problem ?? last.problem}).`);
}
