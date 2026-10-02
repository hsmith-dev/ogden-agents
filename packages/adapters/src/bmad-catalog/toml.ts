/**
 * A lenient reader for the TOML subset BMad Method's module records use
 * (story 4.4): `bmod.toml`'s `[bmod]` and `roster.toml`'s `[[members]]`.
 * No dependency: the catalog only needs tables, arrays of tables, and keys
 * whose value is a string or an array of strings.
 *
 * Read: `[table]` and `[[array]]` headers (bare or quoted names, dotted
 * names kept as written), and `key = value` where the key is bare or quoted
 * and the value is a basic (`"…"`, with TOML's escapes) or literal (`'…'`)
 * one-line string, or an array of such strings (over several lines, with
 * comments and a trailing comma). Anything else (inline tables, numbers,
 * booleans, dates, nested or mixed arrays, multi-line strings, a value
 * followed by more than a comment) is skipped without losing the place, so
 * the keys after it still read, and its key answers {@link TOML_UNREADABLE}
 * (so a caller can tell a key that is there but unreadable from a missing one); a dotted key
 * is skipped entirely. A
 * repeated key or `[table]` keeps the first value. Never throws.
 */

/** The value of a key that is there but this reader doesn't keep (a number, an inline table, a mixed array…). */
export const TOML_UNREADABLE: unique symbol = Symbol('toml unreadable');

/** A value this reader keeps, or {@link TOML_UNREADABLE} for a key whose value it doesn't. */
export type TomlValue = string | readonly string[] | typeof TOML_UNREADABLE;

/** One table's keys and values. */
export type TomlTable = ReadonlyMap<string, TomlValue>;

/** A read document. */
export interface TomlDocument {
  /** `[name]` tables by name; the keys before the first header are under `''`. */
  readonly tables: ReadonlyMap<string, TomlTable>;
  /** `[[name]]` arrays of tables by name, in order. */
  readonly arrays: ReadonlyMap<string, readonly TomlTable[]>;
}

const BARE_KEY = /[A-Za-z0-9_-]/;
const SKIPPED = Symbol('skipped');

/** Reads `text` (see the file's comment). */
export function readToml(text: string): TomlDocument {
  const tables = new Map<string, Map<string, TomlValue>>();
  const arrays = new Map<string, Map<string, TomlValue>[]>();
  const root = new Map<string, TomlValue>();
  tables.set('', root);
  try {
    readInto(typeof text === 'string' ? text.replace(/^﻿/, '') : '', tables, arrays, root);
  } catch {
    // Never throws: what was read before the failure is kept.
  }
  return { tables, arrays };
}

function readInto(src: string, tables: Map<string, Map<string, TomlValue>>, arrays: Map<string, Map<string, TomlValue>[]>, root: Map<string, TomlValue>): void {
  /** Where the keys go now; `undefined` after a header that couldn't be read or a repeated `[table]`. */
  let current: Map<string, TomlValue> | undefined = root;
  let pos = 0;
  const lineEnd = (from: number) => {
    const end = src.indexOf('\n', from);
    return end === -1 ? src.length : end;
  };
  /** Whether only spaces and a comment are left on the line from `from`. */
  const restIsBlank = (from: number) => /^[ \t]*(?:#.*)?\r?$/.test(src.slice(from, lineEnd(from)));

  while (pos < src.length) {
    pos = skipSpace(src, pos, true);
    if (pos >= src.length) break;
    const end = lineEnd(pos);
    if (src[pos] === '[') {
      const header = /^(\[\[?)[ \t]*((?:[A-Za-z0-9_-]+|"[^"\\\n]*"|'[^'\n]*')(?:[ \t]*\.[ \t]*(?:[A-Za-z0-9_-]+|"[^"\\\n]*"|'[^'\n]*'))*)[ \t]*(\]\]?)[ \t]*(?:#.*)?\r?$/.exec(src.slice(pos, end));
      current = undefined;
      if (header !== null && header[1]!.length === header[3]!.length) {
        // The parts, in order (the regex above checked they are separated by dots), without their quotes.
        const name = [...header[2]!.matchAll(/[A-Za-z0-9_-]+|"([^"\\\n]*)"|'([^'\n]*)'/g)].map((part) => part[1] ?? part[2] ?? part[0]).join('.');
        if (header[1] === '[[') {
          const table = new Map<string, TomlValue>();
          const list = arrays.get(name) ?? [];
          list.push(table);
          arrays.set(name, list);
          current = table;
        } else if (!tables.has(name)) {
          current = new Map<string, TomlValue>();
          tables.set(name, current);
        }
      }
      pos = end;
      continue;
    }
    const key = readKey(src, pos);
    if (key === undefined) {
      pos = end;
      continue;
    }
    pos = skipSpace(src, key.end, false);
    if (src[pos] !== '=') {
      pos = end;
      continue;
    }
    pos = skipSpace(src, pos + 1, false);
    const value = readValue(src, pos);
    pos = value.end;
    if (key.name !== undefined && current !== undefined && !current.has(key.name)) {
      current.set(key.name, value.value !== SKIPPED && restIsBlank(pos) ? value.value : TOML_UNREADABLE);
    }
    pos = lineEnd(pos);
  }
}

/** Skips spaces and tabs (and newlines and comments when `lines`). */
function skipSpace(src: string, pos: number, lines: boolean): number {
  while (pos < src.length) {
    const char = src[pos]!;
    if (char === ' ' || char === '\t') pos++;
    else if (lines && (char === '\n' || char === '\r')) pos++;
    else if (lines && char === '#') {
      const end = src.indexOf('\n', pos);
      pos = end === -1 ? src.length : end;
    } else break;
  }
  return pos;
}

/** A key at `pos`: its name (`undefined` for a dotted key, which is skipped) and where it ends. */
function readKey(src: string, pos: number): { name: string | undefined; end: number } | undefined {
  let name: string;
  let end: number;
  if (src[pos] === '"' || src[pos] === "'") {
    const quoted = readString(src, pos);
    if (quoted === undefined) return undefined;
    name = quoted.value;
    end = quoted.end;
  } else {
    end = pos;
    while (end < src.length && BARE_KEY.test(src[end]!)) end++;
    if (end === pos) return undefined;
    name = src.slice(pos, end);
  }
  const after = skipSpace(src, end, false);
  if (src[after] === '.') {
    // A dotted key: skipped whole, up to its `=` (its value is read and dropped).
    const equals = src.indexOf('=', after);
    const newline = src.indexOf('\n', after);
    return equals === -1 || (newline !== -1 && newline < equals) ? undefined : { name: undefined, end: equals };
  }
  return { name, end };
}

/** A one-line basic or literal string at `pos`; `undefined` when it isn't one (a multi-line one included). */
function readString(src: string, pos: number): { value: string; end: number } | undefined {
  const quote = src[pos];
  if (quote !== '"' && quote !== "'") return undefined;
  if (src.startsWith(quote.repeat(3), pos)) return undefined;
  let value = '';
  let index = pos + 1;
  while (index < src.length) {
    const char = src[index]!;
    if (char === '\n') return undefined;
    if (char === quote) return { value, end: index + 1 };
    if (quote === '"' && char === '\\') {
      const escape = src[index + 1];
      const simple: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\u001b', '"': '"', '\\': '\\' };
      if (escape !== undefined && Object.hasOwn(simple, escape)) {
        value += simple[escape];
        index += 2;
        continue;
      }
      const digits = escape === 'u' ? 4 : escape === 'U' ? 8 : 0;
      const hex = src.slice(index + 2, index + 2 + digits);
      if (digits === 0 || !new RegExp(`^[0-9A-Fa-f]{${digits}}$`).test(hex)) return undefined;
      const code = Number.parseInt(hex, 16);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return undefined;
      value += String.fromCodePoint(code);
      index += 2 + digits;
      continue;
    }
    value += char;
    index++;
  }
  return undefined;
}

/** The value at `pos` and where it ends; {@link SKIPPED} for a value this reader doesn't keep (still skipped whole). */
function readValue(src: string, pos: number): { value: TomlValue | typeof SKIPPED; end: number } {
  const char = src[pos];
  if (char === '"' || char === "'") {
    if (src.startsWith(char.repeat(3), pos)) {
      const close = src.indexOf(char.repeat(3), pos + 3);
      return { value: SKIPPED, end: close === -1 ? src.length : close + 3 };
    }
    const read = readString(src, pos);
    return read === undefined ? { value: SKIPPED, end: pos } : read;
  }
  if (char === '[') {
    const items: string[] = [];
    let index = pos + 1;
    for (;;) {
      index = skipSpace(src, index, true);
      if (src[index] === ']') return { value: items, end: index + 1 };
      const item = readString(src, index);
      if (item === undefined) return { value: SKIPPED, end: skipBalanced(src, pos) };
      items.push(item.value);
      index = skipSpace(src, item.end, true);
      if (src[index] === ',') index++;
      else if (src[index] !== ']') return { value: SKIPPED, end: skipBalanced(src, pos) };
    }
  }
  if (char === '{') return { value: SKIPPED, end: skipBalanced(src, pos) };
  // A number, boolean or date (or something malformed): the rest of the line.
  return { value: SKIPPED, end: pos };
}

/** The end of the bracketed value (`[…]` or `{…}`) at `pos`, past nested brackets, strings and comments; the text's end when unclosed. */
function skipBalanced(src: string, pos: number): number {
  let depth = 0;
  let index = pos;
  while (index < src.length) {
    const char = src[index]!;
    if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') {
      depth--;
      if (depth === 0) return index + 1;
    } else if (char === '#') {
      const end = src.indexOf('\n', index);
      index = end === -1 ? src.length : end;
      continue;
    } else if (char === '"' || char === "'") {
      const triple = char.repeat(3);
      if (src.startsWith(triple, index)) {
        const close = src.indexOf(triple, index + 3);
        index = close === -1 ? src.length : close + 3;
        continue;
      }
      // A one-line string: to its closing quote (past escapes in a basic one), or the line's end.
      index++;
      while (index < src.length && src[index] !== char && src[index] !== '\n') index += char === '"' && src[index] === '\\' ? 2 : 1;
    }
    index++;
  }
  return src.length;
}
