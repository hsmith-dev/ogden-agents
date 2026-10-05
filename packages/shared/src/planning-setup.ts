import { z } from 'zod';
import { BmadCapability } from './planning-catalog.js';

/**
 * BMad Method's setup in a project (entry 4.3), the per-project script trust
 * (story 4.2), the pinned upstream BMad Method (story 4.14, AD-13) and
 * document cards (story 4.7).
 *
 * Part of epic 4's contract, split out of `planning.ts` (entry 4.12), which
 * re-exports it under the same names.
 */

// ---- BMad Method's setup in a project ----

/**
 * Where a project's BMad Method stands (`setup.py --status`, entry 4.3):
 * - `not_set_up`: no `_bmad/`;
 * - `setup_owed`: a piece is on but setup hasn't finished (or was interrupted);
 * - `current`: set up with the pinned version (AD-13);
 * - `update_available`: set up with an older version than the pinned one;
 * - `unusable`: `_bmad/` is there but can't be read (`problems` says why).
 */
export const BMAD_SETUP_STATES = ['not_set_up', 'setup_owed', 'current', 'update_available', 'unusable'] as const;
export const BmadSetupState = z.enum(BMAD_SETUP_STATES);
export type BmadSetupState = z.infer<typeof BmadSetupState>;

/** A path relative to the repo, `/`-separated, never absolute and never leaving it. */
export const RepoRelativePath = z
  .string()
  .min(1)
  .refine(
    (path) => !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && !path.includes('\\') && !path.split('/').includes('..'),
    'A path inside the project, with forward slashes.',
  );
export type RepoRelativePath = z.infer<typeof RepoRelativePath>;

export const BmadSetupStatus = z.object({
  state: BmadSetupState,
  /** The output folder the project's config names, relative to the repo (`_bmad-output`); `null` when not set up. */
  outputFolder: RepoRelativePath.nullable(),
  /** The pinned upstream version (`bmad-lock.json`, AD-13; the name is kept from when it was bundled). */
  bundledVersion: z.string().min(1),
  /** The version installed in the project, `null` when none is. */
  installedVersion: z.string().min(1).nullable(),
  /** What couldn't be read, in plain words. */
  problems: z.array(z.string()),
  /**
   * The capabilities the pieces that are on need and the project's BMad
   * Method lacks (entry 4.11, AD-14), each with its reduced-mode notice.
   * Absent for `not_set_up` and in payloads stored before 4.11.
   */
  missingCapabilities: z.array(BmadCapability).optional(),
});
export type BmadSetupStatus = z.infer<typeof BmadSetupStatus>;

/** `GET /api/v1/workspaces/:wsId/bmad/setup`: the project's setup status. */
export const BmadSetupStatusResponse = z.object({ setup: BmadSetupStatus });
export type BmadSetupStatusResponse = z.infer<typeof BmadSetupStatusResponse>;

/**
 * `POST /api/v1/workspaces/:wsId/bmad/setup` → 202: whether a setup started
 * (`false` when one is already running), and the status now. Progress
 * arrives as `bmad.setup_*` events on the workspace's stream.
 */
export const BmadSetupStartedResponse = z.object({ started: z.boolean(), setup: BmadSetupStatus });
export type BmadSetupStartedResponse = z.infer<typeof BmadSetupStartedResponse>;

/**
 * `POST /api/v1/workspaces/:wsId/bmad/setup`'s optional body (entry 4.11):
 * `upgrade: true` is Upgrade this project, which runs the setup in a project
 * that already has `_bmad/` (adding what is missing, repairing BMad
 * Method's scripts, keeping its settings and every existing skill). No body
 * (or `{}`) is Set up, unchanged.
 */
export const BmadSetupStartRequest = z.object({ upgrade: z.boolean().optional() }).strict();
export type BmadSetupStartRequest = z.infer<typeof BmadSetupStartRequest>;

/** The steps a setup reports, in order, each with its line in the progress list. */
export const BMAD_SETUP_STEPS = ['checking', 'copying_skills', 'writing_config', 'verifying'] as const;
export type BmadSetupStep = (typeof BMAD_SETUP_STEPS)[number];
export const BMAD_SETUP_STEP_LABELS: Readonly<Record<BmadSetupStep, string>> = {
  checking: 'Checking the project',
  copying_skills: 'Copying the BMad Method skills',
  writing_config: "Writing the project's BMad Method settings",
  verifying: 'Checking the setup',
};

/** One setup step as `bmad.setup_progress` carries it: a snake_case code and its plain label. */
export const BmadSetupProgress = z.object({ step: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), label: z.string().min(1) });
export type BmadSetupProgress = z.infer<typeof BmadSetupProgress>;

// ---- The per-project script trust (story 4.2, user decision 2026-10-02) ----

/** `scripts_not_trusted` (409): a route that runs the project's BMad Method scripts before the user allowed it. */
export const SCRIPTS_NOT_TRUSTED_MESSAGE =
  "Ogden Agents needs your OK before it runs this project's BMad Method scripts. Allow it on the Board page, then try again.";
/** The trust prompt's and the confirm dialog's title. */
export const SCRIPT_TRUST_TITLE = "Run this project's BMad Method scripts?";
/** The trust prompt's sentence: what runs, and what it never gets. */
export const SCRIPT_TRUST_TEXT =
  "Board reads your tickets by running the BMad Method scripts in this project's folder, on your computer. They run without your API keys or tokens. Allow this only for a project you trust.";
/** The button that allows it, once for this project. */
export const SCRIPT_TRUST_ALLOW = 'Allow';
/** The dialog's button that changes nothing. */
export const SCRIPT_TRUST_CANCEL = 'Cancel';
/**
 * `scripts_changed` (409; story 4.13, user decision 2026-10-04): the
 * project's BMad Method scripts aren't the ones the user allowed.
 */
export const SCRIPTS_CHANGED_MESSAGE =
  "This project's BMad Method scripts changed since you allowed them, so Ogden Agents didn't run them. Allow them again on the Board page, then try again.";
/** The trust prompt's title when the scripts changed since the user allowed them. */
export const SCRIPT_TRUST_CHANGED_TITLE = "This project's BMad Method scripts changed. Run them?";
/** The trust prompt's sentence when the scripts changed. */
export const SCRIPT_TRUST_CHANGED_TEXT =
  "The BMad Method scripts in this project's folder aren't the ones you allowed: something changed them since. Board runs them on your computer, without your API keys or tokens. Allow this only if you know why they changed.";
/** The fallback when allowing couldn't be saved. */
export const SCRIPT_TRUST_FAILED = "Ogden Agents couldn't save your answer. Try again.";

// ---- The pinned upstream BMad Method (story 4.14, AD-13) ----

/**
 * Whether this install has its pinned BMad Method downloaded and verified in
 * its data folder:
 * - `missing`: not downloaded (or downloaded for another pin, before an upgrade);
 * - `downloading`: a download the user asked for is running;
 * - `ready`: the exact pinned commit is there, verified.
 */
export const BMAD_SOURCE_STATES = ['missing', 'downloading', 'ready'] as const;
export const BmadSourceState = z.enum(BMAD_SOURCE_STATES);
export type BmadSourceState = z.infer<typeof BmadSourceState>;

/** The pinned BMad Method's state, its version as upstream names it, and the full commit it is pinned to. */
export const BmadSourceStatus = z.object({
  state: BmadSourceState,
  version: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
});
export type BmadSourceStatus = z.infer<typeof BmadSourceStatus>;

/** `GET` and `POST /api/v1/bmad/source`: the status itself (after a download, `ready`). */
export const BmadSourceResponse = BmadSourceStatus;
export type BmadSourceResponse = BmadSourceStatus;

/** A GitHub `owner/name`. */
const GitHubRepo = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
/** A full commit SHA. */
const CommitSha = z.string().regex(/^[0-9a-f]{40}$/);

/**
 * One pinned source in the lock (`bmad-lock.json`): repo, the ref its commit is reachable from, and the content hash
 * of `include`. Since the maintained-fork story (user decision 2026-10-04) the repo is Ogden Agents' fork, and `base`
 * names the upstream commit the fork's commit is built on (CI checks both).
 */
export const BmadLockSource = z.object({
  /** GitHub `owner/name`. */
  repo: GitHubRepo,
  /** The branch or tag the commit must be in the history of (CI checks it); for the fork, a tag that never moves. */
  ref: z.string().min(1),
  /** The full commit SHA. */
  commit: CommitSha,
  /** The upstream commit the pinned commit is built on: in `ref`'s history of `repo` upstream, and an ancestor of `commit` (CI checks both). */
  base: z.object({ repo: GitHubRepo, ref: z.string().min(1), commit: CommitSha }).optional(),
  /** The version as upstream names it at that commit. */
  version: z.string().min(1),
  /** The folder of the tree that is used, ending in `/`, or `''` for the whole tree. */
  include: z
    .string()
    .regex(/^(?:[A-Za-z0-9_.-]+\/)*$/)
    .refine((include) => include.split('/').every((segment) => segment !== '.' && segment !== '..'), 'A folder inside the tree, without . or .. segments.'),
  /** `sha256:<hex>` over the selected files' paths and LF-normalized contents. */
  contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type BmadLockSource = z.infer<typeof BmadLockSource>;

/** The lock: every pinned upstream source, by name. */
export const BmadLock = z.object({ sources: z.object({ 'bmad-method': BmadLockSource }) });
export type BmadLock = z.infer<typeof BmadLock>;

/** `bmad_not_downloaded` (409): a surface that runs BMad Method's scripts was used before the pinned BMad Method was downloaded. */
export const BMAD_NOT_DOWNLOADED_MESSAGE = 'Ogden Agents needs to download BMad Method first. Download it, then try again.';
/** `bmad_download_failed` (503): the download didn't arrive (offline, an HTTP error, too slow or too large). */
export const BMAD_DOWNLOAD_OFFLINE_MESSAGE = "Ogden Agents couldn't download BMad Method. Check your internet connection, then try again.";
/** `bmad_download_failed` (502): what arrived isn't the pinned BMad Method, so nothing was saved. */
export const BMAD_DOWNLOAD_INTEGRITY_MESSAGE =
  "The BMad Method download didn't match the version this Ogden Agents release expects, so nothing was saved. Try again later.";
/** The Board's notice when BMad Method isn't downloaded yet. */
export const BMAD_NOT_DOWNLOADED_TEXT = 'Board runs BMad Method, which Ogden Agents downloads once from GitHub and checks before it uses it.';
/** The button that downloads it. */
export const BMAD_DOWNLOAD_LABEL = 'Download BMad Method';
/** Said while it downloads. */
export const BMAD_DOWNLOADING_TEXT = 'Downloading BMad Method';

// ---- Document cards and the next suggested step (story 4.7) ----

/** The most of a document `GET …/documents` answers, in bytes: a longer one is cut there (`truncated: true`). */
export const MAX_DOCUMENT_BYTES = 1024 * 1024;

/** A document as `GET …/documents` answers it: its path, its text (at most {@link MAX_DOCUMENT_BYTES}) and whether it was cut. */
export const PlanningDocument = z.object({ path: RepoRelativePath, content: z.string(), truncated: z.boolean() });
export type PlanningDocument = z.infer<typeof PlanningDocument>;

/** `GET /api/v1/workspaces/:wsId/documents?path=`: one document a planning session wrote. */
export const DocumentResponse = z.object({ document: PlanningDocument });
export type DocumentResponse = z.infer<typeof DocumentResponse>;

/** `invalid_request` (400): the path isn't a Markdown file inside the project's output folder. */
export const DOCUMENT_INVALID_PATH_MESSAGE = "That isn't a Markdown document in this project's output folder.";
/** The document sheet when the file is gone (404). */
export const DOCUMENT_NOT_FOUND_TEXT = "This document isn't there any more. It may have been moved or deleted.";
/** The fallback when a document couldn't be loaded. */
export const DOCUMENT_LOAD_FAILED = "Ogden Agents couldn't open this document";
/** Said while a document loads. */
export const DOCUMENT_LOADING_TEXT = 'Loading the document';
/** Said above a document cut at {@link MAX_DOCUMENT_BYTES}. */
export const DOCUMENT_TRUNCATED_TEXT = 'This document is long, so only its first part is shown.';
/** The fallback when the next suggested step couldn't be started. */
export const DOCUMENT_NEXT_FAILED = "Ogden Agents couldn't start the next step";
/** The document card's caption over its file name. */
export const DOCUMENT_CARD_CAPTION = 'Document written';

/** A document card's accessible name ("Document spec-x.md"). */
export function documentCardLabel(name: string): string {
  return `Document ${name}`;
}

/** A document's file name: the last segment of its repo-relative path. */
export function documentFileName(path: string): string {
  return path.split('/').filter((segment) => segment !== '').at(-1) ?? path;
}
