/**
 * A small JSON Schema checker for a model's structured answer (epic 14 story
 * 14.8): Ogden validates the answer itself, because a server's constraint is
 * a help and not a guarantee. It reads the subset a manager's plan needs:
 * `type` (one or several, with `null`), `enum`, `const`, `properties`,
 * `required`, `additionalProperties: false`, `items`, `minItems`, `maxItems`,
 * `minLength`, `maxLength`, `minimum` and `maximum`. A schema that uses any
 * other rule is refused up front ({@link unsupportedRule}), so an off shape
 * answer never passes for a rule that wasn't checked.
 *
 * Own keys only (`Object.hasOwn`): a model's `__proto__` or `constructor` key
 * never counts as present. A problem names its path and the rule, never a
 * value; a key from the answer is shortened and cleaned before it is named.
 * At most {@link MAX_PROBLEMS} problems are collected.
 */

const MAX_DEPTH = 24;
export const MAX_PROBLEMS = 20;

/** The rules a schema may use. Anything else (`anyOf`, `$ref`, `pattern`, `format`…) is not checked, so it is refused. */
const SUPPORTED = new Set(['type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'description', 'title', 'default', 'examples', '$schema', '$id']);

/** The first rule in `schema` that Ogden can't check, or `undefined`; a schema nested deeper than the checker reads is refused too. */
export function unsupportedRule(schema: unknown, depth = 0): string | undefined {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return undefined;
  if (depth > MAX_DEPTH) return 'nested too deeply';
  const s = schema as Record<string, unknown>;
  for (const key of Object.keys(s)) if (!SUPPORTED.has(key)) return key;
  if (s.additionalProperties !== undefined && s.additionalProperties !== false && s.additionalProperties !== true) return 'additionalProperties';
  if (typeof s.properties === 'object' && s.properties !== null) {
    for (const sub of Object.values(s.properties as Record<string, unknown>)) {
      const found = unsupportedRule(sub, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return unsupportedRule(s.items, depth + 1);
}

const typeOf = (value: unknown): string => (value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value);

const isType = (value: unknown, wanted: string): boolean => {
  const actual = typeOf(value);
  if (wanted === 'number') return actual === 'integer' || actual === 'number';
  return actual === wanted;
};

/** JSON with object keys in order, so two equal values compare equal whatever their key order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** A key from a model's answer as it may be named in a problem: short, printable. */
const named = (key: string): string => (key.length > 40 ? `${key.slice(0, 40)}...` : key).replace(/[^\x20-\x7e]/g, '?');

/** Every problem `value` has against `schema` (at most {@link MAX_PROBLEMS}); `[]` when it fits. */
export function schemaProblems(value: unknown, schema: unknown, path = '$', depth = 0, out: string[] = []): string[] {
  const add = (problem: string) => {
    if (out.length < MAX_PROBLEMS) out.push(problem);
  };
  if (typeof schema !== 'object' || schema === null || out.length >= MAX_PROBLEMS) return out;
  if (depth > MAX_DEPTH) {
    add(`${path}: nested too deeply to check`);
    return out;
  }
  const s = schema as Record<string, unknown>;
  const types = typeof s.type === 'string' ? [s.type] : Array.isArray(s.type) ? s.type.filter((each): each is string => typeof each === 'string') : [];
  if (types.length > 0 && !types.some((wanted) => isType(value, wanted))) {
    add(`${path}: not ${types.join(' or ')}`);
    return out;
  }
  if (Array.isArray(s.enum) && !s.enum.some((each) => stable(each) === stable(value))) add(`${path}: not one of the allowed values`);
  if (Object.hasOwn(s, 'const') && stable(s.const) !== stable(value)) add(`${path}: not the required value`);
  if (typeof value === 'string') {
    if (typeof s.minLength === 'number' && value.length < s.minLength) add(`${path}: too short`);
    if (typeof s.maxLength === 'number' && value.length > s.maxLength) add(`${path}: too long`);
  }
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) add(`${path}: too small`);
    if (typeof s.maximum === 'number' && value > s.maximum) add(`${path}: too large`);
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) add(`${path}: too few items`);
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) add(`${path}: too many items`);
    if (s.items !== undefined) for (let index = 0; index < value.length && out.length < MAX_PROBLEMS; index++) schemaProblems(value[index], s.items, `${path}[${index}]`, depth + 1, out);
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties = typeof s.properties === 'object' && s.properties !== null ? (s.properties as Record<string, unknown>) : {};
    for (const key of Array.isArray(s.required) ? s.required : []) if (typeof key === 'string' && !Object.hasOwn(record, key)) add(`${path}.${named(key)}: missing`);
    if (s.additionalProperties === false) for (const key of Object.keys(record)) if (!Object.hasOwn(properties, key)) add(`${path}.${named(key)}: not allowed`);
    for (const [key, sub] of Object.entries(properties)) if (Object.hasOwn(record, key)) schemaProblems(record[key], sub, `${path}.${named(key)}`, depth + 1, out);
  }
  return out;
}

const THINK = /<think>[\s\S]*?<\/think>/g;

/** Tries `text` as JSON; `undefined` when it isn't. */
function tryParse(text: string): { json: unknown } | undefined {
  const body = text.trim();
  if (body === '') return undefined;
  try {
    return { json: JSON.parse(body) as unknown };
  } catch {
    return undefined;
  }
}

/**
 * The JSON in a model's text: the whole text, else the first fenced block, else the
 * first object or array that parses (after prose, or a reasoning block, which is dropped).
 * `undefined` when there is none. No backtracking patterns: every scan is linear.
 */
export function parseModelJson(text: string): { json: unknown } | undefined {
  const clean = text.replace(THINK, '');
  const whole = tryParse(clean);
  if (whole !== undefined) return whole;
  const open = clean.indexOf('```');
  if (open !== -1) {
    const close = clean.indexOf('```', open + 3);
    if (close !== -1) {
      let inner = clean.slice(open + 3, close);
      if (/^json\b/i.test(inner)) inner = inner.slice(4);
      const fenced = tryParse(inner);
      if (fenced !== undefined) return fenced;
    }
  }
  // JSON after prose: from the first brace or bracket to the last matching one.
  for (const [start, end] of [['{', '}'], ['[', ']']] as const) {
    const from = clean.indexOf(start);
    const to = clean.lastIndexOf(end);
    if (from !== -1 && to > from) {
      const found = tryParse(clean.slice(from, to + 1));
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
