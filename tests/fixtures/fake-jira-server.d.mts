/** Types for `fake-jira-server.mjs`, the fake Jira Cloud REST server (epic 18, CAP-26), for tests written in TypeScript. */

/** One Jira issue as the fixture serves it, in Jira's own search-result shape (only the fields `tickets-jira` reads). */
export interface FakeJiraIssue {
  key: string;
  fields: {
    summary: string;
    description?: string | null;
    status: { name: string };
    issuetype?: { name: string };
    parent?: { key: string } | null;
    assignee?: { displayName: string } | null;
    priority?: { name: string } | null;
  };
}

export interface FakeJiraServerOptions {
  /** `0`: any free port. */
  port?: number;
  host?: string;
  /** The one email/token pair that answers 200; anything else is 401. */
  email?: string;
  token?: string;
  accountId?: string;
  issues?: FakeJiraIssue[];
  /** Plays one failure mode on every request; `null` (default): normal answers. */
  tamper?: 'unauthorized' | 'rate-limited' | 'malformed' | 'tenant-info-down' | null;
  /** Simulates a scoped token: direct `/rest/api/3/...` calls always 401; only the `/ex/jira/<cloudId>` gateway prefix accepts the real credential. */
  scopedOnly?: boolean;
  /** The cloud id `/_edge/tenant_info` and the gateway prefix use. */
  cloudId?: string;
}

export interface FakeJiraRequest {
  t: number;
  method: string;
  path: string;
  query: string;
  auth: 'basic-present' | 'none';
  authorized: boolean;
  gateway: boolean;
}

export interface FakeJiraTransition {
  issueKey: string;
  transitionId: string | undefined;
  at: number;
}

export interface FakeJiraServer {
  port: number;
  host: string;
  url: string;
  log: FakeJiraRequest[];
  transitions: FakeJiraTransition[];
  close(): Promise<void>;
}

export function startFakeJiraServer(options?: FakeJiraServerOptions): Promise<FakeJiraServer>;
export function basicAuthHeader(email: string, token: string): string;
