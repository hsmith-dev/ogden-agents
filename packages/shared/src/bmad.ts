import { z } from 'zod';
import { AgentId } from './events-common.js';
import { PermissionMode } from './entities.js';

/**
 * The per-project BMad Method pieces contract (CAP-19, AD-22; frozen by story
 * 10.2). Every shape, rule and user-facing text of epic 10 lives here, so
 * epics 4 to 7 and entries 10.3 to 10.6 build against one list:
 *
 * - the four pieces, each with its plain label, one sentence and what it needs;
 * - the dependency rule as one function ({@link applyBmadPieceChoice}) and
 *   one check ({@link bmadPiecesProblem});
 * - what the install ships ({@link BmadPiecesResponse}: all four, each
 *   available or not with the coming-soon reason);
 * - the app-wide default for new projects, Welcome's one-time answer for the
 *   first project, the read-only detection of a repo's `_bmad/`, and the
 *   anchor of the Workspace settings section the offer links to.
 *
 * This file imports nothing of the package's own, so `events.ts` and
 * `chat.ts` can import it without a cycle.
 */

/**
 * The BMad Method pieces a workspace can turn on, in their canonical order.
 * Every piece is off for a new or upgraded workspace; "BMad off" is every
 * piece off (there is no master flag). Widening this list keeps stored
 * events parseable.
 */
export const BMAD_PIECES = ['planning', 'board', 'builds', 'retrospectives'] as const;
export const BmadPiece = z.enum(BMAD_PIECES);
export type BmadPiece = z.infer<typeof BmadPiece>;

/** A list of pieces, each at most once (the shape stored events carry; the dependency rule is not checked here). */
export const BmadPieces = z.array(BmadPiece).refine((pieces) => new Set(pieces).size === pieces.length, 'Each BMad piece can be listed once.');
export type BmadPieces = z.infer<typeof BmadPieces>;

/** What the user reads about a piece, and the pieces it cannot work without. */
export interface BmadPieceInfo {
  /** The plain label (EXPERIENCE.md Voice and Tone): never a skill name. */
  readonly label: string;
  /** One sentence saying what the piece does. */
  readonly sentence: string;
  /** The pieces this one needs on (directly; {@link applyBmadPieceChoice} follows them transitively). */
  readonly needs: readonly BmadPiece[];
  /**
   * Whether serving the piece runs the project's own BMad Method scripts
   * (Board through `tickets.py`, which executes the repo's
   * `_bmad/scripts/config_utils.py`; story 4.2, AD-22 note 2026-10-02). Its
   * routes and use-cases then also need the user's one-time trust for the
   * project (`scripts_not_trusted` until given).
   */
  readonly runsProjectScripts: boolean;
}

/**
 * Each piece's label, sentence and direct needs. The dependency rule:
 * `builds` needs `board` (dispatch reads the ticket tree and Build sits on
 * the board), `retrospectives` needs `board` (a look-back reads the ticket
 * tree, not Ogden's runs; user decision 2026-10-02, story 7.2); `planning`
 * and `board` are independent.
 */
export const BMAD_PIECE_INFO: Readonly<Record<BmadPiece, BmadPieceInfo>> = {
  planning: { label: 'Planning', sentence: 'Turn an idea into a plan, a spec and tickets with guided steps.', needs: [], runsProjectScripts: false },
  board: { label: 'Board', sentence: "See this project's tickets on a board and move them along.", needs: [], runsProjectScripts: true },
  builds: { label: 'Unattended builds', sentence: 'Let an agent build tickets on its own, then review and approve the work.', needs: ['board'], runsProjectScripts: true },
  retrospectives: { label: 'Retrospectives', sentence: 'Look back on finished work and record what to change next time.', needs: ['board'], runsProjectScripts: true },
};

/** Whether any of `pieces` runs the project's own BMad Method scripts (so turning it on asks for the project's trust first). */
export function bmadPiecesRunProjectScripts(pieces: Iterable<BmadPiece>): boolean {
  for (const piece of pieces) if (BMAD_PIECE_INFO[piece].runsProjectScripts) return true;
  return false;
}

/** `pieces` without repeats, in the canonical {@link BMAD_PIECES} order. */
export function canonicalBmadPieces(pieces: Iterable<BmadPiece>): BmadPiece[] {
  const set = new Set(pieces);
  return BMAD_PIECES.filter((piece) => set.has(piece));
}

/** Every piece `piece` needs, directly or through another piece (not `piece` itself). */
export function bmadPieceNeeds(piece: BmadPiece): BmadPiece[] {
  const found = new Set<BmadPiece>();
  const visit = (next: BmadPiece) => {
    for (const need of BMAD_PIECE_INFO[next].needs) {
      if (found.has(need)) continue;
      found.add(need);
      visit(need);
    }
  };
  visit(piece);
  return canonicalBmadPieces(found);
}

/** Every piece that needs `piece`, directly or through another piece (not `piece` itself). */
export function bmadPieceDependents(piece: BmadPiece): BmadPiece[] {
  return BMAD_PIECES.filter((other) => other !== piece && bmadPieceNeeds(other).includes(piece));
}

/** What one choice did: the pieces now on, and what else it turned on or off. */
export interface BmadPieceChange {
  /** The pieces on after the choice, in canonical order. */
  pieces: BmadPiece[];
  /** Pieces turned on because the chosen one needs them (not the chosen piece itself). */
  turnedOn: BmadPiece[];
  /** Pieces turned off because they need the one turned off (not the chosen piece itself). */
  turnedOff: BmadPiece[];
}

/**
 * The dependency rule as one function: turning `piece` on also turns on
 * everything it needs; turning it off also turns off everything that needs
 * it. Nothing else changes. From pieces that satisfy the rule, the result
 * satisfies it too.
 *
 * ```ts
 * applyBmadPieceChoice(['board'], 'builds', true)  // { pieces: ['board','builds'], turnedOn: [], turnedOff: [] }
 * applyBmadPieceChoice([], 'retrospectives', true) // { pieces: ['board','retrospectives'], turnedOn: ['board'], turnedOff: [] }
 * applyBmadPieceChoice(['board','builds','retrospectives'], 'board', false) // { pieces: [], turnedOn: [], turnedOff: ['builds','retrospectives'] }
 * ```
 */
export function applyBmadPieceChoice(current: readonly BmadPiece[], piece: BmadPiece, on: boolean): BmadPieceChange {
  const before = new Set(current);
  if (on) {
    const needs = bmadPieceNeeds(piece);
    return {
      pieces: canonicalBmadPieces([...before, piece, ...needs]),
      turnedOn: needs.filter((need) => !before.has(need)),
      turnedOff: [],
    };
  }
  const dependents = bmadPieceDependents(piece);
  const removed = new Set<BmadPiece>([piece, ...dependents]);
  return {
    pieces: canonicalBmadPieces([...before].filter((kept) => !removed.has(kept))),
    turnedOn: [],
    turnedOff: dependents.filter((dependent) => before.has(dependent)),
  };
}

/** `Board`, `Board and Unattended builds`, `Board, Unattended builds and Retrospectives`. */
function labelList(pieces: readonly BmadPiece[]): string {
  const labels = pieces.map((piece) => BMAD_PIECE_INFO[piece].label);
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)!}`;
}

/**
 * Why `pieces` breaks the dependency rule, in plain words, or `undefined`
 * when it holds ("Unattended builds needs Board. Turn on Board too.").
 */
export function bmadPiecesProblem(pieces: readonly BmadPiece[]): string | undefined {
  const on = new Set(pieces);
  for (const piece of BMAD_PIECES) {
    if (!on.has(piece)) continue;
    const missing = BMAD_PIECE_INFO[piece].needs.filter((need) => !on.has(need));
    if (missing.length > 0) return `${BMAD_PIECE_INFO[piece].label} needs ${labelList(missing)}. Turn on ${labelList(missing)} too.`;
  }
  return undefined;
}

/**
 * The one line that says what else a choice changed, or `undefined` when it
 * changed only the chosen piece ("Board was turned on too, because the
 * feature you chose needs it.").
 */
export function describeBmadPieceChange(change: Pick<BmadPieceChange, 'turnedOn' | 'turnedOff'>): string | undefined {
  const many = (pieces: readonly BmadPiece[]) => (pieces.length === 1 ? 'was' : 'were');
  if (change.turnedOn.length > 0) return `${labelList(change.turnedOn)} ${many(change.turnedOn)} turned on too, because the feature you chose needs it.`;
  if (change.turnedOff.length > 0) {
    return `${labelList(change.turnedOff)} ${many(change.turnedOff)} turned off too, because ${change.turnedOff.length === 1 ? 'it needs' : 'they need'} the feature you turned off.`;
  }
  return undefined;
}

/** A set of pieces to keep: each at most once, and the dependency rule holds (a stored set always satisfies it). */
export const BmadPieceSet = BmadPieces.superRefine((pieces, ctx) => {
  const problem = bmadPiecesProblem(pieces);
  if (problem !== undefined) ctx.addIssue({ code: 'custom', message: problem });
});

// ---- User-facing texts (every one of the epic's lives here) ----

/** `not_found` (404) from a piece's route whose workspace doesn't exist (or whose `:wsId` is malformed). */
export const BMAD_PROJECT_NOT_FOUND_MESSAGE = 'There is no such project.';
/** `not_found` (404) from a piece's route whose handler found no such ticket, session, run or other thing. */
export const BMAD_ITEM_NOT_FOUND_MESSAGE = "That doesn't exist in this project any more.";
/** `feature_off` (409): a piece the project has off was asked for. */
export const FEATURE_OFF_MESSAGE = "This BMad Method feature is off in this project. Turn it on in the project's settings to use it.";
/** `feature_unavailable` (409): a piece this install doesn't ship yet was asked to turn on. */
export const FEATURE_UNAVAILABLE_MESSAGE = "This BMad Method feature isn't in this version of Ogden Agents yet, so it can't be turned on.";
/** The mark on a piece this install doesn't ship yet (greyed, impossible to turn on). */
export const BMAD_COMING_SOON_LABEL = 'Coming soon';
/** The reason a piece is unavailable while no epic has shipped it. */
export const BMAD_COMING_SOON_REASON = "Coming soon. This version of Ogden Agents doesn't include it yet.";
/** The offer on a project whose repo already has `_bmad/` and every piece off (entry 10.3). */
export const BMAD_OFFER_TEXT = 'This project already uses BMad Method. Turn on its features?';
/** The offer's button that opens the project's BMad settings. */
export const BMAD_OFFER_CHOOSE = 'Choose features';
/** The offer's button that hides it for good in this project. */
export const BMAD_OFFER_NOT_NOW = 'Not now';
/** Said when BMad is turned off in a project (entry 10.5): turning off never deletes or edits files. */
export const BMAD_FILES_STAY_TEXT = 'Your BMad files stay in this project.';
/** Welcome's one question, asked once for the first project (entry 10.4). */
export const FIRST_PROJECT_QUESTION = 'Simple chats or BMad Method?';
/** Settings' entry and page title for the app-wide default (entry 10.4). */
export const NEW_PROJECTS_SETTINGS_LABEL = 'New projects';
/** The intro of Settings → New projects. */
export const NEW_PROJECTS_SETTINGS_INTRO =
  "What a project you add starts with. Projects you already have keep their own settings, and nothing is written into a project's folder.";
/** The sentence under Simple chats, in Settings → New projects and in Welcome. */
export const SIMPLE_CHATS_SENTENCE = 'Chat with your agent. Every BMad Method feature starts off, and you can turn them on later in the project.';
/** The sentence under BMad Method, in Settings → New projects and in Welcome. */
export const BMAD_METHOD_SENTENCE = 'Plan and track the work with BMad Method features, starting with Planning and Board.';
/** Welcome's line under the question: what the answer changes. */
export const FIRST_PROJECT_QUESTION_HINT = 'This applies to the project you add now. You can change it later in its settings.';
/** Said when BMad Method can't be chosen because this install ships none of its features yet. */
export const BMAD_METHOD_COMING_SOON_SENTENCE = "Coming soon. This version of Ogden Agents doesn't include BMad Method features yet.";
/** `internal_error` (500) when the default for new projects couldn't be kept. */
export const NEW_PROJECTS_SAVE_FAILED = "Ogden Agents couldn't save the default for new projects. Try again.";
/** The fallback when the default for new projects couldn't be loaded. */
export const NEW_PROJECTS_LOAD_FAILED = "Ogden Agents couldn't load the default for new projects";
/** The fallback when a change to the default for new projects couldn't be saved (no reason from the server). */
export const NEW_PROJECTS_SAVE_FALLBACK = "The default for new projects couldn't be saved";
/** The accessible name of Settings → New projects' Simple chats / BMad Method choice. */
export const NEW_PROJECTS_MODE_LABEL = 'New projects start with';
/** The accessible name of the BMad Method features new projects start with. */
export const NEW_PROJECTS_PIECES_LABEL = 'BMad Method features new projects start with';
/** Settings → New projects' status line after a save. */
export const NEW_PROJECTS_SAVED_TEXT = 'Saved. New projects start with this.';

// ---- What the install ships ----

/**
 * One piece as this install reports it: `available` once the epic that
 * builds it has registered it (server wiring's shipped list), otherwise
 * `false` with the coming-soon `reason`. `reason` is present exactly when
 * the piece is unavailable.
 */
export const BmadPieceAvailability = z
  .object({ piece: BmadPiece, available: z.boolean(), reason: z.string().min(1).optional() })
  .refine((entry) => entry.available === (entry.reason === undefined), 'A reason is given exactly when a piece is unavailable.');
export type BmadPieceAvailability = z.infer<typeof BmadPieceAvailability>;

/** `GET /api/v1/bmad/pieces`: always all four pieces, in canonical order. */
export const BmadPiecesResponse = z.object({
  pieces: z
    .array(BmadPieceAvailability)
    .refine((pieces) => pieces.length === BMAD_PIECES.length && pieces.every((entry, index) => entry.piece === BMAD_PIECES[index]), 'Every piece is listed once, in order.'),
});
export type BmadPiecesResponse = z.infer<typeof BmadPiecesResponse>;

// ---- The app-wide default for new projects ----

/** The pieces a newly added project starts with (an install-level preference kept by core; entry 10.4). */
export const NewProjectDefaults = z.object({
  bmadPieces: BmadPieceSet,
  /**
   * The agent new projects get as their default (epic 6, entry 6): Welcome's
   * agent choice, or Settings → New projects. Absent: the install's default
   * agent (`ChatAgentsResponse.defaultAgentId`). Written on a project's row
   * when it is added; projects that exist already never change with it.
   */
  defaultAgentId: AgentId.optional(),
  /**
   * The mode new projects' chats start in (default permission mode). Absent:
   * Ask. Copied to a project when it is added; Skip all reaches it as Ask
   * waiting for the user's confirmation for that project.
   */
  defaultPermissionMode: PermissionMode.optional(),
});
export type NewProjectDefaults = z.infer<typeof NewProjectDefaults>;
/** The app-wide default before the user changes it: Simple (every piece off). */
export const DEFAULT_NEW_PROJECT_DEFAULTS: NewProjectDefaults = { bmadPieces: [] };
/** `GET` and `PATCH /api/v1/settings/new-projects`. */
export const NewProjectDefaultsResponse = z.object({ defaults: NewProjectDefaults });
export type NewProjectDefaultsResponse = z.infer<typeof NewProjectDefaultsResponse>;
/**
 * `PATCH /api/v1/settings/new-projects`: the new default pieces (a newly-on
 * unavailable piece is refused with `feature_unavailable`) and/or the new
 * default agent (epic 6: `null` goes back to the install's default; an agent
 * this install doesn't have is refused with `agent_unknown`). At least one.
 */
export const UpdateNewProjectDefaultsRequest = z
  .object({
    bmadPieces: BmadPieceSet.optional(),
    defaultAgentId: AgentId.nullable().optional(),
    /** Skip all needs Developer mode and `confirm: true`, as a project's default does. */
    defaultPermissionMode: PermissionMode.optional(),
    confirm: z.boolean().optional(),
  })
  .refine((input) => input.bmadPieces !== undefined || input.defaultAgentId !== undefined || input.defaultPermissionMode !== undefined, 'Choose a setting to change.');
export type UpdateNewProjectDefaultsRequest = z.infer<typeof UpdateNewProjectDefaultsRequest>;

// ---- Welcome's first-project answer ----

/** The answer to {@link FIRST_PROJECT_QUESTION}: Simple chats (preselected) or BMad Method. */
export const FIRST_PROJECT_CHOICES = ['simple_chats', 'bmad_method'] as const;
export const FirstProjectChoice = z.enum(FIRST_PROJECT_CHOICES);
export type FirstProjectChoice = z.infer<typeof FirstProjectChoice>;
/** Each choice's plain label. */
export const FIRST_PROJECT_CHOICE_LABELS: Readonly<Record<FirstProjectChoice, string>> = { simple_chats: 'Simple chats', bmad_method: 'BMad Method' };
/** What "BMad Method" turns on, in Welcome and with the settings section's main switch: Planning and Board. */
export const BMAD_METHOD_PRESELECTED_PIECES: readonly BmadPiece[] = ['planning', 'board'];
/** The pieces the first project starts with for each answer. The app-wide default is not changed by it. */
export const FIRST_PROJECT_CHOICE_PIECES: Readonly<Record<FirstProjectChoice, readonly BmadPiece[]>> = {
  simple_chats: [],
  bmad_method: BMAD_METHOD_PRESELECTED_PIECES,
};

// ---- Detection and the offer ----

/**
 * Whether the project's repo already has BMad (read-only, through
 * `BmadCatalogPort.detect`): `_bmad/` and `_bmad-output/` as folders, and
 * whether the user answered the offer with Not now (kept per project).
 */
export const BmadDetection = z.object({ hasBmad: z.boolean(), hasOutput: z.boolean(), offerDismissed: z.boolean() });
export type BmadDetection = z.infer<typeof BmadDetection>;
/** `GET /api/v1/workspaces/:wsId/bmad/detection`. */
export const BmadDetectionResponse = z.object({ detection: BmadDetection });
export type BmadDetectionResponse = z.infer<typeof BmadDetectionResponse>;

// ---- The Workspace settings section ----

/** The id of Workspace settings' BMad Method section, which the offer's Choose features opens. */
export const WORKSPACE_SETTINGS_BMAD_ANCHOR = 'bmad-method';

/** The UI path of a project's BMad Method settings: `/w/:wsId/settings#bmad-method`. */
export function bmadSettingsHref(wsId: string): string {
  return `/w/${encodeURIComponent(wsId)}/settings#${WORKSPACE_SETTINGS_BMAD_ANCHOR}`;
}

// ---- Workspace settings section texts (entry 10.5) ----

/** The section's heading. */
export const BMAD_SECTION_TITLE = 'BMad Method';
/** The sentence under the heading. */
export const BMAD_SECTION_INTRO = 'Projects start as simple chats. Turn on the BMad Method features this project uses. Turning one off never changes your files.';
/** The main switch's label: on when any piece is on (derived, never stored). */
export const BMAD_USE_LABEL = 'Use BMad Method in this project';
/** The main switch's sentence. */
export const BMAD_USE_DESCRIPTION = 'Turns on the features most projects start with. Turning it off turns every feature off. Choose each feature below.';
/** The accessible name of the list of the four pieces under the main switch. */
export const BMAD_PIECES_LIST_LABEL = 'BMad Method features';
/** Said when the main switch turned BMad on. */
export const BMAD_ON_TEXT = 'BMad Method is on in this project.';
/** Said when BMad ends up off (every piece off): turning off never deletes or edits files. */
export const BMAD_OFF_TEXT = `BMad Method is off in this project. ${BMAD_FILES_STAY_TEXT}`;
/** Said when a change couldn't be saved and the server gave no reason. */
export const BMAD_SAVE_FAILED_TEXT = "The BMad Method setting couldn't be saved. Try again.";

/**
 * Why a piece can't be turned on although this install ships it: something
 * it needs doesn't ship yet ("Needs Board, which isn't in this version yet.").
 */
export function bmadNeedsUnavailableText(missing: readonly BmadPiece[]): string {
  const pieces = canonicalBmadPieces(missing);
  return `Needs ${labelList(pieces)}, which ${pieces.length === 1 ? "isn't" : "aren't"} in this version yet.`;
}

/**
 * What the main switch turns on: each preselected piece
 * ({@link BMAD_METHOD_PRESELECTED_PIECES}) this install ships, with
 * everything it needs, when those ship too. Empty when none can be turned on
 * (the main switch is then Coming soon).
 */
export function bmadMainSwitchPieces(available: Iterable<BmadPiece>): BmadPiece[] {
  const shipped = new Set(available);
  const pieces = BMAD_METHOD_PRESELECTED_PIECES.filter((piece) => shipped.has(piece) && bmadPieceNeeds(piece).every((need) => shipped.has(need)));
  return canonicalBmadPieces(pieces.flatMap((piece) => [piece, ...bmadPieceNeeds(piece)]));
}

// ---- Workspace settings section slots (entry 10.7) ----

/**
 * The note in a project's BMad Method section when its repo already has
 * `_bmad/` and every piece is off: context, not the offer, so it has no
 * buttons and shows whatever the offer's Not now said.
 */
export const BMAD_REPO_HAS_BMAD_TEXT = "This project's folder already has BMad Method files. Ogden Agents leaves them as they are.";

/** The line naming the app-wide default for new projects ("New projects start as Simple chats."). */
export function newProjectsDefaultText(pieces: readonly BmadPiece[]): string {
  return pieces.length === 0 ? 'New projects start as Simple chats.' : `New projects start with BMad Method: ${labelList(canonicalBmadPieces(pieces))}.`;
}

/** The link after {@link newProjectsDefaultText}, to Settings → New projects. */
export const BMAD_NEW_PROJECTS_LINK = 'Change the default for new projects';
