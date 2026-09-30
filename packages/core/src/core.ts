import { openDatabase, type OpenDatabaseOptions } from './db/database.js';
import { createEntities, type Entities } from './entities.js';
import { createEventLog, type EventLog, type EventLogOptions } from './event-log.js';

/**
 * Core as the server wires it: the event log and the entity model. The
 * database handle stays inside core (AD-11), so callers can only change state
 * through these operations, which append events.
 */
export interface Core {
  readonly events: EventLog;
  readonly entities: Entities;
  close(): void;
}

export type OpenCoreOptions = OpenDatabaseOptions & EventLogOptions;

/** Opens (and migrates) the database in `dataDir` and builds core on it. */
export function openCore(dataDir: string, options: OpenCoreOptions = {}): Core {
  const db = openDatabase(dataDir, options);
  const events = createEventLog(db, options);
  const entities = createEntities(db, events);
  return { events, entities, close: () => db.close() };
}
