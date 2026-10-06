/**
 * A project's routing rules (epic 15, story 15.12): plain sentences the person writes about which kind of work should go to which worker.
 * They are kept with the project (one JSON column), read each time a plan is asked for, and reach the manager only as capped, masked data
 * that the system text calls the person's wishes. A rule is a suggestion: nothing here widens the roster, the vendor's terms or the mode,
 * which are checked in code exactly as before. No learned routing: a rule exists only because the person wrote it.
 */
import { redactSecrets, ROUTING_LIMITS, ORCHESTRATION_ROUTING_WORDS, RoutingRule as RoutingRuleSchema, RoutingRuleId as RoutingRuleIdSchema, SetOrchestrationRoutingRequest, type RoutingRule } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Orm } from './db/database.js';
import { workspaces } from './db/schema.js';
import { ValidationError } from './errors.js';

/** The project's rules in the person's order. A damaged value, or one rule that is not clean, is left out and the others stay; `undefined` for an unknown project. */
export function readRoutingRules(orm: Orm, workspaceId: string): RoutingRule[] | undefined {
  const row = orm.select({ routing: workspaces.orchestrationRouting }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (row === undefined) return undefined;
  if (row.routing === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.routing);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const rules: RoutingRule[] = [];
  for (const each of parsed) {
    const rule = RoutingRuleSchema.safeParse(each);
    if (!rule.success || seen.has(rule.data.id)) continue;
    seen.add(rule.data.id);
    rules.push(rule.data);
    if (rules.length === ROUTING_LIMITS.maxRules) break;
  }
  return rules;
}

/** Stores `rules` for the project. The caller has checked them. */
export function writeRoutingRules(orm: Orm, workspaceId: string, rules: readonly RoutingRule[]): void {
  orm
    .update(workspaces)
    .set({ orchestrationRouting: rules.length === 0 ? null : JSON.stringify(rules.map((rule) => ({ id: rule.id, text: rule.text }))) })
    .where(eq(workspaces.id, workspaceId))
    .run();
}

const refuse = (message: string, path: string): never => {
  throw new ValidationError(message, [{ path: ['rules', path], message }]);
};

/** The id a new rule gets: `r` and the next number after the highest one the project has (or had in this list). */
function nextId(taken: ReadonlySet<string>, highest: number): { id: string; highest: number } {
  let n = highest + 1;
  while (taken.has(`r${n}`)) n += 1;
  return { id: `r${n}`, highest: n };
}

/**
 * The rules a `PUT` asks for, checked: at most {@link ROUTING_LIMITS.maxRules}, each one clean line of at most
 * {@link ROUTING_LIMITS.maxRuleChars} characters (trimmed, inner white space folded) that holds no secret. An item with the id of a rule
 * `current` has keeps it; every other item gets a fresh id. {@link ValidationError} in plain words otherwise, and nothing is stored.
 */
export function checkRoutingRequest(request: unknown, current: readonly RoutingRule[]): RoutingRule[] {
  const parsed = SetOrchestrationRoutingRequest.safeParse(request);
  if (!parsed.success) return refuse(ORCHESTRATION_ROUTING_WORDS.badText, 'shape');
  if (parsed.data.rules.length > ROUTING_LIMITS.maxRules) return refuse(ORCHESTRATION_ROUTING_WORDS.tooMany, 'count');
  const known = new Set(current.map((rule) => rule.id));
  const used = new Set<string>();
  const taken = new Set<string>(known);
  let highest = Math.max(0, ...current.map((rule) => Number(rule.id.slice(1))));
  const out: RoutingRule[] = [];
  for (const [index, item] of parsed.data.rules.entries()) {
    const text = item.text.replace(/\s+/g, ' ').trim();
    if (text.length > ROUTING_LIMITS.maxRuleChars) return refuse(ORCHESTRATION_ROUTING_WORDS.tooLong, String(index));
    if (redactSecrets(text) !== text) return refuse(ORCHESTRATION_ROUTING_WORDS.secret, String(index));
    let id = item.id !== undefined && RoutingRuleIdSchema.safeParse(item.id).success && known.has(item.id) && !used.has(item.id) ? item.id : undefined;
    if (id === undefined) {
      const fresh = nextId(taken, highest);
      id = fresh.id;
      highest = fresh.highest;
      taken.add(id);
    }
    used.add(id);
    const rule = RoutingRuleSchema.safeParse({ id, text });
    if (!rule.success) return refuse(ORCHESTRATION_ROUTING_WORDS.badText, String(index));
    out.push(rule.data);
  }
  return out;
}

/** Whether two lists say the same, rule for rule and in order. */
export const sameRules = (a: readonly RoutingRule[], b: readonly RoutingRule[]): boolean => a.length === b.length && a.every((rule, index) => rule.id === b[index]?.id && rule.text === b[index]?.text);
