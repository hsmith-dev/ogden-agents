/**
 * The routes' {@link ChatLocations} (27.4) over the chat's own Location and
 * hand-off (`chat/location.ts`): the ids and the body arrive `unknown`
 * from a route and are parsed here against the shared schemas. A malformed
 * id is the same `NotFoundError` as an unknown one; a malformed body is a
 * `ValidationError`. The chat itself checks the project and the session
 * (another project's session is `NotFoundError`).
 */
import { HandOffRequest, SessionId, WorkspaceId, type CopyIgnoredFilesResponse, type HandOffResponse, type SessionLocationResponse } from '@ogden-agents/shared';
import type { Chat } from './chat/types.js';
import { NotFoundError, ValidationError } from './errors.js';
import type { ChatLocations } from './where-work-runs.js';

export function createChatLocations(chat: Pick<Chat, 'chatLocation' | 'moveChat' | 'copyIgnoredFiles'>): ChatLocations {
  const ids = (workspaceId: unknown, sessionId: unknown) => {
    const ws = WorkspaceId.safeParse(workspaceId);
    if (!ws.success) throw new NotFoundError('workspace', 'requested');
    const ses = SessionId.safeParse(sessionId);
    if (!ses.success) throw new NotFoundError('session', 'requested');
    return { workspaceId: ws.data, sessionId: ses.data };
  };
  return {
    async location(workspaceId, sessionId): Promise<SessionLocationResponse> {
      const parsed = ids(workspaceId, sessionId);
      return { location: chat.chatLocation(parsed.workspaceId, parsed.sessionId) };
    },
    async handOff(workspaceId, sessionId, body): Promise<HandOffResponse> {
      const parsed = ids(workspaceId, sessionId);
      const request = HandOffRequest.safeParse(body);
      if (!request.success) throw new ValidationError('Choose where the chat moves: this_folder or worktree.', request.error.issues.map((issue) => ({ path: issue.path, message: issue.message })));
      return { session: await chat.moveChat(parsed.workspaceId, parsed.sessionId, request.data.to) };
    },
    async ignoredFiles(workspaceId, sessionId): Promise<CopyIgnoredFilesResponse> {
      const parsed = ids(workspaceId, sessionId);
      return chat.copyIgnoredFiles(parsed.workspaceId, parsed.sessionId);
    },
  };
}
