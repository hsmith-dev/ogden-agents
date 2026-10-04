/**
 * Reading a request's input (story 3.9, moved from `chat-routes.ts`): its
 * JSON body against a shared schema, and the route's workspace and session
 * ids. Used by the chat, workspace, permission and agent-setup routes.
 */
import { SessionId, WorkspaceId } from '@ogden-agents/shared';
import type { Context } from 'hono';
import { apiError } from './errors.js';

/** The part of a shared Zod schema these routes use. */
interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ message: string }> } };
}

/** Parses the JSON body against `schema`, or answers 400 when it doesn't fit. */
export async function readBody<T>(c: Context, schema: Schema<T>, { optional = false } = {}): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  let json: unknown;
  try {
    const text = await c.req.text();
    json = text.trim() === '' && optional ? {} : JSON.parse(text);
  } catch {
    return { ok: false, response: apiError(c, 400, 'invalid_request', 'The request body must be JSON.') };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, response: apiError(c, 400, 'invalid_request', parsed.error.issues[0]?.message ?? 'The request is not valid.') };
  }
  return { ok: true, value: parsed.data };
}

/** The route's `:wsId` and `:sesId`, if they are well-formed ids; otherwise nothing matches them. */
export function ids(c: Context): { workspaceId: WorkspaceId; sessionId?: SessionId } | undefined {
  const workspace = WorkspaceId.safeParse(c.req.param('wsId'));
  if (!workspace.success) return undefined;
  const raw = c.req.param('sesId');
  if (raw === undefined) return { workspaceId: workspace.data };
  const session = SessionId.safeParse(raw);
  return session.success ? { workspaceId: workspace.data, sessionId: session.data } : undefined;
}
