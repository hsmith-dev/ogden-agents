/**
 * The provenance check's parsing and matching (story 10.8), on fixture text
 * only: no git, no real plans. CI runs the script itself on the repository
 * (job Provenance). Entry 4.12: a stale index line (its phrase in a
 * `Resolved:` summary) and a Log entry added since the base with no index
 * line and no `Resolved:` quoting it both fail; with no base that rule is
 * skipped.
 */
import { describe, expect, it } from 'vitest';
import { baseCandidate, indexProblems, parseDeferredWork, parseFrontmatter, planProblem, staleIndexProblems, unindexedProblems } from '../scripts/check-provenance.mjs';

const plan = (fields: string) => `---\ntitle: 'A story'\n${fields}\n---\n\n# A story\n\nstatus: built (not frontmatter)\n`;
const ANCESTOR = 'a3425187ece0e84d0fb1f094e49971edc13605bb';
const isAncestor = (revision: string) => revision === ANCESTOR || revision === 'a342518';

describe('plan baselines', () => {
  it('reads quoted and bare frontmatter values, and nothing after the frontmatter', () => {
    expect(parseFrontmatter(plan(`status: 'built'\nbaseline_revision: "${ANCESTOR}"\nticket: 5`))).toEqual({
      title: 'A story',
      status: 'built',
      baseline_revision: ANCESTOR,
      ticket: '5',
    });
    expect(parseFrontmatter('# No frontmatter\nstatus: built\n')).toEqual({});
  });

  it('a started plan needs a baseline that is an ancestor of HEAD; short SHAs count', () => {
    for (const status of ['in-progress', 'in-review', 'built', 'done']) {
      expect(planProblem(plan(`status: '${status}'\nbaseline_revision: '${ANCESTOR}'`), isAncestor), status).toBeUndefined();
      expect(planProblem(plan(`status: '${status}'`), isAncestor), status).toBe(`status ${status} but no baseline_revision`);
      expect(planProblem(plan(`status: '${status}'\nbaseline_revision: ''`), isAncestor), status).toBe(`status ${status} but no baseline_revision`);
      expect(planProblem(plan(`status: ${status}\nbaseline_revision: 'c4d9235'`), isAncestor), status).toBe('baseline_revision c4d9235 is not an ancestor of HEAD');
    }
    expect(planProblem(plan(`status: built\nbaseline_revision: a342518`), isAncestor)).toBeUndefined();
  });

  it('draft and ready-for-dev plans, and files with no status, are exempt', () => {
    for (const status of ['draft', 'ready-for-dev']) expect(planProblem(plan(`status: '${status}'`), isAncestor), status).toBeUndefined();
    expect(planProblem(plan(`route: 'full'`), isAncestor)).toBeUndefined();
  });
});

const deferred = (index: string[], log: string[] = []) =>
  [
    '# Deferred work',
    '',
    '## Open items',
    '',
    'Each index line ends `(log: "<phrase>")`.',
    '',
    ...index,
    '',
    'Closed in code with no "Resolved:" entry: a note, not an item.',
    '',
    '## Log',
    '',
    '- source_plan: `a-plan.md`',
    '  summary: Removing a project must delete its always-allow rules first (remove-project story).',
    '  evidence: `permission_rules` has no `ON DELETE`.',
    '- source_plan: none',
    '  summary: The plan\'s step 6 says "Sign in, then Try again resends".',
    '  evidence: the phrase "Only in evidence" is not a summary.',
    ...log,
  ].join('\n');

/** A Log entry with `summary`. */
const entry = (summary: string) => ['- source_plan: `b-plan.md`', `  summary: ${summary}`, '  evidence: here.'];

describe('the deferred-work index', () => {
  it('reads the index lines between Open items and Log, and every Log summary', () => {
    const { index, summaries } = parseDeferredWork(deferred(['- One (log: "x")', '- Two (log: "y")']));
    expect(index).toEqual(['- One (log: "x")', '- Two (log: "y")']);
    expect(summaries).toEqual(['Removing a project must delete its always-allow rules first (remove-project story).', 'The plan\'s step 6 says "Sign in, then Try again resends".']);
  });

  it('passes a line whose phrase is verbatim in a summary, quotes and backticks included', () => {
    expect(
      indexProblems(
        deferred([
          '- Remove-project story: delete its rules first. From 2.6 F9. (log: "Removing a project must delete its always-allow rules first")',
          '- The step 6 note. (log: "says "Sign in, then Try again resends"")',
        ]),
      ),
    ).toEqual([]);
  });

  it('fails a line with no phrase, a phrase found nowhere, a phrase only in evidence, or text after the phrase', () => {
    const lines = [
      '- No phrase at all. From 9.2.',
      '- Wrong phrase. (log: "Removing a project must remove")',
      '- Evidence only. (log: "Only in evidence")',
      '- Trailing period. (log: "Removing a project").',
    ];
    expect(indexProblems(deferred(lines))).toEqual([
      `no (log: "…") phrase: ${lines[0]}`,
      `its log phrase is in no Log entry's summary: ${lines[1]}`,
      `its log phrase is in no Log entry's summary: ${lines[2]}`,
      `no (log: "…") phrase: ${lines[3]}`,
    ]);
  });
});

describe('stale index lines and unindexed new entries (entry 4.12)', () => {
  const RULES = '- Remove-project story: delete its rules first. (log: "Removing a project must delete its always-allow rules first")';
  const STEP6 = '- The step 6 note. (log: "says "Sign in, then Try again resends"")';

  it('a line whose phrase a Resolved: summary contains is stale; a partial Resolved (…) is not', () => {
    const closer = entry('Resolved: "Removing a project must delete its always-allow rules first" (the remove-project story).');
    expect(staleIndexProblems(deferred([RULES, STEP6], closer))).toEqual([`it names an entry a Resolved summary closes: ${RULES}`]);
    const partial = entry('Resolved (part 1): Removing a project must delete its always-allow rules first; the rest stays open (index).');
    expect(staleIndexProblems(deferred([RULES, STEP6], partial))).toEqual([]);
    expect(staleIndexProblems(deferred([RULES, STEP6]))).toEqual([]);
  });

  it('an entry added since the base needs an index line, or a Resolved: summary quoting it', () => {
    const base = deferred([RULES, STEP6]);
    const added = entry('A new gap: the board forgets its scroll position on reload.');
    // Unindexed: fails, naming the entry.
    expect(unindexedProblems(deferred([RULES, STEP6], added), base)).toEqual([
      'a Log entry added on this branch has no Open items line and no Resolved entry: A new gap: the board forgets its scroll position on reload.',
    ]);
    // Indexed: passes.
    expect(unindexedProblems(deferred([RULES, STEP6, '- Board scroll. (log: "the board forgets its scroll position")'], added), base)).toEqual([]);
    // Closed by a Resolved: summary that quotes it: passes; a too-short quote or a partial Resolved does not close it.
    expect(unindexedProblems(deferred([RULES, STEP6], [...added, ...entry('Resolved: "the board forgets its scroll position" (fixed).')]), base)).toEqual([]);
    expect(unindexedProblems(deferred([RULES, STEP6], [...added, ...entry('Resolved: "the board" (fixed).')]), base)).toHaveLength(1);
    expect(unindexedProblems(deferred([RULES, STEP6], [...added, ...entry('Resolved (part): "the board forgets its scroll position".')]), base)).toHaveLength(2);
    // A Resolved: entry needs no index line itself; entries already in the base are not checked.
    expect(unindexedProblems(deferred([RULES, STEP6], entry('Resolved: something closed.')), base)).toEqual([]);
    expect(unindexedProblems(deferred([RULES, STEP6], added), deferred([], added))).toEqual([]);
    // A base with no deferred-work.md: every unindexed entry is new (the step 6 one has its line).
    expect(unindexedProblems(deferred([RULES, STEP6]), '')).toEqual([]);
    expect(unindexedProblems(deferred([RULES]), '')).toHaveLength(1);
  });

  it('the base: PROVENANCE_BASE, else origin/$GITHUB_BASE_REF; none otherwise (main falls back to the upstream, or skips the rule)', () => {
    expect(baseCandidate({ PROVENANCE_BASE: 'abc1234', GITHUB_BASE_REF: 'main' })).toEqual({ revision: 'abc1234', from: 'PROVENANCE_BASE' });
    expect(baseCandidate({ GITHUB_BASE_REF: 'story/4.11-reduced-mode' })).toEqual({ revision: 'origin/story/4.11-reduced-mode', from: 'GITHUB_BASE_REF' });
    expect(baseCandidate({ PROVENANCE_BASE: '', GITHUB_BASE_REF: '' })).toBeUndefined();
    expect(baseCandidate({})).toBeUndefined();
  });
});
