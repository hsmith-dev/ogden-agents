/**
 * A minimal writer/reader for BMad Method's own ticket-file frontmatter
 * shape (epic 18 story 5), matching `_bmad/method/scripts/tickets.py`'s
 * `parse_frontmatter`/`set_frontmatter_value`/`cmd_mark` byte-for-byte
 * closely enough that a file this module writes is readable by `tickets.py`
 * directly (by a human running it, or another skill), and a field this
 * module targets for update never disturbs any other line — exactly as
 * `tickets.py`'s own `set_frontmatter_value` only ever touches the one key
 * it is told to, never rewriting an existing plan wholesale.
 *
 * `tickets-jira` never shells out to `tickets.py` (AD-27: it implements
 * `TicketStorePort` directly over Jira's REST API), but the *files* it
 * writes for a synced ticket must be the real thing: a story/bug leaf file
 * and its plan, in BMad's own on-disk shape, so a Jira-sourced ticket is
 * genuinely part of "BMad's ticket tree" (the epic's own Done-when #1),
 * not a shadow structure only Ogden can read.
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** A frontmatter scalar this module writes or reads: `tickets.py`'s own minimal YAML subset. */
export type FrontmatterScalar = string | number | boolean | readonly string[] | undefined;

/** `value` as `tickets.py`'s `quoted()` would write it: always double-quoted JSON for a string (simplest safe form), bare for number/boolean, `[...]` for a list of strings. `undefined` or `''` writes nothing (the caller skips the line). */
/** A string plain enough to write bare, matching `tickets.py`'s own unquoted fields (`status`, `type`, `ticket`, `risk`, …): letters, digits, `_`, `.`, `-` only, and not something that would round-trip as a different type (`true`/`false`, a bare integer). */
const BARE_SAFE = /^[A-Za-z0-9_.-]+$/;

function serializeScalar(value: FrontmatterScalar): string {
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${(value as readonly string[]).map((each) => JSON.stringify(each)).join(', ')}]`;
  const text = value as string;
  if (text === '') return '';
  return BARE_SAFE.test(text) && text !== 'true' && text !== 'false' && !/^-?\d+$/.test(text) ? text : JSON.stringify(text);
}

/** Builds a fresh `---\nkey: value\n...\n---\n\n` block (no body) from `fields`, in the order given, skipping any that are `undefined` or `''`. */
export function writeFrontmatterBlock(fields: ReadonlyArray<readonly [string, FrontmatterScalar]>): string {
  const lines = fields.map(([key, value]) => [key, serializeScalar(value)] as const).filter(([, value]) => value !== '');
  return `---\n${lines.map(([key, value]) => `${key}: ${value}\n`).join('')}---\n`;
}

/** Parses one scalar as `tickets.py`'s `_scalar` does: a bracketed list, a JSON-quoted or single-quoted string, `true`/`false`, a bare integer, or the bare text itself. A list's elements keep their own type (a bare `after = [1, "1.3"]` mixes a number and a string, exactly as `tickets.py`'s own parser leaves it — never force-stringified). */
function parseScalar(raw: string): string | number | boolean | (string | number | boolean)[] {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((each) => parseScalar(each.trim()) as string | number | boolean);
  }
  if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) {
    if (value[0] === '"') {
      try {
        return String(JSON.parse(value));
      } catch {
        // fall through to the bare single-quote unwrap below
      }
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

/** Every `key: value` line in `text`'s frontmatter block, parsed; `{}` when there is none. Comments (` #...` after three spaces) are stripped first, matching `tickets.py`. */
export function parseFrontmatterBlock(text: string): Record<string, string | number | boolean | (string | number | boolean)[]> {
  const match = FRONTMATTER_RE.exec(text);
  if (match === null) return {};
  const fields: Record<string, string | number | boolean | (string | number | boolean)[]> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#') || !line.includes(':')) continue;
    const splitAt = line.indexOf(':');
    const key = line.slice(0, splitAt).trim();
    const rawValue = line.slice(splitAt + 1).split('   #')[0]!.trim();
    fields[key] = parseScalar(rawValue);
  }
  return fields;
}

/** The body after the frontmatter block (everything from the line after the closing `---`), or `''` when there is no frontmatter. */
export function bodyAfterFrontmatter(text: string): string {
  const match = FRONTMATTER_RE.exec(text);
  return match === null ? text : text.slice(match[0].length);
}

/**
 * Sets one frontmatter field in `text` to `value`, touching no other line —
 * matching `tickets.py`'s `set_frontmatter_value` exactly (including its
 * rule that an empty `value` removes the line instead of writing it empty).
 * Appends the line at the end of the block when the key is not already
 * present. Throws if `text` has no frontmatter block at all.
 */
export function setFrontmatterField(text: string, key: string, value: FrontmatterScalar): string {
  const match = FRONTMATTER_RE.exec(text);
  if (match === null) throw new Error('setFrontmatterField: no frontmatter block');
  let block = match[1] ?? '';
  const serialized = serializeScalar(value);
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:.*$\\n?`, 'm');
  if (serialized === '') {
    block = block.replace(pattern, '').replace(/\n+$/, '');
  } else if (pattern.test(block)) {
    block = block.replace(pattern, `${key}: ${serialized}\n`).replace(/\n+$/, '');
  } else {
    block = `${block}\n${key}: ${serialized}`;
  }
  return text.slice(0, match.index) + '---\n' + block + '\n---\n' + text.slice(match.index + match[0].length);
}
