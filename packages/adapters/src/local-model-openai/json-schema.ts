/**
 * A small JSON Schema checker for a model's structured answer (epic 14 story
 * 14.8): Ogden validates the answer itself, because a server's constraint is
 * a help and not a guarantee. It reads the subset a manager's plan needs:
 * `type` (one or several, with `null`), `enum`, `const`, `properties`,
 * `required`, `additionalProperties: false`, `items`, `minItems`, `maxItems`,
 * `minLength`, `maxLength`, `minimum` and `maximum`. Any other keyword is
 * ignored. A problem names its path and the rule, never the value.
 */

const MAX_DEPTH = 24;

const typeOf = (value: unknown): string => (value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value);

const isType = (value: unknown, wanted: string): boolean => {
  const actual = typeOf(value);
  if (wanted === 'number') return actual === 'integer' || actual === 'number';
  return actual === wanted;
};

/** Every problem `value` has against `schema`; `[]` when it fits. */
export function schemaProblems(value: unknown, schema: unknown, path = '$', depth = 0): string[] {
  if (typeof schema !== 'object' || schema === null || depth > MAX_DEPTH) return [];
  const s = schema as Record<string, unknown>;
  const out: string[] = [];
  const types = typeof s.type === 'string' ? [s.type] : Array.isArray(s.type) ? s.type.filter((each): each is string => typeof each === 'string') : [];
  if (types.length > 0 && !types.some((wanted) => isType(value, wanted))) return [`${path}: not ${types.join(' or ')}`];
  if (Array.isArray(s.enum) && !s.enum.some((each) => JSON.stringify(each) === JSON.stringify(value))) out.push(`${path}: not one of the allowed values`);
  if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(value)) out.push(`${path}: not the required value`);
  if (typeof value === 'string') {
    if (typeof s.minLength === 'number' && value.length < s.minLength) out.push(`${path}: too short`);
    if (typeof s.maxLength === 'number' && value.length > s.maxLength) out.push(`${path}: too long`);
  }
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) out.push(`${path}: too small`);
    if (typeof s.maximum === 'number' && value > s.maximum) out.push(`${path}: too large`);
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) out.push(`${path}: too few items`);
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) out.push(`${path}: too many items`);
    if (s.items !== undefined) value.forEach((item, index) => out.push(...schemaProblems(item, s.items, `${path}[${index}]`, depth + 1)));
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties = typeof s.properties === 'object' && s.properties !== null ? (s.properties as Record<string, unknown>) : {};
    for (const key of Array.isArray(s.required) ? s.required : []) if (typeof key === 'string' && !(key in record)) out.push(`${path}.${key}: missing`);
    if (s.additionalProperties === false) for (const key of Object.keys(record)) if (!(key in properties)) out.push(`${path}.${key}: not allowed`);
    for (const [key, sub] of Object.entries(properties)) if (key in record) out.push(...schemaProblems(record[key], sub, `${path}.${key}`, depth + 1));
  }
  return out;
}

/**
 * The JSON in a model's text: the whole text, or the first fenced block when it wrapped its answer
 * in one. `undefined` when it isn't JSON.
 */
export function parseModelJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced === null ? text : fenced[1]!).trim();
  if (body === '') return undefined;
  try {
    return { json: JSON.parse(body) as unknown };
  } catch {
    return undefined;
  }
}
