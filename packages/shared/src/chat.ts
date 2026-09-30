import { z } from 'zod';
import { MessageId } from './events.js';
import { Session, Workspace } from './entities.js';

/**
 * The chat REST contract (story 2.2, the tracer bullet): create a workspace
 * from a repo path, create a chat session in it, and send a message. Replies
 * and state never come back in these responses; they arrive through the event
 * log (AD-5). Routes are in `API_ROUTES`.
 */

/** `POST /api/v1/workspaces`. `path` is a folder on this computer; the server canonicalizes it (AD-2). */
export const CreateWorkspaceRequest = z.object({
  path: z.string().trim().min(1, 'Enter the path of a folder on this computer.'),
});
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequest>;

export const WorkspaceResponse = z.object({ workspace: Workspace });
export type WorkspaceResponse = z.infer<typeof WorkspaceResponse>;

/** `POST /api/v1/workspaces/:wsId/sessions`. Only chat sessions are created this way so far. */
export const CreateSessionRequest = z.object({
  kind: z.literal('chat').default('chat'),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

export const SessionResponse = z.object({ session: Session });
export type SessionResponse = z.infer<typeof SessionResponse>;

/** The longest message the composer may send, in characters. */
export const MAX_MESSAGE_LENGTH = 100_000;

/** `POST /api/v1/workspaces/:wsId/sessions/:sesId/messages`. */
export const SendMessageRequest = z.object({
  text: z
    .string()
    .refine((text) => text.trim().length > 0, 'Write a message first.')
    .pipe(z.string().max(MAX_MESSAGE_LENGTH, `A message can be at most ${MAX_MESSAGE_LENGTH} characters.`)),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

/** The user's message, as `session.message_completed` carries it (role `user`). */
export const SendMessageResponse = z.object({ messageId: MessageId });
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;
