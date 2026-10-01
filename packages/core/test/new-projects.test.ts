/**
 * The app-wide default for new projects and adding a project with it
 * (CAP-19, AD-22; story 10.4): the preferences file (missing or corrupt reads
 * as Simple, kept 0600 and replaced in one step), the availability check on
 * a newly-on piece, and the pieces a new workspace starts with, written in
 * the transaction that creates it.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BMAD_PIECES, type BmadPiece } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  applicableDefaultPieces,
  createAddProject,
  createNewProjectDefaults,
  FeatureUnavailableError,
  PREFERENCES_FILE,
  ValidationError,
  type Core,
} from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

function store(available: readonly BmadPiece[] = []) {
  const dataDir = tempDir();
  const codes: string[] = [];
  const defaults = createNewProjectDefaults({ dataDir, bmad: { isAvailable: (piece) => available.includes(piece) }, onError: (code) => codes.push(code) });
  return { dataDir, file: join(dataDir, PREFERENCES_FILE), defaults, codes };
}

function adding(core: Core, defaults?: { get(): { bmadPieces: BmadPiece[] } }) {
  return createAddProject({
    chat: { openWorkspace: (path, options) => core.entities.ensureWorkspace(path, options) },
    defaults,
    bmad: core.bmad,
  });
}

describe('the new-projects default (story 10.4)', () => {
  it('reads as Simple with no file, and writes nothing', () => {
    const { defaults, file, codes } = store();
    expect(defaults.get()).toEqual({ bmadPieces: [] });
    expect(existsSync(file)).toBe(false);
    expect(codes).toEqual([]);
  });

  it('keeps a default 0600, replaced in one step, and reads it back in canonical order', () => {
    const { defaults, file, dataDir } = store(['planning', 'board']);
    expect(defaults.set({ bmadPieces: ['board', 'planning'] })).toEqual({ bmadPieces: ['planning', 'board'] });
    expect(defaults.get()).toEqual({ bmadPieces: ['planning', 'board'] });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ newProjects: { bmadPieces: ['planning', 'board'] } });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(join(dataDir, `${PREFERENCES_FILE}.${process.pid}.tmp`))).toBe(false);
  });

  it('reads a corrupt file as Simple, reports only the code once while it stays corrupt, and leaves it as it is', () => {
    const { defaults, file, codes } = store();
    writeFileSync(file, '{nope');
    for (let i = 0; i < 3; i++) expect(defaults.get()).toEqual({ bmadPieces: [] });
    writeFileSync(file, JSON.stringify({ newProjects: { bmadPieces: ['builds'] } }));
    expect(defaults.get()).toEqual({ bmadPieces: [] });
    writeFileSync(file, JSON.stringify({ newProjects: { bmadPieces: ['nope'] } }));
    expect(defaults.get()).toEqual({ bmadPieces: [] });
    expect(codes).toEqual(['corrupt']);
    expect(readFileSync(file, 'utf8')).toContain('nope');
  });

  it('reports an unreadable file by its code once while it stays unreadable, and again after it was readable', () => {
    const { defaults, file, codes } = store();
    mkdirSync(file);
    for (let i = 0; i < 3; i++) expect(defaults.get()).toEqual({ bmadPieces: [] });
    expect(codes).toEqual(['EISDIR']);
    rmSync(file, { recursive: true });
    expect(defaults.get()).toEqual({ bmadPieces: [] });
    mkdirSync(file);
    expect(defaults.get()).toEqual({ bmadPieces: [] });
    expect(codes).toEqual(['EISDIR', 'EISDIR']);
  });

  it('refuses a newly-on unavailable piece with feature_unavailable and a broken rule or unknown piece with a validation error, writing nothing', () => {
    const { defaults, file } = store(['planning']);
    expect(() => defaults.set({ bmadPieces: ['board'] })).toThrow(FeatureUnavailableError);
    expect(() => defaults.set({ bmadPieces: ['builds'] })).toThrow(ValidationError);
    expect(() => defaults.set({ bmadPieces: ['nope'] })).toThrow(ValidationError);
    expect(() => defaults.set({ bmadPieces: ['planning', 'planning'] })).toThrow(ValidationError);
    expect(() => defaults.set('nope')).toThrow(ValidationError);
    expect(existsSync(file)).toBe(false);
  });

  it('keeps a stored piece that is no longer available when the default changes otherwise', () => {
    const { defaults, file } = store(['planning']);
    writeFileSync(file, JSON.stringify({ newProjects: { bmadPieces: ['board'] } }));
    expect(defaults.set({ bmadPieces: ['planning', 'board'] })).toEqual({ bmadPieces: ['planning', 'board'] });
  });

  it('drops pieces no longer available, then pieces whose needs are off', () => {
    expect(applicableDefaultPieces(['board', 'builds'], (piece) => piece === 'planning')).toEqual([]);
    expect(applicableDefaultPieces(['board', 'builds', 'retrospectives'], (piece) => piece !== 'builds')).toEqual(['board']);
    expect(applicableDefaultPieces(['planning', 'board'], () => true)).toEqual(['planning', 'board']);
  });
});

describe('adding a project (story 10.4)', () => {
  it('with no default, a new project starts Simple and only workspace.created is appended', () => {
    const core = openTestCore(undefined, undefined, { availableBmadPieces: BMAD_PIECES });
    const before = core.events.lastSeq();
    const workspace = adding(core).addProject(tempDir('ogden-agents-repo-'));
    expect(core.bmad.pieces(workspace.id)).toEqual([]);
    expect(core.events.readAfter(before).map((event) => event.type)).toEqual(['workspace.created']);
  });

  it('applies the default: the row has its pieces, and settings_changed follows workspace.created', () => {
    const core = openTestCore(undefined, undefined, { availableBmadPieces: ['planning'] });
    const before = core.events.lastSeq();
    const workspace = adding(core, { get: () => ({ bmadPieces: ['planning'] }) }).addProject(tempDir('ogden-agents-repo-'));
    expect(core.bmad.pieces(workspace.id)).toEqual(['planning']);
    expect(core.permissions.getSettings(workspace.id)).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: ['planning'] });
    const appended = core.events.readAfter(before);
    expect(appended.map((event) => event.type)).toEqual(['workspace.created', 'workspace.settings_changed']);
    expect(appended[1]).toMatchObject({
      workspaceId: workspace.id,
      streamId: workspace.id,
      payload: { cautionLevel: 'ask_every_time', previous: 'ask_every_time', bmadPieces: ['planning'], previousBmadPieces: [] },
    });
  });

  it('given pieces win over the default, which is not changed', () => {
    const core = openTestCore(undefined, undefined, { availableBmadPieces: ['planning', 'board'] });
    const { defaults } = store(['planning', 'board']);
    const workspace = adding(core, defaults).addProject(tempDir('ogden-agents-repo-'), ['planning', 'board']);
    expect(core.bmad.pieces(workspace.id)).toEqual(['planning', 'board']);
    expect(defaults.get()).toEqual({ bmadPieces: [] });
    const simple = adding(core, { get: () => ({ bmadPieces: ['planning'] }) }).addProject(tempDir('ogden-agents-repo-'), []);
    expect(core.bmad.pieces(simple.id)).toEqual([]);
  });

  it('given pieces this install does not ship refuse with feature_unavailable and create nothing; a broken rule is a validation error', () => {
    const core = openTestCore(undefined, undefined, { availableBmadPieces: ['planning'] });
    const before = core.events.lastSeq();
    const repo = tempDir('ogden-agents-repo-');
    expect(() => adding(core).addProject(repo, ['board'])).toThrow(FeatureUnavailableError);
    expect(() => adding(core).addProject(repo, ['builds'])).toThrow(ValidationError);
    expect(core.entities.listWorkspaces()).toEqual([]);
    expect(core.events.lastSeq()).toBe(before);
  });

  it('returns an existing project unchanged, ignoring the pieces, with no event', () => {
    const core = openTestCore(undefined, undefined, { availableBmadPieces: ['planning'] });
    const repo = tempDir('ogden-agents-repo-');
    const first = adding(core).addProject(repo);
    const before = core.events.lastSeq();
    const add = adding(core, { get: () => ({ bmadPieces: ['planning'] }) });
    expect(add.addProject(repo)).toEqual(first);
    expect(add.addProject(repo, ['board'])).toEqual(first);
    expect(core.bmad.pieces(first.id)).toEqual([]);
    expect(core.events.lastSeq()).toBe(before);
  });

  it('a default no longer shipped gives a new project only what still works', () => {
    const core = openTestCore(undefined, undefined, { availableBmadPieces: ['planning'] });
    const workspace = adding(core, { get: () => ({ bmadPieces: ['board', 'builds'] }) }).addProject(tempDir('ogden-agents-repo-'));
    expect(core.bmad.pieces(workspace.id)).toEqual([]);
  });
});
