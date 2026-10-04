import { z } from 'zod';

/** ISO 8601 UTC timestamp, e.g. `2026-09-29T18:00:00.000Z`. */
export const IsoUtcTimestamp = z.iso.datetime();
