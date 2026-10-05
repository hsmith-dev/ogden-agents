/**
 * Epic 7's contract (stories 7.1 and 7.2): the look-back's names and copy,
 * the retrospective on an epic row, the build summary a look-back is given,
 * the finished-epic offer, the next-step and Save the lessons shapes, the
 * catalog's epic scope and further next steps, the two new events, and the
 * dependency rule (Retrospectives needs Board).
 */
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  API_ROUTES,
  BMAD_PIECE_INFO,
  CatalogSkill,
  CoreEvent,
  EPIC_SLUG_PATTERN,
  EpicBuildSummary,
  EpicRetrospective,
  LESSONS_CHECKOUT_BUSY_MESSAGE,
  LOOK_BACK_OFFER_TEXT,
  LOOK_BACK_UNFINISHED_NOTE,
  LookBackOffersResponse,
  NOTHING_TO_SAVE_MESSAGE,
  RETROSPECTIVE_VERDICT_LABELS,
  RETROSPECTIVE_VERDICTS,
  SaveLessonsResponse,
  StartRetrospectiveStepRequest,
  TicketEpic,
  TicketsResponse,
  bmadPieceNeeds,
  bmadPiecesProblem,
} from '../src/index.js';

const at = '2026-10-05T12:00:00.000Z';
const assigned = { id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W3', seq: 9, at };
const onWorkspace = { workspaceId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', streamId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' };

describe('the look-back contract', () => {
  it('names epics as one plain folder name', () => {
    for (const good of ['epic-first', 'a', 'epic.1_x']) expect(EPIC_SLUG_PATTERN.test(good), good).toBe(true);
    for (const bad of ['', '-x', '.x', '../x', 'a/b', 'a b', 'a'.repeat(129), 'x\n']) expect(EPIC_SLUG_PATTERN.test(bad), JSON.stringify(bad)).toBe(false);
  });

  it('keeps the verdicts and their plain words', () => {
    expect(RETROSPECTIVE_VERDICTS).toEqual(['accepted', 'accepted-with-open-items', 'rejected']);
    expect(RETROSPECTIVE_VERDICT_LABELS).toEqual({ accepted: 'Accepted', 'accepted-with-open-items': 'Accepted with open items', rejected: 'Not accepted' });
  });

  it('an epic row has no retrospective by default, and carries one with its verdict, date and path, or a problem line', () => {
    const base = { slug: 'epic-a', id: 1, status: 'done', after: [], blocks: [] };
    expect(TicketEpic.parse(base).retrospective).toBeNull();
    const read = { path: '_bmad-output/i/epic-a/epic-a-retrospective.md', verdict: 'accepted', date: '2026-10-05T12:00:00-0600' };
    expect(TicketEpic.parse({ ...base, retrospective: read }).retrospective).toEqual({ ...read, problem: null });
    expect(EpicRetrospective.parse({ path: 'x.md', verdict: null, date: null, problem: 'No verdict.' }).verdict).toBeNull();
    expect(EpicRetrospective.safeParse({ path: 'x.md', verdict: 'great', date: null }).success).toBe(false);
    expect(TicketsResponse.parse({ tickets: [], problems: [], epics: [base] }).epics[0]!.retrospective).toBeNull();
  });

  it('a build summary has outcome, verification, blocked reason, duration and decision, and nowhere to put a transcript', () => {
    const summary = { ticketRef: '1.1', outcome: 'blocked', verification: 'not_checked', blockedReason: 'The plan was not ready.', durationSeconds: 125, decision: null };
    expect(EpicBuildSummary.parse(summary)).toEqual(summary);
    expect(Object.keys(EpicBuildSummary.shape).sort()).toEqual(['blockedReason', 'decision', 'durationSeconds', 'outcome', 'ticketRef', 'verification']);
    expect(EpicBuildSummary.safeParse({ ...summary, outcome: 'running' }).success).toBe(false);
    expect(EpicBuildSummary.safeParse({ ...summary, durationSeconds: -1 }).success).toBe(false);
  });

  it('the offer, the next step and Save the lessons shapes', () => {
    expect(LookBackOffersResponse.parse({ dismissed: ['epic-a'] })).toEqual({ dismissed: ['epic-a'] });
    expect(LookBackOffersResponse.safeParse({ dismissed: ['../x'] }).success).toBe(false);
    expect(StartRetrospectiveStepRequest.parse({ skill: 'bmad-project-context' })).toEqual({ skill: 'bmad-project-context' });
    expect(StartRetrospectiveStepRequest.safeParse({ skill: '../x' }).success).toBe(false);
    const saved = { paths: ['AGENTS.md', 'a/b-retrospective.md'], revision: 'a'.repeat(40) };
    expect(SaveLessonsResponse.parse(saved)).toEqual(saved);
    expect(SaveLessonsResponse.safeParse({ paths: [], revision: 'a'.repeat(40) }).success).toBe(false);
    expect(SaveLessonsResponse.safeParse({ paths: ['AGENTS.md', 'b', 'c'], revision: 'a'.repeat(40) }).success).toBe(false);
  });

  it('the codes are API error codes and every user-facing line holds no em or en dash', () => {
    for (const code of ['nothing_to_save', 'checkout_busy', 'agents_file_missing']) expect(API_ERROR_CODES, code).toContain(code);
    for (const text of [LOOK_BACK_OFFER_TEXT, LOOK_BACK_UNFINISHED_NOTE, NOTHING_TO_SAVE_MESSAGE, LESSONS_CHECKOUT_BUSY_MESSAGE]) expect(text).not.toMatch(/[–—]/);
  });

  it('the routes live inside a workspace', () => {
    for (const route of [API_ROUTES.workspaceEpicLookBack, API_ROUTES.workspaceLookBackOffers, API_ROUTES.workspaceEpicLookBackOffer, API_ROUTES.workspaceRetrospectiveSessions, API_ROUTES.workspaceRetrospectiveSave]) {
      expect(route).toContain('/workspaces/:wsId/');
    }
  });

  it('a skill is not epic-scoped by default, and carries further next steps beside next', () => {
    const plain = CatalogSkill.parse({ name: 'bmad-spec', description: 'Spec.' });
    expect(plain.scope).toBeNull();
    expect(plain.nexts).toEqual([]);
    const look = CatalogSkill.parse({ name: 'bmad-retrospective', description: 'x', scope: 'epic', nexts: [{ skill: 'bmad-project-context', label: 'Add the lessons to AGENTS.md' }] });
    expect(look.nexts).toHaveLength(1);
    expect(CatalogSkill.safeParse({ name: 'bmad-retrospective', description: 'x', scope: 'initiative' }).success).toBe(false);
  });

  it('the two new events parse and need a plain epic name', () => {
    const offer = { type: 'workspace.look_back_offer_dismissed', ...assigned, ...onWorkspace, payload: { epic: 'epic-a' } };
    const changed = { type: 'retrospective.changed', ...assigned, ...onWorkspace, payload: { epic: 'epic-a' } };
    expect(CoreEvent.parse(offer)).toEqual(offer);
    expect(CoreEvent.parse(changed)).toEqual(changed);
    expect(CoreEvent.safeParse({ ...changed, payload: { epic: '../x' } }).success).toBe(false);
  });

  it('Retrospectives needs Board and not Unattended builds', () => {
    expect(BMAD_PIECE_INFO.retrospectives.needs).toEqual(['board']);
    expect(bmadPieceNeeds('retrospectives')).toEqual(['board']);
    expect(bmadPiecesProblem(['board', 'retrospectives'])).toBeUndefined();
    expect(bmadPiecesProblem(['retrospectives'])).toBe('Retrospectives needs Board. Turn on Board too.');
  });
});
