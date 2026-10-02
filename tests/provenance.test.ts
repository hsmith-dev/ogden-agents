/**
 * The provenance check's parsing and matching (story 10.8), on fixture text
 * only: no git, no real plans. CI runs the script itself on the repository
 * (job Provenance).
 */
import { describe, expect, it } from 'vitest';
import { indexProblems, parseDeferredWork, parseFrontmatter, planProblem } from '../scripts/check-provenance.mjs';

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

const deferred = (index: string[]) =>
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
  ].join('\n');

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
