/**
 * When each BMad Method module first appeared (story 4.4): the first catalog
 * read that finds any module is the baseline (`installedAt` `null`); a
 * module first seen later gets that read's time, on it and its skills; a
 * catalog that gives `installedAt` keeps it; records are per workspace and
 * stay when a module goes; no event is appended. Planning's catalog and
 * start read through it.
 */
import { CatalogSkill, type Catalog, type CatalogModule } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createPlanning, FeatureOffError, type BmadCatalogPort, type PlanningDeps } from '../src/index.js';
import { openTestCore, tempDir, unusedCatalogParts } from './helpers.js';

const module = (code: string, installedAt: string | null = null): CatalogModule => ({ code, name: code, version: '1.0.0', installedAt });
const skill = (name: string, module: string | null, installedAt: string | null = null) => CatalogSkill.parse({ name, description: `${name}.`, module, installedAt });

function catalogOf(modules: CatalogModule[], skills: CatalogSkill[] = []): Catalog {
  return { modules, skills, agents: [], entryAction: null, capabilities: { plain_labels: false, ticket_tree: false } };
}

describe('bmadModulesSeen (story 4.4)', () => {
  it('the first read with modules is the baseline; a module first seen later gets that time, on it and its skills', () => {
    const core = openTestCore(tempDir());
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const seq = core.events.lastSeq();

    // No module yet: nothing recorded, so no baseline is taken.
    expect(core.bmadModulesSeen.stamp(workspace.id, catalogOf([], [skill('mine', null)]))).toEqual(catalogOf([], [skill('mine', null)]));

    const first = core.bmadModulesSeen.stamp(workspace.id, catalogOf([module('method')], [skill('spec', 'method')]));
    expect(first.modules).toEqual([module('method')]);
    expect(first.skills).toEqual([skill('spec', 'method')]);

    const before = Date.now();
    const later = core.bmadModulesSeen.stamp(workspace.id, catalogOf([module('demo'), module('method')], [skill('demo-skill', 'demo'), skill('mine', null), skill('spec', 'method')]));
    const at = later.modules[0]!.installedAt!;
    expect(Date.parse(at)).toBeGreaterThanOrEqual(before - 1000);
    expect(later.modules).toEqual([module('demo', at), module('method')]);
    expect(later.skills).toEqual([skill('demo-skill', 'demo', at), skill('mine', null), skill('spec', 'method')]);

    // The next read answers the same time; a removed and reinstalled module keeps it.
    core.bmadModulesSeen.stamp(workspace.id, catalogOf([module('method')]));
    expect(core.bmadModulesSeen.stamp(workspace.id, catalogOf([module('demo')])).modules).toEqual([module('demo', at)]);
    // The catalog is fetched data: no event.
    expect(core.events.lastSeq()).toBe(seq);
  });

  it('keeps an installedAt the catalog gives, on a module and on a skill', () => {
    const core = openTestCore(tempDir());
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const given = '2026-09-30T08:00:00.000Z';
    core.bmadModulesSeen.stamp(workspace.id, catalogOf([module('method')]));
    const stamped = core.bmadModulesSeen.stamp(workspace.id, catalogOf([module('method', given), module('demo', given)], [skill('demo-skill', 'demo', given)]));
    expect(stamped.modules).toEqual([module('method', given), module('demo', given)]);
    expect(stamped.skills).toEqual([skill('demo-skill', 'demo', given)]);
  });

  it('keeps records per workspace: each has its own baseline', () => {
    const core = openTestCore(tempDir());
    const one = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const two = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.bmadModulesSeen.stamp(one.id, catalogOf([module('method')]));
    expect(core.bmadModulesSeen.stamp(one.id, catalogOf([module('method'), module('demo')])).modules[1]!.installedAt).not.toBeNull();
    // `demo` is part of the second workspace's baseline.
    expect(core.bmadModulesSeen.stamp(two.id, catalogOf([module('method'), module('demo')])).modules).toEqual([module('method'), module('demo')]);
  });
});

describe('planning reads the catalog through bmadModulesSeen (story 4.4)', () => {
  it('catalog() and start() see the stamped catalog: a module copied in is listed with its time, and its skill starts', async () => {
    const core = openTestCore(tempDir(), undefined, { availableBmadPieces: ['planning', 'board'] });
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] });
    let answer = catalogOf([module('method')], [skill('spec', 'method')]);
    const catalog: BmadCatalogPort = { ...unusedCatalogParts, detect: async () => ({ hasBmad: true, hasOutput: true }), skills: async () => [], catalog: async () => answer };
    const sent: string[] = [];
    // A chat that records what it is asked: planning only creates the session and sends the invocation.
    const chat = {
      createChatSession: (workspaceId: string, options?: { kind?: string }) => ({ id: 'sess_test', workspaceId, kind: options?.kind ?? 'chat' }),
      sendMessage: (_workspaceId: string, _sessionId: string, text: string) => void sent.push(text),
    } as unknown as PlanningDeps['chat'];
    const planning = createPlanning({ bmad: core.bmad, entities: core.entities, catalog, chat, agent: { skillInvocation: (name) => `/${name}` }, modulesSeen: core.bmadModulesSeen });
    expect((await planning.catalog(workspace.id)).modules).toEqual([module('method')]);
    answer = catalogOf([module('demo'), module('method')], [skill('demo-skill', 'demo'), skill('spec', 'method')]);
    const listed = await planning.catalog(workspace.id);
    expect(listed.modules[0]!.installedAt).not.toBeNull();
    expect(listed.skills[0]!.installedAt).toBe(listed.modules[0]!.installedAt);
    const session = await planning.start(workspace.id, 'demo-skill');
    expect(session.kind).toBe('planning');
    expect(sent).toEqual(['/demo-skill']);
  });

  it('catalog() records nothing when Planning is turned off during the scan', async () => {
    const core = openTestCore(tempDir(), undefined, { availableBmadPieces: ['planning', 'board'] });
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] });
    let answer = catalogOf([module('method')]);
    let turnOff = true;
    const catalog: BmadCatalogPort = {
      ...unusedCatalogParts,
      detect: async () => ({ hasBmad: true, hasOutput: true }),
      skills: async () => [],
      catalog: async () => {
        if (turnOff) core.permissions.updateSettings(workspace.id, { bmadPieces: [] });
        return answer;
      },
    };
    const planning = createPlanning({ bmad: core.bmad, entities: core.entities, catalog, chat: {} as PlanningDeps['chat'], agent: { skillInvocation: (name) => `/${name}` }, modulesSeen: core.bmadModulesSeen });
    await expect(planning.catalog(workspace.id)).rejects.toThrow(FeatureOffError);
    // No baseline was taken: the next read with Planning on is the baseline, so both modules are null.
    turnOff = false;
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] });
    answer = catalogOf([module('demo'), module('method')]);
    expect((await planning.catalog(workspace.id)).modules).toEqual([module('demo'), module('method')]);
  });
});
