/**
 * The manager reliability harness (epic 15 story 15.1), test support only:
 *
 * - `createFakeManager`: a `LocalModelPort` that plays the scripted cases of
 *   `manager-cases.ts` on cue (a `MANAGER_CASE:<id>` marker in the prompt), the
 *   way the real adapter would see them: it reads JSON out of prose and fences,
 *   gives a model that fails up to four requests, caps what it reads, and honours
 *   a timeout and an abort. No network, no files.
 * - `runCaseTable`: plays every case through any `LocalModelPort` (this fake, or
 *   the real adapter against the fake OpenAI-compatible server) and compares what
 *   happened with the table's expected outcome.
 * - `measureModel` and `formatReport`: tally a model's valid-JSON rate and
 *   latency over three sample goals. CI only ever runs it on the fake; the real
 *   measurement is the user's live check (RELEASING.md).
 *
 * Nothing here names a model product, and nothing calls a real model.
 */
import type { LocalFailure, LocalModelPort, LocalModelTarget, StructuredRequest, StructuredResult } from '../../packages/core/src/local-model-port.js';
import {
  HARNESS_LIMITS,
  HARNESS_ROSTER,
  MANAGER_CASES,
  PLAN_SCHEMA,
  REFUSAL_REASONS,
  checkManagerReply,
  markerFor,
  schemaFor,
  type CaseKind,
  type ManagerCase,
  type Outcome,
  type RefusalCode,
  type Script,
} from './manager-cases.js';

const CASE_PATTERN = /MANAGER_CASE:([a-z0-9-]+)/;
/** At most this many requests for one answer (three ways of asking, then one repair), as the real adapter does. */
const MAX_REQUESTS = 4;

/** The case a prompt asks for, if it carries a marker. */
export const caseIdIn = (prompt: string): string | undefined => CASE_PATTERN.exec(prompt)?.[1];

/** The JSON in a model's text: the whole text, a fenced block, or the first object that parses. Mirrors what Ogden reads. */
export function readJson(text: string): { json: unknown } | undefined {
  const attempt = (body: string): { json: unknown } | undefined => {
    if (body.trim() === '') return undefined;
    try {
      return { json: JSON.parse(body) as unknown };
    } catch {
      return undefined;
    }
  };
  const whole = attempt(text);
  if (whole !== undefined) return whole;
  const open = text.indexOf('```');
  const close = open === -1 ? -1 : text.indexOf('```', open + 3);
  if (open !== -1 && close !== -1) {
    const inner = text.slice(open + 3, close);
    const fenced = attempt(/^json\b/i.test(inner) ? inner.slice(4) : inner);
    if (fenced !== undefined) return fenced;
  }
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  return from !== -1 && to > from ? attempt(text.slice(from, to + 1)) : undefined;
}

const failure = (kind: LocalFailure['kind'], reason: string, detail?: string): LocalFailure => ({ ok: false, kind, reason, ...(detail === undefined ? {} : { detail }) });

export interface FakeManagerOptions {
  /** The cases it can play (default: the whole table). */
  cases?: readonly ManagerCase[];
  /** What it says to a prompt with no case marker (a model asked for a real plan). Default: a conforming plan. */
  fallback?: Script;
  /** Checks a parsed reply against the schema it was asked to fit, as the real adapter does; `[]` when it fits. Default: no check. */
  schemaCheck?: (value: unknown, schema: Readonly<Record<string, unknown>>) => readonly string[];
  /** The model id it serves. */
  model?: string;
}

export interface FakeManager extends LocalModelPort {
  /** Every structured request it got, in order: the case id (or `fallback`) and which request it was for that case. */
  readonly requests: ReadonlyArray<{ caseId: string; n: number; schemaName: string | undefined }>;
  /** How many requests for a case so far. */
  attempts(caseId: string): number;
  /** The model id it serves. */
  readonly model: string;
}

const GOOD_FALLBACK: Script = {
  replies: [
    JSON.stringify({
      version: 'ogden.manager.plan.v1',
      goal: 'A goal',
      steps: [{ id: 's1', worker: HARNESS_ROSTER[0], chat: 'new', instruction: 'Do the first thing.', mode: 'ask', depends_on: [] }],
    }),
  ],
};

export function createFakeManager(options: FakeManagerOptions = {}): FakeManager {
  const cases = new Map((options.cases ?? MANAGER_CASES).map((each) => [each.id, each]));
  const model = options.model ?? 'fake-manager';
  const requests: Array<{ caseId: string; n: number; schemaName: string | undefined }> = [];
  const counts = new Map<string, number>();
  const wait = (ms: number, signal: AbortSignal | undefined): Promise<'timeout' | 'aborted'> =>
    new Promise((resolve) => {
      if (signal?.aborted === true) return resolve('aborted');
      const timer = setTimeout(() => resolve('timeout'), ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve('aborted');
      }, { once: true });
    });

  return {
    requests,
    model,
    attempts: (caseId) => counts.get(caseId) ?? 0,
    async probe() {
      return { ok: true, models: [model] };
    },
    async listModels() {
      return { ok: true, models: [{ id: model }] };
    },
    async structuredComplete(_target: LocalModelTarget, request: StructuredRequest): Promise<StructuredResult> {
      if (request.model !== model) return failure('model_not_found', "The server doesn't have that model.");
      const id = caseIdIn(request.prompt);
      const script = id === undefined ? (options.fallback ?? GOOD_FALLBACK) : cases.get(id)?.script;
      if (script === undefined) return failure('bad_answer', "The model's answer was not in the shape asked for.", 'not_json');
      const key = id ?? 'fallback';
      if (script.hang === true) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        requests.push({ caseId: key, n: counts.get(key) ?? 1, schemaName: request.schemaName });
        await wait(request.timeoutMs ?? 1_000, request.signal);
        return failure('timeout', 'The server took too long to answer.');
      }
      let last: 'not_json' | 'off_shape' = 'not_json';
      for (let sent = 0; sent < MAX_REQUESTS; sent++) {
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        requests.push({ caseId: key, n, schemaName: request.schemaName });
        const reply = script.replies[Math.min(sent, script.replies.length - 1)] ?? '';
        if (Buffer.byteLength(reply) > HARNESS_LIMITS.maxReplyBytes) return failure('too_large', 'The server sent back more than expected.');
        const parsed = readJson(reply);
        if (parsed === undefined) {
          last = 'not_json';
          continue;
        }
        const problems = options.schemaCheck?.(parsed.json, request.schema) ?? [];
        if (problems.length > 0) {
          last = 'off_shape';
          continue;
        }
        return { ok: true, value: parsed.json, mode: sent === 0 ? 'json_schema' : 'prompt' };
      }
      return failure('bad_answer', "The model's answer was not in the shape asked for.", last);
    },
  };
}

// ---- the table runner ----

export interface Observed {
  outcome: Outcome;
  /** The token for a refusal, when the layer that refused gives one (a schema check gives none). */
  code?: RefusalCode;
  /** Plain words for a refusal. */
  reason?: string;
  /** The port refused the shape (valid JSON that did not fit the schema): the reason is one of the rule codes, not known here. */
  schemaRefused?: boolean;
  requests: number;
}

/** What happened to one case, from the port's answer and how many requests it took. */
export function observe(kind: CaseKind, result: StructuredResult, requests: number, roster: readonly string[] = HARNESS_ROSTER): Observed {
  if (!result.ok) {
    const code: RefusalCode | undefined = result.kind === 'too_large' ? 'too_large' : result.kind === 'timeout' ? 'timeout' : result.detail === 'not_json' ? 'not_json' : undefined;
    return { outcome: 'refused', ...(code === undefined ? {} : { code, reason: REFUSAL_REASONS[code] }), ...(result.kind === 'bad_answer' && result.detail === 'off_shape' ? { schemaRefused: true } : {}), requests };
  }
  const checked = checkManagerReply(kind, result.value, roster);
  if (!checked.ok) return { outcome: 'refused', code: checked.code, reason: checked.reason, requests };
  return { outcome: requests > 1 ? 'repaired' : 'accepted', requests };
}

export interface CaseRow {
  id: string;
  group: ManagerCase['group'];
  expected: ManagerCase['expected'];
  observed: Observed;
  match: boolean;
}

export interface TableRun {
  rows: CaseRow[];
  total: number;
  matched: number;
  mismatches: CaseRow[];
}

export interface TableOptions {
  port: LocalModelPort;
  target: LocalModelTarget;
  model: string;
  cases?: readonly ManagerCase[];
  /** A count of requests the model has served so far; read before and after each case to tell accepted from repaired. */
  countRequests: () => number;
  /** How long a case may take (default 300 ms for a hanging case, 10 s for any other, so load cannot turn a refusal into a timeout). */
  timeoutMs?: number | ((each: ManagerCase) => number);
  roster?: readonly string[];
}

const PORT_CODES: readonly RefusalCode[] = ['not_json', 'too_large', 'timeout'];

/**
 * An observed outcome matches when the outcome is the expected one and a refusal has the expected code. The one
 * exception: a schema refusal gives no code, and stands for any rule code the schema can say (never a port code).
 */
export const matches = (expected: ManagerCase['expected'], observed: Observed): boolean => {
  if (expected.outcome !== observed.outcome) return false;
  if (expected.outcome !== 'refused') return true;
  if (observed.schemaRefused === true) return expected.code !== undefined && !PORT_CODES.includes(expected.code);
  return observed.code === expected.code;
};

/** Plays each case through `port` in order (one at a time) and compares it with the table. */
export async function runCaseTable(options: TableOptions): Promise<TableRun> {
  const rows: CaseRow[] = [];
  for (const each of options.cases ?? MANAGER_CASES) {
    const before = options.countRequests();
    const result = await options.port.structuredComplete(options.target, {
      model: options.model,
      prompt: `${markerFor(each.id)}\nPlan the work for the goal.`,
      schema: schemaFor(each.kind),
      schemaName: each.kind === 'plan' ? 'manager_plan' : 'manager_decision',
      timeoutMs: typeof options.timeoutMs === 'function' ? options.timeoutMs(each) : (options.timeoutMs ?? (each.script.hang === true ? 300 : 10_000)),
    });
    const observed = observe(each.kind, result, options.countRequests() - before, options.roster);
    rows.push({ id: each.id, group: each.group, expected: each.expected, observed, match: matches(each.expected, observed) });
  }
  const mismatches = rows.filter((row) => !row.match);
  return { rows, total: rows.length, matched: rows.length - mismatches.length, mismatches };
}

// ---- the model measurement ----

/** Three goals of different size a manager is asked to plan. */
export const SAMPLE_GOALS: readonly string[] = [
  'Add a contact form to the bakery website that emails the owner.',
  'Fix the bug where the shopping cart total is wrong after removing an item, and add a test for it.',
  'Move the project from plain JavaScript to TypeScript one folder at a time, keeping the tests green.',
];

export const planPrompt = (goal: string, roster: readonly string[] = HARNESS_ROSTER): string =>
  `You manage a small team of coding agents. Plan the work for this goal as steps, each given to one worker.\nGoal: ${goal}\nWorkers you may use: ${roster.join(', ')}.\nEvery step asks for the mode "ask". Use "new" as the chat for a new chat.`;

export interface MeasureOptions {
  port: LocalModelPort;
  target: LocalModelTarget;
  model: string;
  goals?: readonly string[];
  /** Times to ask for each goal (default 1). */
  repeats?: number;
  timeoutMs?: number;
  roster?: readonly string[];
  /** A clock in milliseconds (default `Date.now`). */
  now?: () => number;
  /** Builds the prompt for a goal (default `planPrompt`). The fake plays a marked case when the prompt carries one. */
  promptFor?: (goal: string) => string;
}

export interface RunRecord {
  goal: string;
  /** The answer was JSON at all. */
  validJson: boolean;
  /** The answer passed the schema and every rule. */
  conforming: boolean;
  latencyMs: number;
  /** Plain words, for a run that did not conform. */
  problem?: string;
}

export interface ModelReport {
  model: string;
  runs: number;
  validJsonRuns: number;
  conformingRuns: number;
  /** 0 to 1. */
  validJsonRate: number;
  conformingRate: number;
  meanLatencyMs: number;
  maxLatencyMs: number;
  records: RunRecord[];
}

/** Asks `model` to plan each sample goal and tallies how often it answered in JSON, and how often a usable plan. */
export async function measureModel(options: MeasureOptions): Promise<ModelReport> {
  const now = options.now ?? Date.now;
  const records: RunRecord[] = [];
  for (const goal of options.goals ?? SAMPLE_GOALS) {
    for (let time = 0; time < (options.repeats ?? 1); time++) {
      const started = now();
      const result = await options.port.structuredComplete(options.target, {
        model: options.model,
        prompt: (options.promptFor ?? ((text) => planPrompt(text, options.roster)))(goal),
        schema: PLAN_SCHEMA,
        schemaName: 'manager_plan',
        timeoutMs: options.timeoutMs ?? 60_000,
      });
      const latencyMs = Math.max(0, now() - started);
      if (result.ok) {
        const checked = checkManagerReply('plan', result.value, options.roster);
        records.push({ goal, validJson: true, conforming: checked.ok, latencyMs, ...(checked.ok ? {} : { problem: checked.reason }) });
      } else {
        records.push({ goal, validJson: result.kind === 'bad_answer' && result.detail === 'off_shape', conforming: false, latencyMs, problem: result.reason });
      }
    }
  }
  const count = (pick: (record: RunRecord) => boolean) => records.filter(pick).length;
  const total = records.length;
  const latencies = records.map((record) => record.latencyMs);
  return {
    model: options.model,
    runs: total,
    validJsonRuns: count((record) => record.validJson),
    conformingRuns: count((record) => record.conforming),
    validJsonRate: total === 0 ? 0 : count((record) => record.validJson) / total,
    conformingRate: total === 0 ? 0 : count((record) => record.conforming) / total,
    meanLatencyMs: total === 0 ? 0 : Math.round(latencies.reduce((sum, each) => sum + each, 0) / total),
    maxLatencyMs: Math.max(0, ...latencies),
    records,
  };
}

const percent = (rate: number): string => `${Math.round(rate * 100)}%`;

/** The measurement as plain lines a person can paste into the live check notes. No dashes. */
export function formatReport(report: ModelReport): string {
  const lines = [
    `Model: ${report.model}`,
    `Asked: ${report.runs} times`,
    `Answered in JSON: ${report.validJsonRuns} of ${report.runs} (${percent(report.validJsonRate)})`,
    `Gave a usable plan: ${report.conformingRuns} of ${report.runs} (${percent(report.conformingRate)})`,
    `Time to answer: ${report.meanLatencyMs} ms on average, ${report.maxLatencyMs} ms at most`,
  ];
  for (const record of report.records) if (!record.conforming) lines.push(`Not usable: "${record.goal.slice(0, 60)}" because ${record.problem ?? 'it did not fit'}`);
  return lines.join('\n');
}

/** A table run as plain lines. */
export function formatTable(run: TableRun): string {
  const lines = [`Cases matching the table: ${run.matched} of ${run.total}`];
  for (const row of run.mismatches) lines.push(`Different from the table: ${row.id} expected ${row.expected.outcome}${row.expected.code === undefined ? '' : ` (${row.expected.code})`}, got ${row.observed.outcome}${row.observed.code === undefined ? '' : ` (${row.observed.code})`}`);
  return lines.join('\n');
}
