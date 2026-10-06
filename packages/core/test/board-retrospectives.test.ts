/**
 * Each epic's retrospective on the board's tree (epic 7, story 7.4): read
 * only with Retrospectives on, from the epic's folder through the catalog
 * port, the frontmatter's verdict and date alone; with the piece off nothing
 * is read and every epic's is `null`, whatever the store said; an unreadable
 * file leaves the notice, a missing one `null`; a piece turned off during the
 * reads gives nothing of it.
 */
import { TicketEpic, type BmadPiece, type TicketsResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createBmadSource, createBoard, type BmadCatalogPort, type BmadSourcePort, type Core, type TicketStorePort } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const epic = (slug: string, retrospective: unknown = null) => TicketEpic.parse({ slug, id: null, status: 'active', after: [], blocks: [], retrospective });
const TREE: TicketsResponse = { tickets: [], problems: [], folder: 'initiative-demo', epics: [epic('epic-a'), epic('epic-b'), epic('epic-c')] };
const FILES: Record<string, string> = {
  '_bmad-output/initiative-demo/epic-a': '---\nverdict: accepted\ndate: 2026-10-05\n---\n',
  '_bmad-output/initiative-demo/epic-b': '---\nverdict: [broken\n---\n',
};

function setup(pieces: BmadPiece[] = ['board', 'retrospectives'], onRead: () => void = () => {}) {
  const core: Core = openTestCore(tempDir(), undefined, { availableBmadPieces: ['planning', 'board', 'builds', 'retrospectives'] });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  core.permissions.updateSettings(workspace.id, { bmadPieces: pieces });
  const asked: string[] = [];
  const catalog = {
    detect: async () => ({ hasBmad: true, hasOutput: true }),
    missingCapabilities: async () => [],
    setupStatus: async () => ({ state: 'current', outputFolder: '_bmad-output', bundledVersion: '7', installedVersion: '7', problems: [] }),
    readRetrospective: async (_repo: string, _out: string, folder: string) => {
      asked.push(folder);
      onRead();
      const content = FILES[folder];
      return content === undefined ? null : { path: `${folder}/x-retrospective.md`, content };
    },
  } as unknown as BmadCatalogPort;
  const tickets = { tree: async () => structuredClone(TREE) } as unknown as TicketStorePort;
  const source: BmadSourcePort = { status: () => ({ state: 'ready', version: '1', commit: 'a'.repeat(40) }), download: () => Promise.reject(new Error('no')), file: () => undefined };
  return { core, workspace, asked, board: createBoard({ bmad: core.bmad, trust: core.bmadScriptTrust, source: createBmadSource(source), entities: core.entities, catalog, tickets }) };
}

async function trusted(s: ReturnType<typeof setup>) {
  await s.core.bmadScriptTrust.trustScripts(s.workspace.id);
  return s;
}

describe('the board\'s epics with their retrospectives (story 7.4)', () => {
  it('give each epic its verdict and date, the notice for an unreadable one, and null for none', async () => {
    const s = await trusted(setup());
    const { epics } = await s.board.tickets(s.workspace.id);
    expect(epics.map((each) => [each.slug, each.retrospective?.verdict ?? null, each.retrospective?.date ?? null, each.retrospective?.problem ?? null])).toEqual([
      ['epic-a', 'accepted', '2026-10-05', null],
      ['epic-b', null, null, expect.stringContaining('no verdict')],
      ['epic-c', null, null, null],
    ]);
    expect(epics[2]!.retrospective).toBeNull();
    expect(s.asked).toEqual(['_bmad-output/initiative-demo/epic-a', '_bmad-output/initiative-demo/epic-b', '_bmad-output/initiative-demo/epic-c']);
  });

  it('with Retrospectives off reads nothing and clears whatever the store said', async () => {
    const s = await trusted(setup(['board']));
    const { epics } = await s.board.tickets(s.workspace.id);
    expect(epics.every((each) => each.retrospective === null)).toBe(true);
    expect(s.asked).toEqual([]);
  });

  it('a Retrospectives turned off during the reads gives nothing of it', async () => {
    const holder: { off: () => void } = { off: () => {} };
    const s = await trusted(setup(['board', 'retrospectives'], () => holder.off()));
    holder.off = () => s.core.permissions.updateSettings(s.workspace.id, { bmadPieces: ['board'] });
    const { epics } = await s.board.tickets(s.workspace.id);
    expect(epics.every((each) => each.retrospective === null)).toBe(true);
  });
});
