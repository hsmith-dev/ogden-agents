/**
 * Core's BMad detection and Not now (story 10.3): detection combines the
 * port's answer about the workspace's stored real path with the per-project
 * Not now; Not now is kept on the workspace row with one
 * `workspace.bmad_offer_dismissed` in the same transaction, idempotently,
 * across a restart; an unknown workspace is `NotFoundError`.
 */
import type { WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { NotFoundError, type BmadCatalogPort } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const UNKNOWN = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId;

/** A port that answers `answers[path]` and records each path it was asked about. */
function fakeCatalog(answers: Record<string, { hasBmad: boolean; hasOutput: boolean }>): BmadCatalogPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    detect: async (repoPath) => {
      calls.push(repoPath);
      return answers[repoPath] ?? { hasBmad: false, hasOutput: false };
    },
    skills: async () => [],
  };
}

describe('BMad detection (story 10.3)', () => {
  it("asks the port about the workspace's stored real path and adds the offer answer", async () => {
    const repo = tempDir('ogden-agents-repo-');
    const bare = tempDir('ogden-agents-repo-');
    const probe = openTestCore();
    const real = probe.entities.ensureWorkspace(repo).realPath!;
    const realBare = probe.entities.ensureWorkspace(bare).realPath!;
    probe.close();

    const catalog = fakeCatalog({ [real]: { hasBmad: true, hasOutput: true } });
    const core = openTestCore(undefined, undefined, { bmadCatalog: catalog });
    const workspace = core.entities.ensureWorkspace(repo);
    const plain = core.entities.ensureWorkspace(bare);
    expect(await core.bmadDetection.detect(workspace.id)).toEqual({ hasBmad: true, hasOutput: true, offerDismissed: false });
    expect(await core.bmadDetection.detect(plain.id)).toEqual({ hasBmad: false, hasOutput: false, offerDismissed: false });
    expect(catalog.calls).toEqual([real, realBare]);
  });

  it('answers both false with no catalog wired, and NotFoundError for an unknown workspace', async () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    expect(await core.bmadDetection.detect(workspace.id)).toEqual({ hasBmad: false, hasOutput: false, offerDismissed: false });
    await expect(core.bmadDetection.detect(UNKNOWN)).rejects.toThrow(NotFoundError);
    const before = core.events.lastSeq();
    expect(() => core.bmadDetection.dismissOffer(UNKNOWN)).toThrow(NotFoundError);
    expect(core.events.lastSeq()).toBe(before);
  });

  it('Not now is kept with one event, a repeat changes nothing, and it survives a restart', async () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir, undefined, { bmadCatalog: { detect: async () => ({ hasBmad: true, hasOutput: false }), skills: async () => [] } });
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const other = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));

    const before = core.events.lastSeq();
    core.bmadDetection.dismissOffer(workspace.id);
    expect(core.events.readAfter(before)).toEqual([
      expect.objectContaining({ type: 'workspace.bmad_offer_dismissed', workspaceId: workspace.id, streamId: workspace.id, payload: {} }),
    ]);
    const once = core.events.lastSeq();
    core.bmadDetection.dismissOffer(workspace.id);
    expect(core.events.lastSeq()).toBe(once);

    expect(await core.bmadDetection.detect(workspace.id)).toEqual({ hasBmad: true, hasOutput: false, offerDismissed: true });
    // Per project: another workspace still has its offer.
    expect((await core.bmadDetection.detect(other.id)).offerDismissed).toBe(false);
    // Not now changes no setting.
    expect(core.permissions.getSettings(workspace.id).bmadPieces).toEqual([]);

    core.close();
    const reopened = openTestCore(dataDir);
    expect(await reopened.bmadDetection.detect(workspace.id)).toEqual({ hasBmad: false, hasOutput: false, offerDismissed: true });
  });
});
