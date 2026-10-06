/**
 * The real manager (epic 15, story 15.4): a {@link ManagerPort} on
 * {@link LocalModelPort.structuredComplete}, for one model on one of the user's
 * endpoints. It is a tool-free model call: it holds no shell, file, agent or
 * credential port, and it names no vendor or model product (AD-1 note).
 *
 * Each call:
 * 1. Gets where to call from {@link LocalEndpoints.target}, the one place that
 *    refuses a host that is not this computer and was not confirmed
 *    (`host_not_confirmed`), and an endpoint that is gone (`endpoint_missing`).
 *    Nothing is called before that.
 * 2. Builds the input from core's data ({@link buildManagerInput}), capped to
 *    half of the endpoint's reported context (a conservative default when it
 *    reports none); if even the least input does not fit, `context_too_small`.
 * 3. Asks with the shared JSON schema. `structuredComplete` already walks its
 *    ladder (json_schema, json_object, prompt) and repairs once when the answer
 *    is not JSON or does not fit the schema subset. So a failure it returns
 *    (`bad_answer`) is final here: asking again would double the repair.
 * 4. Validates the answer with {@link validatePlanFor} or
 *    {@link validateDecisionFor}: the rules a schema cannot say (a ready worker,
 *    links between steps, text rules, a step of the plan). A broken rule gets
 *    one repair, naming only that rule in plain words (never the model's own
 *    text), then it is final: `malformed` or `off_roster`, and nothing is
 *    dispatched.
 * 5. Returns the result with a {@link ManagerRecord} (the masked output) that
 *    core appends to the event log, because only core knows the run.
 *
 * The endpoint's key is never in the prompt: the input is built from the
 * context alone, and a key's own text is masked out of it as a backstop.
 */
import {
  MANAGER_DECISION_JSON_SCHEMA,
  MANAGER_LIMITS,
  MANAGER_PLAN_JSON_SCHEMA,
  MANAGER_REFUSAL_REASONS,
  redactSecrets,
  type LocalEndpointId,
  type ManagerRefusalCode,
} from '@ogden-agents/shared';
import { EndpointConfirmationRequiredError, type LocalEndpoints } from './local-endpoints.js';
import type { LocalFailure, LocalModelPort, LocalModelTarget, StructuredResult } from './local-model-port.js';
import { answerTokens, buildManagerInput, inputBudgetChars } from './manager-input.js';
import {
  MANAGER_FAILURE_WORDS,
  validateDecisionFor,
  validatePlanFor,
  type ManagerContext,
  type ManagerDecisionContext,
  type ManagerFailure,
  type ManagerFailureKind,
  type ManagerPort,
  type ManagerRecord,
  type ManagerResult,
} from './manager-port.js';
import { NotFoundError } from './errors.js';

/** How long one call may take in all, repair included, before it is `too_slow`. */
export const MANAGER_CALL_TIMEOUT_MS = 90_000;

/** The context window of `model` on the endpoint at `target`, in tokens, when the server reports one. */
export type ContextReader = (target: LocalModelTarget, model: string) => Promise<number | undefined>;

/**
 * A reader of the endpoint's reported context that asks the server at most once in `ttlMs` per endpoint and model
 * (`listModels` can take several requests). A server that does not answer is read as not reporting one, and is asked
 * again next time.
 */
export function createContextReader(port: Pick<LocalModelPort, 'listModels'>, ttlMs = 5 * 60_000, now: () => number = Date.now): ContextReader {
  const known = new Map<string, { at: number; tokens: number | undefined }>();
  return async (target, model) => {
    const key = `${target.baseUrl}\u0000${model}`;
    const hit = known.get(key);
    if (hit !== undefined && now() - hit.at < ttlMs) return hit.tokens;
    let listed: Awaited<ReturnType<LocalModelPort['listModels']>>;
    try {
      listed = await port.listModels({ baseUrl: target.baseUrl, key: target.key, preset: target.preset });
    } catch {
      return undefined;
    }
    if (!listed.ok) return undefined;
    const tokens = listed.models.find((each) => each.id === model)?.contextTokens;
    known.set(key, { at: now(), tokens });
    return tokens;
  };
}

export interface ModelManagerOptions {
  port: LocalModelPort;
  /** Only `target`: the confirmation rule lives there. */
  endpoints: Pick<LocalEndpoints, 'target'>;
  endpointId: LocalEndpointId;
  model: string;
  /** Default: no report, so a conservative context is assumed. */
  contextOf?: ContextReader | undefined;
  /** The whole call's limit in milliseconds (default {@link MANAGER_CALL_TIMEOUT_MS}). */
  timeoutMs?: number | undefined;
}

const fail = (kind: ManagerFailureKind, record: Partial<ManagerRecord> & Pick<ManagerRecord, 'call'>, extra: Partial<ManagerFailure> = {}): ManagerFailure => ({
  ok: false,
  kind,
  reason: extra.reason ?? MANAGER_FAILURE_WORDS[kind],
  ...(extra.code === undefined ? {} : { code: extra.code }),
  record: { outcome: 'refused', asked: null, repaired: false, ...record, failure: kind, ...(extra.code === undefined ? {} : { code: extra.code }) },
});

/** What a failure of the model call is told as. Plain words are ours: the server's own text and address are not passed on. */
function failureOf(failure: LocalFailure): { kind: ManagerFailureKind; reason?: string; code?: ManagerRefusalCode } {
  switch (failure.kind) {
    case 'timeout':
      return { kind: 'too_slow', code: 'timeout' };
    case 'too_large':
      return { kind: 'too_large', code: 'too_large' };
    case 'context_full':
      return { kind: 'context_too_small' };
    case 'bad_answer':
      return failure.detail === 'not_json' ? { kind: 'malformed', code: 'not_json', reason: MANAGER_REFUSAL_REASONS.not_json } : { kind: 'malformed' };
    case 'key_refused':
      return { kind: 'unavailable', reason: "The manager's server did not accept its key." };
    case 'model_not_found':
      return { kind: 'unavailable', reason: "The manager's model is not on its server right now." };
    case 'unreachable':
      return { kind: 'unavailable', reason: "The manager's server is not answering." };
    default:
      return { kind: 'unavailable', reason: "The manager's server did not answer as expected." };
  }
}

/** `text` cut to `max` characters on whole characters. */
function capped(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = '';
  for (const char of text) {
    if (kept.length + char.length > max) break;
    kept += char;
  }
  return kept;
}

/** The manager's answer as masked, capped JSON text for the event log. */
function recordOutput(value: unknown): string | undefined {
  try {
    const text = JSON.stringify(value);
    // Mask after the cut as well: a cut can leave half a secret that the first pass would not have seen whole.
    return text === undefined ? undefined : redactSecrets(capped(redactSecrets(text), MANAGER_LIMITS.maxRecordChars));
  } catch {
    return undefined;
  }
}

export function createModelManager({ port, endpoints, endpointId, model, contextOf, timeoutMs = MANAGER_CALL_TIMEOUT_MS }: ModelManagerOptions): ManagerPort {
  async function call<T>(
    kind: 'plan' | 'decision',
    context: ManagerContext | ManagerDecisionContext,
    validate: (value: unknown) => ManagerResult<T>,
    signal: AbortSignal | undefined,
  ): Promise<ManagerResult<T>> {
    try {
      return await run(kind, context, validate, signal);
    } catch {
      // The port promises not to throw: whatever went wrong, it is a plain failure and nothing is dispatched.
      return fail('unavailable', { call: kind });
    }
  }

  async function run<T>(kind: 'plan' | 'decision', context: ManagerContext | ManagerDecisionContext, validate: (value: unknown) => ManagerResult<T>, signal: AbortSignal | undefined): Promise<ManagerResult<T>> {
    const deadline = Date.now() + Math.max(1, timeoutMs);
    if (signal?.aborted === true) return fail('unavailable', { call: kind });

    // Where to call, through the one place that enforces the non-loopback confirmation. Nothing is called before it answers.
    let target: Awaited<ReturnType<LocalEndpoints['target']>>;
    try {
      target = await endpoints.target(endpointId);
    } catch (error) {
      if (error instanceof EndpointConfirmationRequiredError) return fail('host_not_confirmed', { call: kind });
      if (error instanceof NotFoundError) return fail('endpoint_missing', { call: kind });
      return fail('unavailable', { call: kind });
    }
    if (target === undefined) return fail('endpoint_missing', { call: kind });
    const place: LocalModelTarget = { baseUrl: target.baseUrl, key: target.key, preset: target.preset };

    const contextTokens = await (contextOf?.(place, model) ?? Promise.resolve(undefined)).catch(() => undefined);
    const schema = kind === 'plan' ? MANAGER_PLAN_JSON_SCHEMA : MANAGER_DECISION_JSON_SCHEMA;
    const built = buildManagerInput(kind, context, inputBudgetChars(contextTokens), JSON.stringify(schema).length);
    if (!built.ok) return fail('context_too_small', { call: kind });
    // A backstop: the endpoint's own key is never in the input (it holds none), and its text would be masked if it were.
    const key = target.key;
    const scrub = (text: string): string => (key !== undefined && key.length >= 4 ? text.split(key).join('[redacted]') : text);
    const system = scrub(built.input.system);
    const prompt = scrub(built.input.prompt);

    const ask = (text: string): Promise<StructuredResult> =>
      port.structuredComplete(place, {
        model,
        system,
        prompt: text,
        schema,
        schemaName: kind === 'plan' ? 'manager_plan' : 'manager_decision',
        maxTokens: answerTokens(contextTokens, kind),
        timeoutMs: Math.max(1, deadline - Date.now()),
        signal,
      });

    let asked: ManagerRecord['asked'] = null;
    let repaired = false;
    const first = await ask(prompt);
    if (!first.ok) {
      // `structuredComplete` has already repaired a bad shape once: no second ask here.
      const told = failureOf(first);
      return fail(told.kind, { call: kind }, { ...(told.reason === undefined ? {} : { reason: told.reason }), ...(told.code === undefined ? {} : { code: told.code }) });
    }
    asked = first.mode;
    let value = first.value;
    let checked = validate(value);

    if (!checked.ok) {
      // A rule the schema cannot say was broken: one more ask, naming only the rule, in our words.
      if (Date.now() >= deadline) return refusal(kind, checked, asked, repaired, value);
      repaired = true;
      const second = await ask(`${prompt}\n\nYour last answer was not accepted. ${checked.reason} Reply again with only the corrected JSON.`);
      if (!second.ok) {
        const told = failureOf(second);
        return fail(told.kind, { call: kind, asked, repaired }, { ...(told.reason === undefined ? {} : { reason: told.reason }), ...(told.code === undefined ? {} : { code: told.code }) });
      }
      asked = second.mode;
      value = second.value;
      checked = validate(value);
    }
    if (!checked.ok) return refusal(kind, checked, asked, repaired, value);
    return { ok: true, value: checked.value, record: { call: kind, outcome: 'accepted', asked, repaired, ...(recordOutput(checked.value) === undefined ? {} : { output: recordOutput(checked.value) }) } };
  }

  /** A refusal by the rules, with the manager's masked answer in its record. */
  function refusal<T>(kind: 'plan' | 'decision', checked: ManagerFailure, asked: ManagerRecord['asked'], repaired: boolean, value: unknown): ManagerResult<T> {
    const output = recordOutput(value);
    return {
      ok: false,
      kind: checked.kind,
      reason: checked.reason,
      ...(checked.code === undefined ? {} : { code: checked.code }),
      record: { call: kind, outcome: 'refused', asked, repaired, failure: checked.kind, ...(checked.code === undefined ? {} : { code: checked.code }), ...(output === undefined ? {} : { output }) },
    };
  }

  return {
    proposePlan: (context, signal) => call('plan', context, (value) => validatePlanFor(context, value), signal),
    decideNext: (context, signal) => call('decision', context, (value) => validateDecisionFor(context, value), signal),
  };
}
