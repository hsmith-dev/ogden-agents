/**
 * A worktree chat's port at its copy's turns (27.7): given once a copy is
 * made, handed off to or restored (then `onChatWorktreeReady`, where the
 * server starts the project's setup), given back once it is put away or
 * handed back. Every failure is caught and reported: it never fails the
 * chat's own operation, and the chat goes on with no port.
 */
import type { SessionId, WorkspaceId } from '@ogden-agents/shared';
import { withinTimeout } from '../turn-snapshots.js';
import type { ChatContext } from './context.js';

/** How long a copy's removal waits for its setup run to stop, as for its agent and terminal. */
const STOP_SETUP_MS = 10_000;

/** Gives the copy its port (`null`: none free, or no ports), then tells the server the copy is ready. Never throws. */
export async function readyCopy(ctx: ChatContext, sessionId: SessionId, copy: { workspaceId: WorkspaceId; worktreePath: string }): Promise<number | null> {
  let port: number | null = null;
  try {
    port = (await ctx.options.worktreePorts?.assign(sessionId)) ?? null;
  } catch (error) {
    ctx.internalError(sessionId, error);
  }
  try {
    ctx.options.onChatWorktreeReady?.(sessionId, { ...copy, port });
  } catch (error) {
    ctx.internalError(sessionId, error);
  }
  return port;
}

/** Stops the chat's setup run in its copy and waits (bounded) for it; whether it finished in time. Never throws. */
export async function stopSetup(ctx: ChatContext, sessionId: SessionId, options: { forget?: boolean } = {}): Promise<boolean> {
  const stop = ctx.options.stopChatSetup;
  if (stop === undefined) return true;
  const stopped = Promise.resolve()
    .then(() => stop(sessionId, options))
    .then(
      () => true,
      (error: unknown) => {
        ctx.internalError(sessionId, error);
        return true;
      },
    );
  return (await withinTimeout(stopped, ctx.options.stopBeforeRemovalMs ?? STOP_SETUP_MS)) === true;
}

/** Gives the chat's port back. Never throws. */
export async function releasePort(ctx: ChatContext, sessionId: SessionId): Promise<void> {
  try {
    await ctx.options.worktreePorts?.release(sessionId);
  } catch (error) {
    ctx.internalError(sessionId, error);
  }
}
