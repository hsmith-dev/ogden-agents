import { createBmadFeatures, type BmadFeatures } from './bmad-features.js';
import { openDatabase, type OpenDatabaseOptions } from './db/database.js';
import { createEntities, type Entities } from './entities.js';
import { createEventLog, type EventLog, type EventLogOptions } from './event-log.js';
import { createPermissions, type Permissions } from './permissions.js';
import { createSessionEvents, type SessionEvents } from './session-events.js';

/**
 * Core as the server wires it: the event log, the session-event helper, the
 * entity model and the permissions (story 2.6). The database handle stays inside core (AD-11), so callers
 * can only change state through these operations, which append events.
 */
export interface Core {
  readonly events: EventLog;
  /** The only way `session.*` events are appended (E2-R7). */
  readonly sessionEvents: SessionEvents;
  readonly entities: Entities;
  /** Permission requests, their cards' decisions and the always-allow rules (CAP-4, E2-R3). */
  readonly permissions: Permissions;
  /** The BMad pieces guard (AD-22): every use-case serving a piece calls it first. */
  readonly bmad: BmadFeatures;
  close(): void;
}

export type OpenCoreOptions = OpenDatabaseOptions &
  EventLogOptions & {
    /** Called with a failure while deciding a permission request (it is declined all the same). */
    onPermissionError?: (error: unknown) => void;
  };

/** Opens (and migrates) the database in `dataDir` and builds core on it. */
export function openCore(dataDir: string, options: OpenCoreOptions = {}): Core {
  const db = openDatabase(dataDir, options);
  const events = createEventLog(db, options);
  const sessionEvents = createSessionEvents(db, events);
  const entities = createEntities(db, events, sessionEvents);
  const permissions = createPermissions({
    db,
    events,
    entities,
    sessionEvents,
    ...(options.onPermissionError === undefined ? {} : { onError: options.onPermissionError }),
  });
  return {
    events,
    sessionEvents,
    entities,
    permissions,
    bmad: createBmadFeatures(db),
    close: () => {
      try {
        permissions.close();
      } finally {
        db.close();
      }
    },
  };
}
