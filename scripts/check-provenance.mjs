#!/usr/bin/env node
/**
 * The planning provenance check (story 10.8; epic 3 retro A5), run in CI:
 *
 * - every story plan (`_bmad-output/**\/*-plan.md`) whose status is
 *   in-progress, in-review, built or done names a `baseline_revision` that
 *   is an ancestor of HEAD (draft and ready-for-dev plans are exempt), so a
 *   restack or rebase can't leave a plan citing a commit no branch has;
 * - every Open items line in `deferred-work.md` ends `(log: "<phrase>")`,
 *   and that phrase appears verbatim in a Log entry's summary, so the index
 *   never names an entry the log doesn't have.
 *
 *   node scripts/check-provenance.mjs
 *
 * Exits 0 when both hold, 1 otherwise (listing each problem). Needs the full
 * history (`fetch-depth: 0` in CI). The parsing and matching are pure and
 * exported for `tests/provenance.test.ts`; only `main` runs git.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLANNING = join(ROOT, '_bmad-output');
const DEFERRED_WORK = join(PLANNING, 'initiative-ogden-agents', 'deferred-work.md');

/** Plan statuses that mean the build started, so the baseline must exist. */
export const BASELINE_STATUSES = new Set(['in-progress', 'in-review', 'built', 'done']);

/**
 * The top-level `key: value` pairs of a Markdown file's YAML frontmatter,
 * quotes removed; `{}` without one. Only plain scalars are read.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (match === null) return {};
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (pair === null) continue;
    const [, key = '', raw = ''] = pair;
    let value = raw.trim();
    if (value.length >= 2 && (value[0] === "'" || value[0] === '"') && value.at(-1) === value[0]) value = value.slice(1, -1);
    fields[key] = value;
  }
  return fields;
}

/**
 * What is wrong with one plan's baseline, or `undefined`.
 * @param {string} text the plan
 * @param {(revision: string) => boolean} isAncestor whether `revision` is an ancestor of HEAD
 * @returns {string | undefined}
 */
export function planProblem(text, isAncestor) {
  const { status = '', baseline_revision: baseline = '' } = parseFrontmatter(text);
  if (!BASELINE_STATUSES.has(status)) return undefined;
  if (baseline === '') return `status ${status} but no baseline_revision`;
  if (!isAncestor(baseline)) return `baseline_revision ${baseline} is not an ancestor of HEAD`;
  return undefined;
}

/**
 * The Open items index lines and the Log entries' summaries of `deferred-work.md`.
 * @param {string} text
 * @returns {{ index: string[], summaries: string[] }}
 */
export function parseDeferredWork(text) {
  const lines = text.split(/\r?\n/);
  const open = lines.findIndex((line) => line === '## Open items');
  const log = lines.findIndex((line) => line === '## Log');
  const index = open === -1 ? [] : lines.slice(open + 1, log === -1 ? undefined : log).filter((line) => line.startsWith('- '));
  const summaries = (log === -1 ? [] : lines.slice(log + 1)).flatMap((line) => {
    const summary = /^\s+summary:\s?(.*)$/.exec(line);
    return summary === null ? [] : [summary[1] ?? ''];
  });
  return { index, summaries };
}

/** An index line's `(log: "…")` phrase, at its end. */
const LOG_PHRASE = /\(log: "(.+)"\)$/;

/**
 * Each Open items line whose `(log: "…")` phrase is missing or found in no
 * Log entry's summary, with why.
 * @param {string} text the whole `deferred-work.md`
 * @returns {string[]}
 */
export function indexProblems(text) {
  const { index, summaries } = parseDeferredWork(text);
  /** @type {string[]} */
  const problems = [];
  for (const line of index) {
    const phrase = LOG_PHRASE.exec(line.trimEnd())?.[1];
    if (phrase === undefined) problems.push(`no (log: "…") phrase: ${line}`);
    else if (!summaries.some((summary) => summary.includes(phrase))) problems.push(`its log phrase is in no Log entry's summary: ${line}`);
  }
  return problems;
}

/**
 * Every `*-plan.md` under `dir`.
 * @param {string} dir
 * @returns {string[]}
 */
function planFiles(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...planFiles(path));
    else if (entry.name.endsWith('-plan.md')) found.push(path);
  }
  return found;
}

/**
 * Whether `revision` names a commit that is an ancestor of HEAD (HEAD itself included).
 * @param {string} revision
 */
function isAncestorOfHead(revision) {
  // A revision that looks like an option is never passed to git.
  if (!/^[0-9a-f]{4,40}$/i.test(revision)) return false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', revision, 'HEAD'], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  /** @type {string[]} */
  const problems = [];
  const plans = planFiles(PLANNING).sort();
  for (const plan of plans) {
    const problem = planProblem(readFileSync(plan, 'utf8'), isAncestorOfHead);
    if (problem !== undefined) problems.push(`${relative(ROOT, plan).split(sep).join('/')}: ${problem}`);
  }
  problems.push(...indexProblems(readFileSync(DEFERRED_WORK, 'utf8')).map((problem) => `deferred-work.md: ${problem}`));
  if (problems.length > 0) {
    console.error(`check-provenance: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`check-provenance: ${plans.length} plans and the deferred-work index check out.`);
}

/** True when this file is the script node was started with (not imported by a test). */
function isMain() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const started = resolve(process.argv[1]);
  // Windows paths may differ only in drive-letter or other casing.
  return process.platform === 'win32' ? self.toLowerCase() === started.toLowerCase() : self === started;
}

if (isMain()) main();
