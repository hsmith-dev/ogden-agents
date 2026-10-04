/**
 * The app-wide default for new projects and adding a project with it
 * (CAP-19, AD-22; story 10.4).
 *
 * The default is an install-level preference kept in
 * `<dataDir>/preferences.json` (like `onboarding.json`): readable only by the
 * user, replaced in one step, never in SQLite, browser storage or a user's
 * repo. A missing, unreadable or invalid file reads as Simple (every piece
 * off), reported by its code only (once per run while it stays corrupt) and
 * left as it is.
 *
 * Adding a project applies the given pieces (Welcome's first-project answer)
 * or else the default, on the new workspace's row in the transaction that
 * creates it; an existing project is returned unchanged.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BMAD_PIECE_INFO,
  BmadPieceSet,
  canonicalBmadPieces,
  DEFAULT_NEW_PROJECT_DEFAULTS,
  NewProjectDefaults as NewProjectDefaultsSchema,
  UpdateNewProjectDefaultsRequest,
  type AgentId,
  type BmadPiece,
  type NewProjectDefaults,
  type Workspace,
} from '@ogden-agents/shared';
import { z } from 'zod';
import type { BmadFeatures } from './bmad-pieces.js';
import type { Chat } from './chat/types.js';
import { FeatureUnavailableError, UnknownAgentError, ValidationError } from './errors.js';

/** `<dataDir>/<this>`: `{ "newProjects": { "bmadPieces": [...], "defaultAgentId"?: "..." } }`. */
export const PREFERENCES_FILE = 'preferences.json';

/** The preferences record. Other install-level preferences can join it later. */
const PreferencesRecord = z.object({ newProjects: NewProjectDefaultsSchema });
type PreferencesRecord = z.infer<typeof PreferencesRecord>;

export interface NewProjectDefaultsOptions {
  /** The Ogden Agents data folder. */
  dataDir: string;
  /** What this install ships: a piece is turned on in the default only when available. */
  bmad: Pick<BmadFeatures, 'isAvailable'>;
  /**
   * Whether an agent is registered (epic 6, entry 6), so it may be the
   * default agent for new projects. Absent: every well-formed id.
   */
  isAgentRegistered?: ((agentId: AgentId) => boolean) | undefined;
  /** A record that exists but can't be read or parsed: its code only. */
  onError?(code: string): void;
}

export interface NewProjectDefaultsStore {
  /** The default as kept (Simple, `[]`, when there is no usable record). */
  get(): NewProjectDefaults;
  /**
   * Validates and keeps `input` (`UpdateNewProjectDefaultsRequest`: the
   * pieces and/or the default agent, `null` for the install's default); what
   * it leaves out is kept. Throws `ValidationError` for a wrong shape or a
   * broken dependency rule, `FeatureUnavailableError` for a piece not in the
   * kept default that this install doesn't ship, and `UnknownAgentError` for
   * an agent this install doesn't have; nothing is written then.
   */
  set(input: unknown): NewProjectDefaults;
}

export function createNewProjectDefaults(options: NewProjectDefaultsOptions): NewProjectDefaultsStore {
  const file = join(options.dataDir, PREFERENCES_FILE);
  const isAgentRegistered = options.isAgentRegistered ?? (() => true);

  const write = (record: PreferencesRecord) => {
    mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      if (process.platform !== 'win32') chmodSync(temp, 0o600);
      renameSync(temp, file);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  };

  /** The failure last reported (a code, or `corrupt`): each is reported once per run while it persists. */
  let reported: string | undefined;
  const report = (code: string) => {
    if (reported === code) return;
    reported = code;
    options.onError?.(code);
  };

  const read = (): NewProjectDefaults => {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'unreadable';
      if (code === 'ENOENT') reported = undefined;
      else report(code);
      return { bmadPieces: [...DEFAULT_NEW_PROJECT_DEFAULTS.bmadPieces] };
    }
    try {
      const parsed = PreferencesRecord.safeParse(JSON.parse(text));
      if (parsed.success) {
        reported = undefined;
        const agent = parsed.data.newProjects.defaultAgentId;
        // An agent this install no longer has reads as the install's default (the file keeps it).
        return { bmadPieces: canonicalBmadPieces(parsed.data.newProjects.bmadPieces), ...(agent !== undefined && isAgentRegistered(agent) ? { defaultAgentId: agent } : {}) };
      }
    } catch {
      // Not JSON: as if there were no record.
    }
    // Left as it is: the file is the user's to inspect.
    report('corrupt');
    return { bmadPieces: [...DEFAULT_NEW_PROJECT_DEFAULTS.bmadPieces] };
  };

  return {
    get: read,
    set(input) {
      const parsed = UpdateNewProjectDefaultsRequest.safeParse(input);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? 'Choose BMad Method features this version has.', [
          { path: ['bmadPieces'], message: 'unknown or repeated piece, or dependency rule' },
        ]);
      }
      const current = read();
      const kept = current.bmadPieces;
      const pieces = parsed.data.bmadPieces === undefined ? kept : canonicalBmadPieces(parsed.data.bmadPieces);
      // A piece is turned on only when this install ships it (AD-22); one already in the default is kept.
      const unavailable = pieces.find((piece) => !kept.includes(piece) && !options.bmad.isAvailable(piece));
      if (unavailable !== undefined) throw new FeatureUnavailableError(unavailable);
      const agent = parsed.data.defaultAgentId;
      if (agent !== undefined && agent !== null && !isAgentRegistered(agent)) throw new UnknownAgentError();
      const defaultAgentId = agent === undefined ? current.defaultAgentId : (agent ?? undefined);
      const defaults: NewProjectDefaults = { bmadPieces: pieces, ...(defaultAgentId === undefined ? {} : { defaultAgentId }) };
      write({ newProjects: defaults });
      return defaults;
    },
  };
}

/**
 * The pieces a new project gets from the default: those this install ships,
 * then only those whose needs are all still on (the dependency rule holds).
 */
export function applicableDefaultPieces(pieces: readonly BmadPiece[], isAvailable: (piece: BmadPiece) => boolean): BmadPiece[] {
  const kept: BmadPiece[] = [];
  // Canonical order puts every need before what needs it, so one pass drops what can't work.
  for (const piece of canonicalBmadPieces(pieces)) {
    if (isAvailable(piece) && BMAD_PIECE_INFO[piece].needs.every((need) => kept.includes(need))) kept.push(piece);
  }
  return kept;
}

export interface AddProjectOptions {
  chat: Pick<Chat, 'openWorkspace'>;
  /** The app-wide default; without it a new project starts Simple. */
  defaults?: Pick<NewProjectDefaultsStore, 'get'> | undefined;
  /** What this install ships; without it nothing is available. */
  bmad?: Pick<BmadFeatures, 'isAvailable'> | undefined;
}

export interface AddProject {
  /**
   * The project for the repo at `path` (as `Chat.openWorkspace`). A new one
   * starts with `bmadPieces` when given, otherwise with the app-wide default
   * (minus what this install no longer ships). Given pieces are checked:
   * `ValidationError` for a wrong shape or broken rule, and
   * `FeatureUnavailableError` for one this install doesn't ship; nothing is
   * created then. An existing project is returned unchanged.
   */
  addProject(path: string, bmadPieces?: readonly BmadPiece[]): Workspace;
}

export function createAddProject(options: AddProjectOptions): AddProject {
  const isAvailable = (piece: BmadPiece) => options.bmad?.isAvailable(piece) ?? false;
  return {
    addProject(path, bmadPieces) {
      const resolve = (): readonly BmadPiece[] => {
        if (bmadPieces === undefined) return applicableDefaultPieces(options.defaults?.get().bmadPieces ?? [], isAvailable);
        const parsed = BmadPieceSet.safeParse(bmadPieces);
        if (!parsed.success) {
          throw new ValidationError(parsed.error.issues[0]?.message ?? 'Choose BMad Method features this version has.', [
            { path: ['bmadPieces'], message: 'unknown or repeated piece, or dependency rule' },
          ]);
        }
        const unavailable = parsed.data.find((piece) => !isAvailable(piece));
        if (unavailable !== undefined) throw new FeatureUnavailableError(unavailable);
        return parsed.data;
      };
      // Called only when the workspace is created, inside its transaction: a refusal creates nothing,
      // and an existing project ignores the pieces and the agent. The default agent for new projects
      // (epic 6, entry 6) is read as registered only, so a gone agent leaves the project on the install's.
      return options.chat.openWorkspace(path, { bmadPieces: resolve, defaultAgentId: () => options.defaults?.get().defaultAgentId });
    },
  };
}
