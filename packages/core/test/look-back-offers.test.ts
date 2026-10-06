/**
 * The finished-epic offer's Not now in core (story 7.2): behind the
 * Retrospectives guard, kept per project and epic on the workspace row,
 * one event per epic in the same transaction, a repeat changes nothing, and
 * the list is bounded.
 */
import type { WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { FeatureOffError, MAX_DISMISSED_OFFERS, NotFoundError, ValidationError, type Core } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const UNKNOWN = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId;

function setup(pieces: Array<'planning' | 'board' | 'builds' | 'retrospectives'> = ['board', 'retrospectives']) {
  const core: Core = openTestCore(tempDir(), undefined, { availableBmadPieces: ['planning', 'board', 'builds', 'retrospectives'] });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  if (pieces.length > 0) core.permissions.updateSettings(workspace.id, { bmadPieces: pieces });
  const dismissals = () => core.events.readAfter(0).filter((event) => event.type === 'workspace.look_back_offer_dismissed');
  return { core, workspace, dismissals };
}

describe('look-back offers (story 7.2)', () => {
  it('keeps each dismissal once, in order, with one event each', () => {
    const { core, workspace, dismissals } = setup();
    expect(core.lookBackOffers.dismissed(workspace.id)).toEqual([]);
    core.lookBackOffers.dismiss(workspace.id, 'epic-b');
    core.lookBackOffers.dismiss(workspace.id, 'epic-a');
    core.lookBackOffers.dismiss(workspace.id, 'epic-b');
    expect(core.lookBackOffers.dismissed(workspace.id)).toEqual(['epic-b', 'epic-a']);
    expect(dismissals().map((event) => event.payload)).toEqual([{ epic: 'epic-b' }, { epic: 'epic-a' }]);
  });

  it('is per project', () => {
    const { core, workspace } = setup();
    const other = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(other.id, { bmadPieces: ['board', 'retrospectives'] });
    core.lookBackOffers.dismiss(workspace.id, 'epic-a');
    expect(core.lookBackOffers.dismissed(other.id)).toEqual([]);
  });

  it('with Retrospectives off (Board or Planning on) refuses with feature_off and writes nothing', () => {
    for (const pieces of [[], ['board'], ['planning', 'board', 'builds'] as const]) {
      const { core, workspace, dismissals } = setup([...pieces] as Parameters<typeof setup>[0]);
      const before = core.events.lastSeq();
      expect(() => core.lookBackOffers.dismissed(workspace.id)).toThrow(FeatureOffError);
      expect(() => core.lookBackOffers.dismiss(workspace.id, 'epic-a')).toThrow(FeatureOffError);
      expect(core.events.lastSeq()).toBe(before);
      expect(dismissals()).toEqual([]);
    }
  });

  it('refuses a malformed epic name and an unknown workspace, writing nothing', () => {
    const { core, workspace, dismissals } = setup();
    for (const bad of ['', '../x', 'a/b', '-x', 'a'.repeat(129)]) expect(() => core.lookBackOffers.dismiss(workspace.id, bad), bad).toThrow(ValidationError);
    expect(() => core.lookBackOffers.dismiss(UNKNOWN, 'epic-a')).toThrow(NotFoundError);
    expect(() => core.lookBackOffers.dismissed(UNKNOWN)).toThrow(NotFoundError);
    expect(dismissals()).toEqual([]);
  });

  it('keeps the newest answers past the bound', () => {
    const { core, workspace } = setup();
    for (let i = 0; i < MAX_DISMISSED_OFFERS + 3; i++) core.lookBackOffers.dismiss(workspace.id, `epic-${i}`);
    const kept = core.lookBackOffers.dismissed(workspace.id);
    expect(kept).toHaveLength(MAX_DISMISSED_OFFERS);
    expect(kept[0]).toBe('epic-3');
    expect(kept.at(-1)).toBe(`epic-${MAX_DISMISSED_OFFERS + 2}`);
  });
});
