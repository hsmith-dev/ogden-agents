/**
 * The issue tracker port (CAP-35, epic 27; AD-1). Core names no tracker
 * here: the `trackers-*` adapters do, each on its fixed HTTPS host, and map
 * their vendor's answer to the shared `Issue`. A token reaches an adapter
 * only in a call and never leaves it but in the request's Authorization
 * header.
 */
import type { Issue, IssueKey, TrackerKind } from '@ogden-agents/shared';
import { TRACKER_NOT_FOUND_MESSAGE, TRACKER_UNAUTHORIZED_MESSAGE, TRACKER_UNREACHABLE_MESSAGE } from '@ogden-agents/shared';
import { CoreError } from './errors.js';

/** What an adapter is called with: the account's kind, token and scope (a GitHub `owner/name`, a Linear team key or `null`). */
export interface TrackerCall {
  kind: TrackerKind;
  token: string;
  scope: string | null;
}

export interface TrackerAdapter {
  /** Resolves when the token can read issues in the scope; else {@link TrackerError}. */
  verify(call: TrackerCall): Promise<void>;
  /** The most recently updated open issues, or those matching `query`, at most `MAX_ISSUES_LISTED`. */
  issues(call: TrackerCall, query?: string): Promise<Issue[]>;
  /** One issue by its key. */
  issue(call: TrackerCall, key: IssueKey): Promise<Issue>;
}

/** One adapter per tracker kind (the server wires them). */
export type TrackerPort = Readonly<Record<TrackerKind, TrackerAdapter>>;

export type TrackerFailure = 'unauthorized' | 'unreachable' | 'not_found';
const MESSAGES: Readonly<Record<TrackerFailure, string>> = {
  unauthorized: TRACKER_UNAUTHORIZED_MESSAGE,
  unreachable: TRACKER_UNREACHABLE_MESSAGE,
  not_found: TRACKER_NOT_FOUND_MESSAGE,
};

/** Why a tracker call failed, in plain words; never the tracker's own text or the token. */
export class TrackerError extends CoreError {
  override readonly name = 'TrackerError';
  constructor(readonly failure: TrackerFailure) {
    super(`tracker_${failure}`, MESSAGES[failure]);
  }
}
