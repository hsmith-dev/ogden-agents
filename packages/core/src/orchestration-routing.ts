/**
 * A project's routing rules (epic 15, story 15.12): plain sentences the person writes about which kind of work should go to which worker.
 * They are kept with the project (one JSON column), read each time a plan is asked for, and reach the manager only as capped, masked data
 * that the system text calls the person's wishes. A rule is a suggestion: nothing here widens the roster, the vendor's terms or the mode,
 * which are checked in code exactly as before. No learned routing: a rule exists only because the person wrote it.
 */
import { redactSecrets, ROUTING_LIMITS, ORCHESTRATION_ROUTING_WORDS, RoutingRule as RoutingRuleSchema, RoutingRuleId as RoutingRuleIdSchema, SetOrchestrationRoutingRequest, type RoutingRule, type WorkspaceId } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Orm } from './db/database.js';
import { workspaces } from './db/schema.js';
import { ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import type { OrchestrationFeature } from './orchestration-feature.js';

/** What the column holds: the rules and the number the next new rule's id takes, which only grows so an id is never given to two rules. */
interface Stored {
  rules: RoutingRule[];
  next: number;
}

function readStored(orm: Orm, workspaceId: string): Stored | undefined {
  const row = orm.select({ routing: workspaces.orchestrationRouting }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (row === undefined) return undefined;
  if (row.routing === null) return { rules: [], next: 1 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.routing);
  } catch {
    return { rules: [], next: 1 };
  }
  // A list is the plain form; an object also carries the counter.
  const list: unknown = Array.isArray(parsed) ? parsed : (parsed as { rules?: unknown } | null)?.rules;
  const counter = !Array.isArray(parsed) && typeof (parsed as { next?: unknown } | null)?.next === 'number' ? (parsed as { next: number }).next : 1;
  const seen = new Set<string>();
  const rules: RoutingRule[] = [];
  if (Array.isArray(list)) {
    for (const each of list) {
      const rule = RoutingRuleSchema.safeParse(each);
      if (!rule.success || seen.has(rule.data.id)) continue;
      seen.add(rule.data.id);
      rules.push(rule.data);
      if (rules.length === ROUTING_LIMITS.maxRules) break;
    }
  }
  const highest = Math.max(0, ...rules.map((rule) => Number(rule.id.slice(1))));
  return { rules, next: Math.max(Number.isFinite(counter) ? Math.floor(counter) : 1, highest + 1) };
}

/** The project's rules in the person's order. A damaged value, or one rule that is not clean, is left out and the others stay; `undefined` for an unknown project. */
export const readRoutingRules = (orm: Orm, workspaceId: string): RoutingRule[] | undefined => readStored(orm, workspaceId)?.rules;

/** The number the next new rule's id takes. It never goes down, so a deleted rule's id is not given to another rule. */
export const readRoutingNext = (orm: Orm, workspaceId: string): number => readStored(orm, workspaceId)?.next ?? 1;

/** Stores `rules` for the project, with the counter of ids given so far. The caller has checked them. */
export function writeRoutingRules(orm: Orm, workspaceId: string, rules: readonly RoutingRule[], next: number): void {
  orm
    .update(workspaces)
    .set({ orchestrationRouting: rules.length === 0 && next <= 1 ? null : JSON.stringify({ next, rules: rules.map((rule) => ({ id: rule.id, text: rule.text })) }) })
    .where(eq(workspaces.id, workspaceId))
    .run();
}

const refuse = (message: string, path: string): never => {
  throw new ValidationError(message, [{ path: ['rules', path], message }]);
};

/**
 * The rules a `PUT` asks for, checked: at most {@link ROUTING_LIMITS.maxRules}, each one clean line of at most
 * {@link ROUTING_LIMITS.maxRuleChars} characters (trimmed, inner white space folded) that holds no secret. An item with the id of a rule
 * `current` has keeps it; every other item gets the next id from the counter, which never goes down. {@link ValidationError} in plain words otherwise, and nothing is stored.
 */
export function checkRoutingRequest(request: unknown, current: readonly RoutingRule[], next: number): { rules: RoutingRule[]; next: number } {
  const parsed = SetOrchestrationRoutingRequest.safeParse(request);
  if (!parsed.success) return refuse(ORCHESTRATION_ROUTING_WORDS.badText, 'shape');
  if (parsed.data.rules.length > ROUTING_LIMITS.maxRules) return refuse(ORCHESTRATION_ROUTING_WORDS.tooMany, 'count');
  const known = new Set(current.map((rule) => rule.id));
  const used = new Set<string>();
  let counter = next;
  const out: RoutingRule[] = [];
  for (const [index, item] of parsed.data.rules.entries()) {
    const text = item.text.replace(/\s+/g, ' ').trim();
    if (text.length > ROUTING_LIMITS.maxRuleChars) return refuse(ORCHESTRATION_ROUTING_WORDS.tooLong, String(index));
    if (redactSecrets(text) !== text) return refuse(ORCHESTRATION_ROUTING_WORDS.secret, String(index));
    let id = item.id !== undefined && RoutingRuleIdSchema.safeParse(item.id).success && known.has(item.id) && !used.has(item.id) ? item.id : undefined;
    if (id === undefined) {
      id = `r${counter}`;
      counter += 1;
    }
    used.add(id);
    const rule = RoutingRuleSchema.safeParse({ id, text });
    if (!rule.success) return refuse(ORCHESTRATION_ROUTING_WORDS.badText, String(index));
    out.push(rule.data);
  }
  return { rules: out, next: counter };
}

/** Whether two lists say the same, rule for rule and in order. */
export const sameRules = (a: readonly RoutingRule[], b: readonly RoutingRule[]): boolean => a.length === b.length && a.every((rule, index) => rule.id === b[index]?.id && rule.text === b[index]?.text);

/**
 * The two uses of the rules (15.12): read them, and save the whole list. Each asks the Orchestration piece's guard first. A change appends
 * `orchestration.routing_changed` (ids only), in the same transaction as the write. This is the only code that writes the rules, and it
 * touches no roster, mode, approval, dispatch or build code.
 */
export function createRouting({ orm, events, feature }: { orm: Orm; events: EventLog; feature: OrchestrationFeature }) {
  return {
    /** The project's routing rules: the person's plain sentences, in their order, each with the id a plan names when a step followed it. */
    getRouting(workspaceId: WorkspaceId): RoutingRule[] {
      feature.requireOrchestration(workspaceId);
      return readRoutingRules(orm, workspaceId) ?? [];
    },
    /**
     * The person saves the whole list of rules. At most 10, each one clean line of at most 300 characters holding no secret
     * ({@link ValidationError} in plain words otherwise, nothing stored). Items that name an existing rule's id keep it; the rest are new rules.
     * Returns the rules as stored.
     */
    setRouting(workspaceId: WorkspaceId, request: unknown): RoutingRule[] {
      feature.requireOrchestration(workspaceId);
      return events.transaction(() => {
        const current = readRoutingRules(orm, workspaceId) ?? [];
        const { rules: next, next: counter } = checkRoutingRequest(request, current, readRoutingNext(orm, workspaceId));
        if (!sameRules(current, next)) {
          writeRoutingRules(orm, workspaceId, next, counter);
          events.append({ type: 'orchestration.routing_changed', workspaceId, streamId: workspaceId, payload: { ruleIds: next.map((rule) => rule.id), previousRuleIds: current.map((rule) => rule.id) } });
        }
        return next;
      });
    },
  };
}
