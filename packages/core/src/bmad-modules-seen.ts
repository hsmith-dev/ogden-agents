/**
 * When each BMad Method module first appeared in a project (story 4.4): the
 * catalog's `installedAt`, which the Plan page's New tag reads (E4-R3).
 * The catalog port reads the repo's metadata, which says nothing about
 * when a module was installed, so core keeps a per-workspace first-seen
 * record (`bmad_modules_seen`) and fills the catalog's `null`s from it.
 *
 * The first catalog read that finds any module is the baseline: those
 * modules are recorded with `installedAt` `null` (they were there before
 * Ogden Agents looked, including right after its own setup), and a module
 * first seen by a later read gets that read's time. A record stays when its
 * module is removed, so a reinstall keeps its first time. Only a `null` from
 * the port is filled: a catalog that gives `installedAt` (the memory
 * catalog) keeps it. No event: the catalog is fetched data (AD-7).
 */
import type { Catalog, WorkspaceId } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Orm } from './db/database.js';
import { bmadModulesSeen } from './db/schema.js';
import type { EventLog } from './event-log.js';

export interface BmadModulesSeen {
  /**
   * Records the modules of `catalog` (a catalog of `workspaceId`'s repo)
   * not seen before, in one transaction, and answers the catalog with each
   * `null` `installedAt` of a module, and of a skill of that module, filled
   * from the record (still `null` for a baseline module).
   */
  stamp(workspaceId: WorkspaceId, catalog: Catalog): Catalog;
}

export interface BmadModulesSeenDeps {
  orm: Orm;
  events: Pick<EventLog, 'transaction'>;
  /** The clock (an ISO UTC timestamp). Default: now. */
  now?: () => string;
}

export function createBmadModulesSeen({ orm, events, now = () => new Date().toISOString() }: BmadModulesSeenDeps): BmadModulesSeen {
  return {
    stamp(workspaceId, catalog) {
      // No module yet: nothing to record, and no baseline taken.
      if (catalog.modules.length === 0) return catalog;
      const recorded = events.transaction(() => {
        const rows = orm
          .select({ code: bmadModulesSeen.code, installedAt: bmadModulesSeen.installedAt })
          .from(bmadModulesSeen)
          .where(eq(bmadModulesSeen.workspaceId, workspaceId))
          .all();
        const known = new Map(rows.map((row) => [row.code, row.installedAt]));
        const baseline = known.size === 0;
        const at = now();
        for (const module of catalog.modules) {
          if (known.has(module.code)) continue;
          const installedAt = baseline ? null : at;
          orm.insert(bmadModulesSeen).values({ workspaceId, code: module.code, installedAt, seenAt: at }).onConflictDoNothing().run();
          known.set(module.code, installedAt);
        }
        return known;
      });
      const modules = catalog.modules.map((module) => (module.installedAt !== null ? module : { ...module, installedAt: recorded.get(module.code) ?? null }));
      const installedAt = new Map(modules.map((module) => [module.code, module.installedAt]));
      const skills = catalog.skills.map((skill) =>
        skill.installedAt !== null || skill.module === null ? skill : { ...skill, installedAt: installedAt.get(skill.module) ?? null },
      );
      return { ...catalog, modules, skills };
    },
  };
}
