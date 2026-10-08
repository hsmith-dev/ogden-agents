/**
 * `createTicketsJira` (epic 18 story 6; AD-27, AD-10): the real
 * `TicketStorePort` decorator Jira-linked workspaces get. `tree`, `find`,
 * and `watch` pass straight through to the wrapped store (`tickets-v7` in
 * production) unchanged — once a Jira issue is synced in (story 5), it is
 * an ordinary local file, and reading it is exactly what `tickets-v7`
 * already does, matching AD-27's "the port's write and query verbs stay
 * vendor-neutral" rule structurally, not just by convention.
 *
 * `mark` is the one method this decorator changes: after the wrapped
 * store's own mark succeeds (so the local plan file is always the one
 * source of truth locally, AD-10), it pushes the new status to Jira when
 * the ticket is Jira-sourced (has a `tracker_id`) and the workspace has a
 * linked board — translating the BMad status to one of the board's own
 * available transitions (`chooseTransition`; never forced when none
 * matches, AD-28). A push failure is reported but never fails the local
 * mark, which already succeeded: AD-27's "a failed sync never blocks the
 * Board from showing its last-synced local state" applies here too, even
 * though this is a push, not a pull.
 *
 * A repo with no linked board costs nothing extra: `resolveLink`
 * answering `undefined` skips straight to the wrapped store's own `mark`.
 */
import type { TicketStorePort } from '@ogden-agents/core';
import type { TicketStatus } from '@ogden-agents/shared';
import type { JiraCallOptions } from './jira-client.js';
import { listTransitions, transitionIssue } from './jira-client.js';
import { chooseTransition } from './jira-issue-mapping.js';

/** What `resolveLink` hands back for a linked workspace: enough to call Jira directly. */
export interface JiraLinkedCredential {
  baseUrl: string;
  email: string;
  token: string;
}

export interface TicketsJiraOptions {
  /** The real store underneath (`tickets-v7` in production; a memory store in tests). */
  store: TicketStorePort;
  /** Resolves `repoPath` to its linked board's call credential, or `undefined` when the workspace has none. Called on every `mark`; the server wiring's own resolver decides how (or whether) to cache. */
  resolveLink: (repoPath: string) => Promise<JiraLinkedCredential | undefined>;
  /** Default: the global `fetch`. Tests pass the fake Jira server's own fetch-compatible caller. */
  fetch?: typeof fetch;
  /** Told about a push that failed, or found no matching transition; never thrown onward (the local mark already succeeded). */
  onPushFailure?: (error: unknown, context: { repoPath: string; ref: string; issueKey: string }) => void;
}

export function createTicketsJira({ store, resolveLink, fetch: fetchImpl, onPushFailure }: TicketsJiraOptions): TicketStorePort {
  const pushStatus = async (credential: JiraLinkedCredential, issueKey: string, status: TicketStatus, context: { repoPath: string; ref: string }): Promise<void> => {
    try {
      const call: JiraCallOptions = { baseUrl: credential.baseUrl, email: credential.email, token: credential.token, fetch: fetchImpl };
      const transitions = await listTransitions(call, issueKey);
      const transition = chooseTransition(transitions, status);
      if (transition !== undefined) await transitionIssue(call, issueKey, transition.id);
      // No available transition on this board's own workflow leads there: nothing pushed, never forced (AD-28).
    } catch (error) {
      onPushFailure?.(error, { ...context, issueKey });
    }
  };

  return {
    tree: (repoPath, guard) => store.tree(repoPath, guard),
    find: (repoPath, ref, guard) => store.find(repoPath, ref, guard),
    async mark(repoPath, ref, status, guard, options) {
      const link = await resolveLink(repoPath);
      if (link === undefined) return store.mark(repoPath, ref, status, guard, options);
      // Read the tracker id before marking: cheap (one more read on an already-cheap path), and avoids pushing to
      // Jira for a ticket this board never sourced, which `tracker_id` alone tells us without guessing from the ref.
      const before = await store.find(repoPath, ref, guard).catch(() => undefined);
      const result = await store.mark(repoPath, ref, status, guard, options);
      if (before !== undefined && before.tracker_id !== '') await pushStatus(link, before.tracker_id, status, { repoPath, ref });
      return result;
    },
    watch: (repoPath, outputFolder, onChange, options) => store.watch(repoPath, outputFolder, onChange, options),
  };
}
