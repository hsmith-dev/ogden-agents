import type { IdPrefix } from '@ogden-agents/shared';
import { monotonicFactory } from 'ulid';

const nextUlid = monotonicFactory();

/** A new prefixed ULID (AD-9), e.g. `newId('ses')` -> `ses_01J…`. Monotonic within a process. */
export function newId<P extends IdPrefix>(prefix: P): `${P}_${string}` {
  return `${prefix}_${nextUlid()}`;
}
