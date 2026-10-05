/**
 * The handoff brief (user decision 2026-10-04): what an agent is told first
 * when the user continues a chat with it, built by Ogden from the chat's own
 * stored events, with no model call (the agent the chat had may be out of
 * usage).
 *
 * It holds the project folder, the original goal (the chat's first user
 * message), the files changed (paths only, never contents), the actions
 * taken (completed tool-call titles), and the conversation: newest messages whole
 * within the budget, older ones cut to their first line, then only counted.
 * Permission requests are left out: one still waiting was the earlier
 * agent's and is dropped with it. Every part is masked (`redactSecrets`) and
 * the whole is never longer than `maxChars`. Core names no agent: the caller
 * gives each agent's name.
 */
import { redactSecrets, type AgentId, type CoreEvent } from '@ogden-agents/shared';

export const HANDOFF_HEADER = '[Ogden Agents] Handoff:';

/** The longest original goal a brief quotes. */
const MAX_GOAL_CHARS = 1_000;
/** The longest one-line heading an older message is cut to. */
const MAX_HEADING_CHARS = 120;
/** The longest tool-call title quoted. */
const MAX_ACTION_CHARS = 160;
/** At most this many actions and changed files are listed (the newest). */
const MAX_ACTIONS = 30;
const MAX_FILES = 50;

/** The session event types the brief reads. */
export const HANDOFF_EVENT_TYPES = ['session.created', 'session.agent_changed', 'session.message_completed', 'session.tool_call', 'session.tool_call_updated'] as const;

export interface HandoffBriefInput {
  /** The session's events of {@link HANDOFF_EVENT_TYPES}, oldest first. */
  events: readonly CoreEvent[];
  /** The project folder the chat works in. */
  projectPath: string;
  /** Each agent's product name (`undefined`: the agent of a session stored before agents could be chosen). */
  agentName: (agentId: AgentId | undefined) => string;
  /** The agent the chat has now, which hands it over. */
  fromName: string;
  /** Only what happened after this event (an agent coming back to a chat it left): its messages, actions and files. */
  sinceSeq?: number | undefined;
  maxChars: number;
}

interface Line {
  label: string;
  content: string;
}

const firstLine = (text: string): string => {
  const line = text.trim().split(/\r?\n/, 1)[0] ?? '';
  return line.length > MAX_HEADING_CHARS ? `${line.slice(0, MAX_HEADING_CHARS - 1)}…` : line;
};

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** `path` relative to the project when it is inside it, `/`-separated; else as given. */
function projectRelative(path: string, projectPath: string): string {
  const norm = (value: string) => value.replace(/\\/g, '/');
  const root = norm(projectPath).replace(/\/+$/, '');
  const file = norm(path);
  return file.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? file.slice(root.length + 1) : file;
}

/** The brief for the agent the chat goes to, at most `maxChars`, secrets masked. */
export function buildHandoffBrief(input: HandoffBriefInput): string {
  const { events, projectPath, agentName, fromName, sinceSeq, maxChars } = input;
  const mask = (text: string) => redactSecrets(text);
  let agentId: AgentId | undefined;
  let goal: string | undefined;
  const messages: Line[] = [];
  const calls = new Map<string, { title: string; status: string; paths: string[] }>();
  for (const event of events) {
    switch (event.type) {
      case 'session.created':
        agentId = event.payload.session.agentId;
        break;
      case 'session.agent_changed':
        agentId = event.payload.agentId;
        break;
      case 'session.message_completed': {
        const { role, content, origin } = event.payload;
        if (role === 'user' && origin !== 'deny_reason') goal ??= content;
        if (sinceSeq !== undefined && event.seq <= sinceSeq) break;
        if (content.trim() === '') break;
        messages.push({ label: role === 'user' ? 'User' : agentName(agentId), content });
        break;
      }
      case 'session.tool_call':
      case 'session.tool_call_updated': {
        if (sinceSeq !== undefined && event.seq <= sinceSeq) break;
        const { toolCallId, title, status, diffs } = event.payload;
        const known = calls.get(toolCallId);
        const paths = diffs?.map((diff) => diff.path) ?? known?.paths ?? [];
        calls.set(toolCallId, { title: title === '' ? (known?.title ?? '') : title, status, paths });
        break;
      }
      default:
        break;
    }
  }

  // Completed tool calls only: one still running or that failed changed nothing to carry over.
  const done = [...calls.values()].filter((call) => call.status === 'completed');
  const files = [...new Set(done.flatMap((call) => call.paths.map((path) => projectRelative(path, projectPath))))];
  // Masked before they are cut, so a cut never leaves part of a secret too short to be recognized.
  const actions = done.filter((call) => call.title.trim() !== '').map((call) => cut(mask(call.title.trim()), MAX_ACTION_CHARS));

  const head: string[] = [
    sinceSeq === undefined
      ? `${HANDOFF_HEADER} until now this chat was with ${fromName}, which can't go on right now. You are continuing it in the same project.`
      : `${HANDOFF_HEADER} you are back in this chat. It went on with ${fromName} while you were away; here is what happened since.`,
    `Project folder: ${projectPath}`,
  ];
  if (goal !== undefined) head.push(`Original goal: ${cut(mask(goal.trim()), MAX_GOAL_CHARS)}`);
  const listed = (items: string[], max: number) => {
    const shown = items.slice(-max);
    return shown.join('; ') + (items.length > shown.length ? ` (and ${items.length - shown.length} more)` : '');
  };
  if (files.length > 0) head.push(`Files changed: ${listed(files, MAX_FILES)}`);
  if (actions.length > 0) head.push(`Actions taken: ${listed(actions, MAX_ACTIONS)}`);
  // The fixed part takes at most half the budget, so the conversation always has room.
  let fixed = mask(head.join('\n'));
  if (fixed.length > maxChars / 2) fixed = `${fixed.slice(0, Math.floor(maxChars / 2) - 1)}…`;

  const masked = messages.map((line) => ({ label: line.label, content: mask(line.content) }));
  const room = maxChars - fixed.length - 200;
  const whole: string[] = [];
  let used = 0;
  let index = masked.length - 1;
  // Newest first, whole messages, while they fit.
  for (; index >= 0; index--) {
    const line = `${masked[index]!.label}: ${masked[index]!.content}`;
    if (used + line.length + 1 > room) break;
    used += line.length + 1;
    whole.unshift(line);
  }
  // The newest alone is too long: its end, marked.
  if (whole.length === 0 && index >= 0) {
    const { label, content } = masked[index]!;
    const marker = `${label}: [shortened: only the end is kept] …`;
    const keep = Math.max(0, room - marker.length);
    whole.push(`${marker}${content.slice(content.length - keep)}`);
    used += marker.length + keep;
    index--;
  }
  // Older ones as headings, while they fit.
  const headings: string[] = [];
  for (; index >= 0; index--) {
    const line = `${masked[index]!.label}: ${firstLine(masked[index]!.content)}`;
    if (used + line.length + 1 > room) break;
    used += line.length + 1;
    headings.unshift(line);
  }
  const omitted = index + 1;
  const conversation =
    masked.length === 0
      ? ['Conversation: nothing yet.']
      : [
          `Conversation (oldest first${omitted > 0 ? `; ${omitted} earlier message${omitted === 1 ? '' : 's'} left out` : ''}${headings.length > 0 ? `; ${headings.length} older message${headings.length === 1 ? '' : 's'} cut to a first line` : ''}):`,
          ...headings,
          ...whole,
        ];
  const brief = [fixed, ...conversation].join('\n');
  return brief.length > maxChars ? brief.slice(0, maxChars) : brief;
}
