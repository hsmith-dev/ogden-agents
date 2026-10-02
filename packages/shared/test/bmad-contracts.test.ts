/**
 * The BMad Method contracts (stories 10.1 to 10.7; moved from
 * `contracts.test.ts` in story 10.8): the pieces and their dependency rule,
 * the per-project pieces contract, and the Workspace settings texts.
 */
import { describe, expect, it } from 'vitest';
import {
  API_BASE,
  API_ERROR_CODES,
  API_ROUTES,
  apiPath,
  applyBmadPieceChoice,
  BMAD_COMING_SOON_LABEL,
  BMAD_COMING_SOON_REASON,
  BMAD_FILES_STAY_TEXT,
  BMAD_METHOD_PRESELECTED_PIECES,
  BMAD_NEW_PROJECTS_LINK,
  BMAD_REPO_HAS_BMAD_TEXT,
  BMAD_OFF_TEXT,
  BMAD_ON_TEXT,
  BMAD_PIECES_LIST_LABEL,
  BMAD_SAVE_FAILED_TEXT,
  BMAD_SECTION_INTRO,
  BMAD_SECTION_TITLE,
  BMAD_USE_DESCRIPTION,
  BMAD_USE_LABEL,
  bmadMainSwitchPieces,
  bmadNeedsUnavailableText,
  newProjectsDefaultText,
  BMAD_OFFER_CHOOSE,
  BMAD_OFFER_NOT_NOW,
  BMAD_OFFER_TEXT,
  BMAD_PIECE_INFO,
  BMAD_PIECES,
  BmadDetection,
  BmadDetectionResponse,
  bmadPieceDependents,
  bmadPieceNeeds,
  BmadPieceAvailability,
  BmadPieceSet,
  BmadPiecesResponse,
  bmadPiecesProblem,
  bmadSettingsHref,
  canonicalBmadPieces,
  CoreEvent,
  CreateWorkspaceRequest,
  DEFAULT_NEW_PROJECT_DEFAULTS,
  describeBmadPieceChange,
  FEATURE_OFF_MESSAGE,
  FEATURE_UNAVAILABLE_MESSAGE,
  FIRST_PROJECT_CHOICE_LABELS,
  FIRST_PROJECT_CHOICE_PIECES,
  FIRST_PROJECT_CHOICES,
  FIRST_PROJECT_QUESTION,
  FirstProjectChoice,
  NewProjectDefaults,
  NewProjectDefaultsResponse,
  TEST_ROUTES,
  OnboardingState,
  UpdateNewProjectDefaultsRequest,
  UpdateWorkspaceSettingsRequest,
  WORKSPACE_SETTINGS_BMAD_ANCHOR,
  type BmadPiece,
} from '../src/index.js';

const wsId = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const at = '2026-09-30T12:00:00.000Z';
const assigned = { id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W3', seq: 7, at };
const onWorkspace = { workspaceId: wsId, streamId: wsId };

describe('the BMad pieces (story 10.1, rule 10.2)', () => {
  const assignedTo = { ...onWorkspace, ...assigned };
  it('a 0.2.0 workspace.settings_changed (caution level only) still parses; a pieces change parses with both lists', () => {
    const old = { type: 'workspace.settings_changed', ...assignedTo, payload: { cautionLevel: 'ask_for_commands', previous: 'ask_every_time' } };
    expect(CoreEvent.parse(old)).toEqual(old);
    const pieces = {
      type: 'workspace.settings_changed',
      ...assignedTo,
      payload: { cautionLevel: 'ask_every_time', previous: 'ask_every_time', bmadPieces: ['planning'], previousBmadPieces: [] },
    };
    expect(CoreEvent.parse(pieces)).toEqual(pieces);
    expect(CoreEvent.safeParse({ ...pieces, payload: { ...pieces.payload, bmadPieces: ['yolo'] } }).success).toBe(false);
  });

  it('UpdateWorkspaceSettingsRequest takes the pieces alone or with a level, never an unknown or repeated piece, a broken rule, or nothing', () => {
    expect(UpdateWorkspaceSettingsRequest.parse({ bmadPieces: [] })).toEqual({ bmadPieces: [] });
    expect(UpdateWorkspaceSettingsRequest.parse({ bmadPieces: ['planning'], cautionLevel: 'ask_for_commands' })).toEqual({ bmadPieces: ['planning'], cautionLevel: 'ask_for_commands' });
    expect(UpdateWorkspaceSettingsRequest.parse({ bmadPieces: ['board', 'builds'] })).toEqual({ bmadPieces: ['board', 'builds'] });
    for (const bad of [{ bmadPieces: ['yolo'] }, { bmadPieces: ['planning', 'planning'] }, { bmadPieces: 'planning' }, { bmadPieces: ['builds'] }, { bmadPieces: ['board', 'retrospectives'] }, { other: 1 }, {}]) {
      expect(UpdateWorkspaceSettingsRequest.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    const broken = UpdateWorkspaceSettingsRequest.safeParse({ bmadPieces: ['builds'] });
    expect(broken.success ? undefined : broken.error.issues[0]?.message).toBe('Unattended builds needs Board. Turn on Board too.');
  });

  it('feature_off and feature_unavailable are error codes, and the test-only probe is under /api/v1 and outside API_ROUTES', () => {
    expect(API_ERROR_CODES).toEqual(expect.arrayContaining(['feature_off', 'feature_unavailable']));
    expect(TEST_ROUTES.bmadProbe.startsWith(`${API_BASE}/workspaces/:wsId/`)).toBe(true);
    expect(Object.values(API_ROUTES) as string[]).not.toContain(TEST_ROUTES.bmadProbe);
  });
});

describe('the per-project BMad pieces contract (story 10.2)', () => {
  const assignedTo = { ...onWorkspace, ...assigned };

  it('lists the four pieces in order, each with a plain label, one sentence and needs that are pieces', () => {
    expect(BMAD_PIECES).toEqual(['planning', 'board', 'builds', 'retrospectives']);
    expect(BMAD_PIECES.map((piece) => BMAD_PIECE_INFO[piece].label)).toEqual(['Planning', 'Board', 'Unattended builds', 'Retrospectives']);
    for (const piece of BMAD_PIECES) {
      const info = BMAD_PIECE_INFO[piece];
      expect(info.sentence, piece).toMatch(/^[A-Z][^.]*\.$/);
      expect(info.label + info.sentence, piece).not.toMatch(/bmad-|_bmad/);
      // Every need comes earlier in the canonical order, so the order is a valid build order.
      for (const need of info.needs) expect(BMAD_PIECES.indexOf(need), `${piece} needs ${need}`).toBeLessThan(BMAD_PIECES.indexOf(piece));
    }
    expect(bmadPieceNeeds('retrospectives')).toEqual(['board', 'builds']);
    expect(bmadPieceNeeds('planning')).toEqual([]);
    expect(bmadPieceDependents('board')).toEqual(['builds', 'retrospectives']);
    expect(bmadPieceDependents('planning')).toEqual([]);
    expect(canonicalBmadPieces(['retrospectives', 'planning', 'builds', 'planning'])).toEqual(['planning', 'builds', 'retrospectives']);
  });

  it("the design notes' examples of the rule function", () => {
    expect(applyBmadPieceChoice(['board'], 'builds', true)).toEqual({ pieces: ['board', 'builds'], turnedOn: [], turnedOff: [] });
    expect(applyBmadPieceChoice([], 'retrospectives', true)).toEqual({ pieces: ['board', 'builds', 'retrospectives'], turnedOn: ['board', 'builds'], turnedOff: [] });
    expect(applyBmadPieceChoice(['board', 'builds', 'retrospectives'], 'board', false)).toEqual({ pieces: [], turnedOn: [], turnedOff: ['builds', 'retrospectives'] });
    expect(applyBmadPieceChoice(['planning', 'board', 'builds'], 'builds', false)).toEqual({ pieces: ['planning', 'board'], turnedOn: [], turnedOff: [] });
  });

  // Every subset of the four pieces (16), every piece, on and off.
  const subsets = Array.from({ length: 1 << BMAD_PIECES.length }, (_, mask) => BMAD_PIECES.filter((_, index) => (mask & (1 << index)) !== 0));
  const closedUnder = (pieces: readonly BmadPiece[]) => pieces.every((piece) => bmadPieceNeeds(piece).every((need) => pieces.includes(need)));
  it('the rule table: 16 subsets x 4 pieces x on/off', () => {
    expect(subsets).toHaveLength(16);
    let rows = 0;
    for (const current of subsets) {
      // The check agrees with the closure: a subset satisfies the rule exactly when it holds every need.
      expect(bmadPiecesProblem(current) === undefined, JSON.stringify(current)).toBe(closedUnder(current));
      expect(BmadPieceSet.safeParse(current).success, JSON.stringify(current)).toBe(closedUnder(current));
      for (const piece of BMAD_PIECES) {
        for (const on of [true, false]) {
          rows += 1;
          const row = `${JSON.stringify(current)} ${piece} ${on ? 'on' : 'off'}`;
          const change = applyBmadPieceChoice(current, piece, on);
          expect(change.pieces, row).toEqual(canonicalBmadPieces(change.pieces));
          const added = change.pieces.filter((p) => !current.includes(p));
          const removed = current.filter((p) => !change.pieces.includes(p));
          if (on) {
            // On adds the piece and everything it needs, and removes nothing.
            expect(change.pieces, row).toEqual(canonicalBmadPieces([...current, piece, ...bmadPieceNeeds(piece)]));
            expect(removed, row).toEqual([]);
            expect(change.turnedOn, row).toEqual(added.filter((p) => p !== piece));
            expect(change.turnedOff, row).toEqual([]);
          } else {
            // Off removes the piece and everything that needs it, and adds nothing.
            expect(change.pieces, row).toEqual(current.filter((p) => p !== piece && !bmadPieceDependents(piece).includes(p)));
            expect(added, row).toEqual([]);
            expect(change.turnedOff, row).toEqual(removed.filter((p) => p !== piece));
            expect(change.turnedOn, row).toEqual([]);
          }
          // From a set that satisfies the rule, the result does too.
          if (closedUnder(current)) expect(bmadPiecesProblem(change.pieces), row).toBeUndefined();
          // The note says exactly what else changed.
          const note = describeBmadPieceChange(change);
          if (change.turnedOn.length + change.turnedOff.length === 0) expect(note, row).toBeUndefined();
          else for (const other of [...change.turnedOn, ...change.turnedOff]) expect(note, row).toContain(BMAD_PIECE_INFO[other].label);
        }
      }
    }
    expect(rows).toBe(16 * 4 * 2);
  });

  it('the notes and the problem read as plain sentences', () => {
    expect(describeBmadPieceChange({ turnedOn: ['board'], turnedOff: [] })).toBe('Board was turned on too, because the feature you chose needs it.');
    expect(describeBmadPieceChange({ turnedOn: ['board', 'builds'], turnedOff: [] })).toBe('Board and Unattended builds were turned on too, because the feature you chose needs it.');
    expect(describeBmadPieceChange({ turnedOn: [], turnedOff: ['builds', 'retrospectives'] })).toBe(
      'Unattended builds and Retrospectives were turned off too, because they need the feature you turned off.',
    );
    expect(describeBmadPieceChange({ turnedOn: [], turnedOff: ['retrospectives'] })).toBe('Retrospectives was turned off too, because it needs the feature you turned off.');
    expect(bmadPiecesProblem(['board', 'retrospectives'])).toBe('Retrospectives needs Unattended builds. Turn on Unattended builds too.');
    expect(bmadPiecesProblem(['planning', 'board', 'builds', 'retrospectives'])).toBeUndefined();
  });

  it('a 0.2.0 settings event and a 10.1 pieces event still parse; a pieces event may carry any of the four', () => {
    const old = { type: 'workspace.settings_changed', ...assignedTo, payload: { cautionLevel: 'ask_for_commands', previous: 'ask_every_time' } };
    expect(CoreEvent.parse(old)).toEqual(old);
    const tracer = { ...old, payload: { cautionLevel: 'ask_every_time', previous: 'ask_every_time', bmadPieces: ['planning'], previousBmadPieces: [] } };
    expect(CoreEvent.parse(tracer)).toEqual(tracer);
    const all = { ...old, payload: { ...tracer.payload, bmadPieces: [...BMAD_PIECES], previousBmadPieces: ['planning'] } };
    expect(CoreEvent.parse(all)).toEqual(all);
    expect(CoreEvent.safeParse({ ...all, payload: { ...all.payload, previousBmadPieces: ['board', 'board'] } }).success).toBe(false);
  });

  it('availability: reason exactly when unavailable; the response lists all four, in order', () => {
    expect(BmadPieceAvailability.safeParse({ piece: 'planning', available: true }).success).toBe(true);
    expect(BmadPieceAvailability.safeParse({ piece: 'planning', available: false, reason: BMAD_COMING_SOON_REASON }).success).toBe(true);
    expect(BmadPieceAvailability.safeParse({ piece: 'planning', available: false }).success).toBe(false);
    expect(BmadPieceAvailability.safeParse({ piece: 'planning', available: true, reason: 'Why?' }).success).toBe(false);
    const all = BMAD_PIECES.map((piece) => ({ piece, available: false, reason: BMAD_COMING_SOON_REASON }));
    expect(BmadPiecesResponse.parse({ pieces: all }).pieces).toHaveLength(4);
    expect(BmadPiecesResponse.safeParse({ pieces: all.slice(0, 3) }).success).toBe(false);
    expect(BmadPiecesResponse.safeParse({ pieces: [...all].reverse() }).success).toBe(false);
    expect(BmadPiecesResponse.safeParse({ pieces: [...all, all[0]] }).success).toBe(false);
  });

  it('the app-wide default, Welcome, detection and the settings anchor', () => {
    expect(DEFAULT_NEW_PROJECT_DEFAULTS).toEqual({ bmadPieces: [] });
    expect(NewProjectDefaultsResponse.parse({ defaults: DEFAULT_NEW_PROJECT_DEFAULTS })).toEqual({ defaults: { bmadPieces: [] } });
    expect(UpdateNewProjectDefaultsRequest.parse({ bmadPieces: ['planning', 'board'] })).toEqual({ bmadPieces: ['planning', 'board'] });
    for (const bad of [{ bmadPieces: ['builds'] }, { bmadPieces: ['yolo'] }, {}]) expect(UpdateNewProjectDefaultsRequest.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(NewProjectDefaults.safeParse({ bmadPieces: ['retrospectives'] }).success).toBe(false);

    expect(FIRST_PROJECT_CHOICES).toEqual(['simple_chats', 'bmad_method']);
    expect(FIRST_PROJECT_CHOICE_PIECES).toEqual({ simple_chats: [], bmad_method: ['planning', 'board'] });
    expect(FIRST_PROJECT_CHOICE_PIECES.bmad_method).toBe(BMAD_METHOD_PRESELECTED_PIECES);
    expect(FIRST_PROJECT_CHOICE_LABELS).toEqual({ simple_chats: 'Simple chats', bmad_method: 'BMad Method' });
    expect(FirstProjectChoice.safeParse('both').success).toBe(false);
    // Welcome's record from before epic 10 still parses; the answer, once given, is kept with it.
    expect(OnboardingState.parse({ welcomeCompleted: true })).toEqual({ welcomeCompleted: true });
    expect(OnboardingState.parse({ welcomeCompleted: true, firstProjectChoice: 'bmad_method' })).toEqual({ welcomeCompleted: true, firstProjectChoice: 'bmad_method' });
    expect(OnboardingState.safeParse({ welcomeCompleted: true, firstProjectChoice: 'maybe' }).success).toBe(false);

    const detection = { hasBmad: true, hasOutput: false, offerDismissed: false };
    expect(BmadDetectionResponse.parse({ detection })).toEqual({ detection });
    expect(BmadDetection.safeParse({ hasBmad: true, hasOutput: false }).success).toBe(false);

    expect(WORKSPACE_SETTINGS_BMAD_ANCHOR).toBe('bmad-method');
    expect(bmadSettingsHref(wsId)).toBe(`/w/${wsId}/settings#bmad-method`);
  });

  it('CreateWorkspaceRequest takes optional starting pieces that satisfy the rule', () => {
    expect(CreateWorkspaceRequest.parse({ path: '/repo' })).toEqual({ path: '/repo' });
    expect(CreateWorkspaceRequest.parse({ path: '/repo', bmadPieces: ['planning', 'board'] })).toEqual({ path: '/repo', bmadPieces: ['planning', 'board'] });
    expect(CreateWorkspaceRequest.safeParse({ path: '/repo', bmadPieces: ['builds'] }).success).toBe(false);
  });

  it('every user-facing text is a plain sentence or label', () => {
    for (const text of [FEATURE_OFF_MESSAGE, FEATURE_UNAVAILABLE_MESSAGE, BMAD_COMING_SOON_REASON, BMAD_OFFER_TEXT, BMAD_FILES_STAY_TEXT, FIRST_PROJECT_QUESTION]) {
      expect(text, text).toMatch(/^[A-Z].*[.?]$/);
    }
    expect(BMAD_OFFER_TEXT).toBe('This project already uses BMad Method. Turn on its features?');
    expect(BMAD_FILES_STAY_TEXT).toBe('Your BMad files stay in this project.');
    expect(FIRST_PROJECT_QUESTION).toBe('Simple chats or BMad Method?');
    expect([BMAD_OFFER_CHOOSE, BMAD_OFFER_NOT_NOW, BMAD_COMING_SOON_LABEL]).toEqual(['Choose features', 'Not now', 'Coming soon']);
  });

  it('the new routes are under /api/v1; the workspace ones inside a workspace', () => {
    expect(API_ROUTES.bmadPieces).toBe(`${API_BASE}/bmad/pieces`);
    expect(API_ROUTES.newProjectDefaults).toBe(`${API_BASE}/settings/new-projects`);
    expect(apiPath(API_ROUTES.workspaceBmadDetection, { wsId })).toBe(`${API_BASE}/workspaces/${wsId}/bmad/detection`);
    expect(apiPath(API_ROUTES.workspaceBmadOffer, { wsId })).toBe(`${API_BASE}/workspaces/${wsId}/bmad/offer`);
  });
});

describe('the Workspace settings section texts (story 10.5)', () => {
  it('every text is plain, with no em or en dash, and turning off says the files stay', () => {
    const texts = [BMAD_SECTION_TITLE, BMAD_PIECES_LIST_LABEL, BMAD_SECTION_INTRO, BMAD_USE_LABEL, BMAD_USE_DESCRIPTION, BMAD_ON_TEXT, BMAD_OFF_TEXT, BMAD_SAVE_FAILED_TEXT, bmadNeedsUnavailableText(['board']), bmadNeedsUnavailableText(['board', 'builds'])];
    for (const text of texts) {
      expect(text, text).not.toMatch(/[\u2013\u2014]/);
      expect(text, text).not.toMatch(/bmad-|_bmad/);
    }
    for (const text of [BMAD_SECTION_INTRO, BMAD_USE_DESCRIPTION, BMAD_ON_TEXT, BMAD_OFF_TEXT, BMAD_SAVE_FAILED_TEXT]) expect(text, text).toMatch(/^[A-Z].*\.$/);
    expect(BMAD_SECTION_TITLE).toBe('BMad Method');
    expect(BMAD_USE_LABEL).toBe('Use BMad Method in this project');
    expect(BMAD_OFF_TEXT.endsWith(BMAD_FILES_STAY_TEXT)).toBe(true);
  });

  it('the slots (story 10.7) are plain, with no em or en dash, and name the default', () => {
    const texts = [BMAD_REPO_HAS_BMAD_TEXT, BMAD_NEW_PROJECTS_LINK, newProjectsDefaultText([]), newProjectsDefaultText(['planning']), newProjectsDefaultText(['board', 'planning', 'builds'])];
    for (const text of texts) {
      expect(text, text).not.toMatch(/[\u2013\u2014]/);
      expect(text, text).not.toMatch(/bmad-|_bmad/);
      expect(text, text).toMatch(/^[A-Z]/);
    }
    expect(BMAD_REPO_HAS_BMAD_TEXT).toContain('already has BMad Method files');
    expect(newProjectsDefaultText([])).toBe('New projects start as Simple chats.');
    expect(newProjectsDefaultText(['board', 'planning'])).toBe('New projects start with BMad Method: Planning and Board.');
  });

  it('the needs reason names what is missing', () => {
    expect(bmadNeedsUnavailableText(['board'])).toBe("Needs Board, which isn't in this version yet.");
    expect(bmadNeedsUnavailableText(['builds', 'board'])).toBe("Needs Board and Unattended builds, which aren't in this version yet.");
  });

  it('the main switch turns on the preselected pieces this install ships, with their needs', () => {
    expect(bmadMainSwitchPieces(BMAD_PIECES)).toEqual(['planning', 'board']);
    expect(bmadMainSwitchPieces(['planning', 'board'])).toEqual(['planning', 'board']);
    expect(bmadMainSwitchPieces(['board', 'builds'])).toEqual(['board']);
    expect(bmadMainSwitchPieces(['planning'])).toEqual(['planning']);
    expect(bmadMainSwitchPieces(['builds', 'retrospectives'])).toEqual([]);
    expect(bmadMainSwitchPieces([])).toEqual([]);
    // Whatever it turns on satisfies the rule.
    for (const mask of Array.from({ length: 16 }, (_, index) => index)) {
      const available = BMAD_PIECES.filter((_, index) => (mask & (1 << index)) !== 0);
      const pieces = bmadMainSwitchPieces(available);
      expect(bmadPiecesProblem(pieces), JSON.stringify(available)).toBeUndefined();
      expect(pieces.every((piece) => available.includes(piece)), JSON.stringify(available)).toBe(true);
    }
  });
});
