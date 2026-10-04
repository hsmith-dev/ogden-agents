import type { CoreEvent, Session, SessionState, Workspace } from '@ogden-agents/shared';
import { AGENT_NAME } from '@/chat/chat-api';
import { sessionView, type TranscriptPermission } from '@/chat/transcript';
import { streamEvents, type EventStoreState } from '@/events/event-store';
import { permissionAnnouncement } from '@/permissions/permission-card';
import { workspaceName } from '@/workspaces/workspace-api';

/**
 * The status sidebar as data (story 2.11; EXPERIENCE.md Status sidebar and
 * Needs you group). Pure, so every ordering and announcement rule is
 * unit-tested: the components only render what this returns.
 */

/** One session row. */
export interface SidebarRow {
  sesId: string;
  wsId: string;
  /** The session's title, or "Chat". */
  title: string;
  state: SessionState;
  /** When its state last changed (ISO), for the relative time. */
  updatedAt: string;
  /** The product name of the agent the chat was started with (epic 6). */
  agentName: string;
}

/** One workspace's group: its rows, the done ones older than a day under "Earlier", and a count per state. */
export interface SidebarWorkspace {
  wsId: string;
  name: string;
  rows: SidebarRow[];
  earlier: SidebarRow[];
  /** One entry per non-zero state, in row order: the collapsed group's summary. */
  summary: { state: SessionState; count: number }[];
}

/** One thing waiting on the user: a permission request, or a waiting session whose request is older than the window. */
export interface NeedsYouEntry {
  /** The request id, or the session id when the request is not in the window. */
  id: string;
  wsId: string;
  sesId: string;
  workspaceName: string;
  text: string;
  /** When it started waiting (ISO); the list is oldest first. */
  at: string;
  /** The announcement for a new request ("run npm test"); absent for a waiting session with no request in view. */
  request?: string;
}

export interface SidebarModel {
  groups: SidebarWorkspace[];
  needsYou: NeedsYouEntry[];
}

/** Rows order: active first (working, waiting, error), then idle, then done (EXPERIENCE.md Status sidebar). */
export const STATE_ORDER: readonly SessionState[] = ['working', 'waiting', 'error', 'idle', 'done'];

/** A done session moves under "Earlier" after this long (EXPERIENCE.md State Patterns). */
export const EARLIER_AFTER_MS = 24 * 60 * 60 * 1000;

/** What a session with no title is called. */
export const UNTITLED = 'Chat';

/** The Needs you text for a waiting session whose request is older than the window, naming its agent (epic 6). */
export const waitingText = (agentName: string) => `${agentName} is waiting for you`;

/** {@link waitingText} for the install's original agent. */
export const WAITING_TEXT = waitingText(AGENT_NAME);

const rank = (state: SessionState) => STATE_ORDER.indexOf(state);
const time = (iso: string) => Date.parse(iso) || 0;

/** Most recently changed first, then by id, so the order is total. */
function compareRows(a: SidebarRow, b: SidebarRow): number {
  return rank(a.state) - rank(b.state) || time(b.updatedAt) - time(a.updatedAt) || (a.sesId < b.sesId ? -1 : a.sesId > b.sesId ? 1 : 0);
}

/** A session's stream folded once per stream array: the array keeps its identity until the session's next event. */
const permissionsByStream = new WeakMap<readonly CoreEvent[], { state: SessionState | undefined; requested: TranscriptPermission[] }>();

/**
 * A waiting session's requests still waiting for an answer, and the state
 * its event window last saw (`undefined` when the window has no state for
 * it). When the window holds the request but not the `waiting` state change
 * (the state comes from REST), its requests with no answer still count.
 */
function pendingRequests(store: EventStoreState, session: Session): { requests: TranscriptPermission[]; windowState: SessionState | undefined } {
  if (session.state !== 'waiting') return { requests: [], windowState: undefined };
  const events = streamEvents(store, session.workspaceId, session.id);
  if (events.length === 0) return { requests: [], windowState: undefined };
  let folded = permissionsByStream.get(events);
  if (folded === undefined) {
    const view = sessionView(events, session.id);
    const requested = view.items.flatMap((item) => (item.type === 'permission' && item.permission.resolution === undefined ? [item.permission] : []));
    folded = { state: view.state, requested };
    permissionsByStream.set(events, folded);
  }
  // The stream saw the session move on from waiting since: its requests were let go.
  if (folded.state !== undefined && folded.state !== 'waiting') return { requests: [], windowState: folded.state };
  return { requests: folded.requested, windowState: folded.state };
}

/**
 * The sidebar for these workspaces (in creation order) and sessions, with
 * Needs you built from each session's event window. `now` decides which done
 * sessions are "Earlier".
 */
export function buildSidebar(
  workspaces: readonly Workspace[],
  sessions: readonly Session[],
  store: EventStoreState,
  now: number,
  /** A chat's agent by its product name (epic 6); default: the original agent's. */
  agentName: (agentId: string | undefined) => string = () => AGENT_NAME,
): SidebarModel {
  const byWorkspace = new Map<string, Session[]>();
  for (const session of sessions) {
    const list = byWorkspace.get(session.workspaceId) ?? [];
    list.push(session);
    byWorkspace.set(session.workspaceId, list);
  }
  const ordered = [...workspaces].sort((a, b) => time(a.createdAt) - time(b.createdAt) || (a.id < b.id ? -1 : 1));
  const groups: SidebarWorkspace[] = [];
  const needsYou: NeedsYouEntry[] = [];
  for (const workspace of ordered) {
    const name = workspaceName(workspace);
    const rows: SidebarRow[] = [];
    const earlier: SidebarRow[] = [];
    const counts = new Map<SessionState, number>();
    for (const session of byWorkspace.get(workspace.id) ?? []) {
      const row: SidebarRow = { sesId: session.id, wsId: workspace.id, title: session.title ?? UNTITLED, state: session.state, updatedAt: session.updatedAt, agentName: agentName(session.agentId) };
      if (session.state === 'done' && now - time(session.updatedAt) > EARLIER_AFTER_MS) earlier.push(row);
      else rows.push(row);
      counts.set(session.state, (counts.get(session.state) ?? 0) + 1);

      const { requests, windowState } = pendingRequests(store, session);
      for (const request of requests) {
        const announcement = permissionAnnouncement(request);
        needsYou.push({
          id: request.requestId,
          wsId: workspace.id,
          sesId: session.id,
          workspaceName: name,
          text: `${agentName(session.agentId)} wants to ${announcement}`,
          at: request.requestedAt,
          request: announcement,
        });
      }
      // Only when the window has no state for the session: a request older than the window. A
      // `waiting` the window saw with no open request is a moment between events (the request
      // not yet arrived, or answered before `working`), not something to show.
      if (requests.length === 0 && session.state === 'waiting' && windowState === undefined) {
        needsYou.push({ id: session.id, wsId: workspace.id, sesId: session.id, workspaceName: name, text: waitingText(agentName(session.agentId)), at: session.updatedAt });
      }
    }
    rows.sort(compareRows);
    earlier.sort(compareRows);
    const summary = STATE_ORDER.flatMap((state) => (counts.has(state) ? [{ state, count: counts.get(state)! }] : []));
    groups.push({ wsId: workspace.id, name, rows, earlier, summary });
  }
  needsYou.sort((a, b) => time(a.at) - time(b.at) || (a.id < b.id ? -1 : 1));
  return { groups, needsYou };
}

/** `next`'s items in `previous`'s order, with the ones `previous` did not have appended in their own order. */
function keepOrder<T>(previous: readonly T[], next: readonly T[], key: (item: T) => string): T[] {
  const fresh = new Map(next.map((item) => [key(item), item]));
  const kept: T[] = [];
  for (const item of previous) {
    const current = fresh.get(key(item));
    if (current === undefined) continue;
    kept.push(current);
    fresh.delete(key(item));
  }
  return [...kept, ...fresh.values()];
}

/**
 * `next` without moving anything that `previous` showed (the pointer is over
 * the sidebar): rows update in place and keep their section, new rows go at
 * the end of their section, gone rows leave. The new order applies once the
 * pointer leaves (EXPERIENCE.md Interaction Rules).
 */
export function holdOrder(previous: SidebarModel, next: SidebarModel): SidebarModel {
  const before = new Map(previous.groups.map((group) => [group.wsId, group]));
  const groups = next.groups.map((group) => {
    const held = before.get(group.wsId);
    if (held === undefined) return group;
    const all = [...group.rows, ...group.earlier];
    const heldEarlier = new Set(held.earlier.map((row) => row.sesId));
    const heldRows = new Set(held.rows.map((row) => row.sesId));
    // A row stays in the section it was shown in; a new one goes where `next` put it.
    const inRows = all.filter((row) => heldRows.has(row.sesId) || (!heldEarlier.has(row.sesId) && group.rows.includes(row)));
    const inEarlier = all.filter((row) => !inRows.includes(row));
    const bySesId = (row: SidebarRow) => row.sesId;
    return { ...group, rows: keepOrder(held.rows, inRows, bySesId), earlier: keepOrder(held.earlier, inEarlier, bySesId) };
  });
  return { groups, needsYou: keepOrder(previous.needsYou, next.needsYou, (entry) => entry.id) };
}

/** A state change in words, after the session's name ("B: Chat is working"). */
const STATE_PHRASES: Record<SessionState, string> = {
  working: 'is working',
  waiting: 'is waiting for you',
  idle: 'is idle',
  done: 'is done',
  error: 'stopped with an error',
};

export interface Announcements {
  /** For the polite region, keyed by session so a burst keeps the latest per session. */
  polite: { sesId: string; text: string }[];
  /** For the assertive region: each new permission request, once. */
  assertive: { id: string; sesId: string; text: string }[];
}

/**
 * What changed between two models, in words for a screen reader. A session
 * that changed state is polite; moving to `waiting` is left to the new
 * request's assertive announcement. A new request in a session already
 * shown is assertive. A session that only appeared (a list loading) says
 * nothing.
 */
export function diffForAnnouncements(previous: SidebarModel, next: SidebarModel): Announcements {
  const before = new Map<string, SidebarRow>();
  for (const group of previous.groups) for (const row of [...group.rows, ...group.earlier]) before.set(row.sesId, row);
  const polite: Announcements['polite'] = [];
  for (const group of next.groups) {
    for (const row of [...group.rows, ...group.earlier]) {
      const was = before.get(row.sesId);
      if (was === undefined || was.state === row.state || row.state === 'waiting') continue;
      polite.push({ sesId: row.sesId, text: `${group.name}: ${row.title} ${STATE_PHRASES[row.state]}` });
    }
  }
  const known = new Set(previous.needsYou.map((entry) => entry.id));
  // A request in a session the sidebar did not have yet is its list loading, not news.
  const assertive = next.needsYou.flatMap((entry) =>
    entry.request === undefined || known.has(entry.id) || !before.has(entry.sesId)
      ? []
      : [{ id: entry.id, sesId: entry.sesId, text: `${WAITING_TEXT}: ${entry.request}` }],
  );
  return { polite, assertive };
}

/** How long ago, short and tabular: "now", "5m", "3h", "2d" (DESIGN.md Status row). */
export function relativeTime(iso: string, now: number): string {
  const minutes = Math.floor(Math.max(0, now - time(iso)) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
