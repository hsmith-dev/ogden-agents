import { openDatabase, type OpenDatabaseOptions } from './db/database.js';
import { createEntities, type Entities } from './entities.js';
import { createEventLog, type EventLog, type EventLogOptions } from './event-log.js';
import { createSessionEvents, type SessionEvents } from './session-events.js';

/**
 * Core as the server wires it: the event log, the session-event helper and
 * the entity model. The database handle stays inside core (AD-11), so callers
 * can only change state through these operations, which append events.
 */
export interface Core {
  readonly events: EventLog;
  /** The only way `session.*` events are appended (E2-R7). */
  readonly sessionEvents: SessionEvents;
  readonly entities: Entities;
  close(): void;
}

export type OpenCoreOptions = OpenDatabaseOptions & EventLogOptions;

/** Opens (and migrates) the database in `dataDir` and builds core on it. */
export function openCore(dataDir: string, options: OpenCoreOptions = {}): Core {
  const db = openDatabase(dataDir, options);
  const events = createEventLog(db, options);
  const sessionEvents = createSessionEvents(db, events);
  const entities = createEntities(db, events, sessionEvents);
  return { events, sessionEvents, entities, close: () => db.close() };
}
