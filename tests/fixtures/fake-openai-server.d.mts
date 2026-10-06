/** Types for `fake-openai-server.mjs`, the fake OpenAI-compatible server (epic 14), for the tests written in TypeScript. */
export interface FakeServerOptions {
  /** `0`: any free port. */
  port?: number;
  host?: string;
  /** Answers 401 to any request without `Authorization: Bearer <key>`. */
  requireKey?: string | null;
  /** How long a prompt containing `SLOW` waits before its first token. */
  slowMs?: number;
  models?: string[];
  /** How long `GET /v1/models` waits before answering (a busy server). */
  modelsDelayMs?: number;
}

/** One request the server got. Never holds a key, only whether one came. */
export interface FakeRequest {
  t: number;
  method: string;
  path: string;
  host: string | undefined;
  auth: 'bearer-present' | 'none';
  authMatches: boolean | null;
  ua: string;
  model?: string;
  stream?: boolean;
  tools?: string[];
  toolChoice?: unknown;
  responseFormat?: string;
  messageRoles?: string[];
  messageCount?: number;
  userText?: string;
  lastToolContent?: string;
  systemChars?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface FakeServer {
  port: number;
  host: string;
  log: FakeRequest[];
  url: string;
  close(): Promise<void>;
}

export function startFakeServer(options?: FakeServerOptions): Promise<FakeServer>;
