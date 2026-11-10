/**
 * `trackers` (CAP-35, epic 27): core's `TrackerPort`, one adapter per
 * tracker kind, each on its own fixed HTTPS host.
 */
import type { TrackerPort } from '@ogden-agents/core';
import { createGitHubTracker } from './github.js';
import type { TrackerHttpOptions } from './http.js';
import { createLinearTracker } from './linear.js';

export { createGitHubTracker, GITHUB_API, plainSearchWords } from './github.js';
export { createLinearTracker, LINEAR_API } from './linear.js';
export { TRACKER_CALL_TIMEOUT_MS, TRACKER_MAX_RESPONSE_BYTES, type TrackerHttpOptions } from './http.js';

export function createTrackers(options: TrackerHttpOptions = {}): TrackerPort {
  return { github: createGitHubTracker(options), linear: createLinearTracker(options) };
}
