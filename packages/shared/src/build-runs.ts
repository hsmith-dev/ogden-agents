import { z } from 'zod';
import type { RunOutcome } from './entities.js';
import { AgentId } from './events-common.js';
import { RunId } from './ids.js';
import { TICKET_REF_PATTERN } from './planning-board.js';
import { IsoUtcTimestamp } from './time.js';

/**
 * A build run's frozen vocabulary (story 5.3, for epics 5 and 11): which
 * agent builds, which sandbox holds it, why a run is blocked (Ogden Agents'
 * own codes and their plain sentences, EXPERIENCE.md Voice and Tone), what
 * the user decided, the state a run shows as, the queue, and the per-run
 * JSON result the build session writes in the run's folder.
 *
 * AD-8's `outcome` (`running`, `verified`, `failed`, `blocked`, `stopped`)
 * is unchanged; {@link runPhase} derives the state the UI shows from the
 * run's own fields. How `bmad-build-auto`'s halts become these codes lives
 * only in the `buildrunner-acp` adapter (AD-12). No UI text here holds an
 * em or en dash.
 */

/**
 * The agent that builds a ticket: a registered agent's id (E6-R2: shared names
 * none; the install's build runner says which, Claude Code in v1).
 */
export const BuildAgent = AgentId;
export type BuildAgent = AgentId;

/** The sandboxes `SandboxPort` can give an unattended run (AD-17): the agent's own on macOS and Linux, then Docker. */
export const SANDBOX_KINDS = ['seatbelt', 'bubblewrap', 'docker'] as const;
export const SandboxKind = z.enum(SANDBOX_KINDS);
export type SandboxKind = z.infer<typeof SandboxKind>;

/** What a run's `sandbox` says for a build with the user watching: no sandbox, every tool call through a card (E5-R4). */
export const ATTENDED_SANDBOX = 'attended';

/** Labels for the run header's "sandbox used" (11.1). */
export const SANDBOX_LABELS: Readonly<Record<SandboxKind | typeof ATTENDED_SANDBOX, string>> = {
  seatbelt: "Claude Code's sandbox (macOS)",
  bubblewrap: "Claude Code's sandbox (Linux)",
  docker: 'Docker',
  attended: 'With you watching',
};

/** The choices the Build dialog offers when no sandbox can contain an unattended run (E5-R4, 5.6). */
export const SANDBOX_CHOICES = ['other_agent', 'install_docker', 'attended'] as const;
export const SandboxChoice = z.enum(SANDBOX_CHOICES);
export type SandboxChoice = z.infer<typeof SandboxChoice>;
export const SANDBOX_CHOICE_LABELS: Readonly<Record<SandboxChoice, string>> = {
  other_agent: 'Use another agent',
  install_docker: 'Install Docker',
  attended: 'Build with me watching',
};

/** How a build starts (5.6): `unattended` needs a sandbox; `attended` is the user watching, every tool call a permission card. */
export const BUILD_MODES = ['unattended', 'attended'] as const;
export const BuildMode = z.enum(BUILD_MODES);
export type BuildMode = z.infer<typeof BuildMode>;

/** Where a person installs Docker (the Build dialog's link; Ogden Agents never installs it). */
export const DOCKER_INSTALL_URL = 'https://docs.docker.com/get-started/get-docker/';

/** What a sandbox probe found (5.6): `usable`, or why not. */
export const SANDBOX_PROBE_KINDS = ['seatbelt', 'bubblewrap', 'landlock', 'docker'] as const;
export const SANDBOX_PROBE_STATES = ['usable', 'detected', 'missing', 'blocked', 'unsupported'] as const;
export const SandboxProbe = z.object({
  kind: z.enum(SANDBOX_PROBE_KINDS),
  /** `detected`: there, but this version of Ogden Agents cannot build with it (Landlock, Docker). */
  state: z.enum(SANDBOX_PROBE_STATES),
  /** One plain sentence. */
  note: z.string().max(500),
});
export type SandboxProbe = z.infer<typeof SandboxProbe>;

/**
 * `GET /api/v1/workspaces/:wsId/build-sandbox` (5.6): whether an unattended
 * build can be contained on this computer, in plain words, for the Build
 * dialog. `choices` is empty when it can; else its order is the dialog's,
 * and the first one that is not `other_agent` is its default (Windows: the
 * attended build). `installHint` says what to install, as text only.
 */
export const SandboxStatus = z.object({
  platform: z.enum(['macos', 'windows', 'linux', 'other']),
  available: z.boolean(),
  /** The sandbox that would hold a run (a `SandboxKind`; a test sandbox says `test`), `null` when none. */
  kind: z.string().nullable(),
  summary: z.string().max(1000),
  probes: z.array(SandboxProbe).max(8),
  choices: z.array(z.enum(['other_agent', 'install_docker', 'attended'])).max(3),
  installHint: z.string().max(1000).nullable(),
});
export type SandboxStatus = z.infer<typeof SandboxStatus>;
export const SandboxStatusResponse = z.object({ status: SandboxStatus });
export type SandboxStatusResponse = z.infer<typeof SandboxStatusResponse>;

/**
 * Why a run is `blocked` (story 5.3). Ogden Agents' own codes: the build
 * runner adapter maps each `bmad-build-auto` halt to one (AD-12); core sets
 * `merge_conflict`, `time_limit` and `interrupted`; a checkpoint pause is
 * `checkpoint_plan` or `checkpoint_done`; `other` is a halt no code names.
 */
export const BLOCKED_CODES = [
  'unclear_intent',
  'intent_gap',
  'plan_not_ready',
  'verification_failed',
  'review_loop_exceeded',
  'ticket_not_found',
  'blocked_plan',
  'checkout_problem',
  'no_subagents',
  'merge_conflict',
  'time_limit',
  'interrupted',
  'checkpoint_plan',
  'checkpoint_done',
  'agent_error',
  'auth_required',
  'usage_limit',
  'other',
] as const;
export const BlockedCode = z.enum(BLOCKED_CODES);
export type BlockedCode = z.infer<typeof BlockedCode>;

/** The blocked codes that are a checkpoint pause: Retry resumes the same run's work (5.4, 5.7). */
export const CHECKPOINT_BLOCKED_CODES: readonly BlockedCode[] = ['checkpoint_plan', 'checkpoint_done'];

/** The plain sentence for each blocked code but `time_limit`, whose sentence names its minutes ({@link blockedSentence}). */
export const BLOCKED_SENTENCES: Readonly<Record<Exclude<BlockedCode, 'time_limit'>, string>> = {
  unclear_intent: 'The story was not clear enough to build. Add detail and retry.',
  intent_gap: 'The story leaves out something the build needed. A fix was saved: apply it and retry, or add detail and retry.',
  plan_not_ready: "The build couldn't turn the story into a plan it could follow. Add detail and retry.",
  verification_failed: 'The code did not pass its own checks.',
  review_loop_exceeded: 'It could not fix the review findings after 5 tries.',
  ticket_not_found: "The build couldn't find this story or its plan.",
  blocked_plan: 'The story was already blocked when the build started. Retry once it is ready.',
  checkout_problem: "The build's copy of the project wasn't clean or on the right branch, so it stopped.",
  no_subagents: "Claude Code couldn't start the helpers the build needs.",
  merge_conflict: 'This story needs to be updated with the latest changes before it can merge.',
  interrupted: 'Stopped because Ogden Agents quit or the computer restarted. Retry to carry on.',
  checkpoint_plan: 'The plan is ready. Check it, then continue the build.',
  checkpoint_done: 'The build is finished. Check it, then continue.',
  agent_error: 'The agent stopped with an error before it finished.',
  // Epic 17: the run shows the agent's own plain reason (its name, its key or limit); these are the words when it has none.
  auth_required: 'The agent needs a valid key or sign in. Fix that in Settings, then retry.',
  usage_limit: 'The agent has reached its usage limit. Retry later, or build again with another agent.',
  other: 'The build stopped. Show details says why.',
};

/** A run's blocked code in plain words; `time_limit` names the run's limit in minutes (default 45). */
export function blockedSentence(code: BlockedCode, options: { minutes?: number } = {}): string {
  if (code === 'time_limit') return `Stopped after ${options.minutes ?? 45} minutes without finishing.`;
  return BLOCKED_SENTENCES[code];
}

/** What the user decided about a run on its review page (5.9). */
export const RUN_DECISIONS = ['approved', 'rejected'] as const;
export const RunDecision = z.enum(RUN_DECISIONS);
export type RunDecision = z.infer<typeof RunDecision>;

/**
 * The state a run shows as, derived by {@link runPhase} from its own fields
 * (never from session state or ticket status, AD-8).
 */
export const RUN_PHASES = ['queued', 'running', 'checkpoint', 'needs_you', 'interrupted', 'built', 'failed', 'stopped', 'approved', 'rejected'] as const;
export const RunPhase = z.enum(RUN_PHASES);
export type RunPhase = z.infer<typeof RunPhase>;

/** How each phase is named in the UI (run header, Runs tab, board card). */
export const RUN_PHASE_LABELS: Readonly<Record<RunPhase, string>> = {
  queued: 'Queued',
  running: 'Building',
  checkpoint: 'Waiting for you',
  needs_you: 'Blocked',
  interrupted: 'Interrupted',
  built: 'Ready for review',
  failed: 'Failed',
  stopped: 'Stopped',
  approved: 'Merged',
  rejected: 'Rejected',
};

/** The fields of a run its phase comes from. */
export interface RunPhaseFields {
  outcome: RunOutcome;
  blockedCode?: BlockedCode | null | undefined;
  queuePosition?: number | null | undefined;
  decision?: RunDecision | null | undefined;
}

/**
 * The one state a run shows as: `running` with a queue position is
 * `queued`; `blocked` is `checkpoint` (a checkpoint pause), `interrupted`
 * (Quit, a crash or a reboot) or else `needs_you`; `verified` is `approved`
 * once approved, else `built` (ready for review); `stopped` is `rejected`
 * after Reject, else `stopped` (Stop).
 */
export function runPhase(run: RunPhaseFields): RunPhase {
  switch (run.outcome) {
    case 'running':
      return run.queuePosition != null ? 'queued' : 'running';
    case 'blocked':
      if (run.blockedCode === 'checkpoint_plan' || run.blockedCode === 'checkpoint_done') return 'checkpoint';
      return run.blockedCode === 'interrupted' ? 'interrupted' : 'needs_you';
    case 'verified':
      return run.decision === 'approved' ? 'approved' : 'built';
    case 'failed':
      return 'failed';
    case 'stopped':
      return run.decision === 'rejected' ? 'rejected' : 'stopped';
  }
}

/** One waiting run in a workspace's queue (E5-R2; `position` 1 is next). */
export const RunQueueEntry = z.object({
  runId: RunId,
  ticketRef: z.string().regex(TICKET_REF_PATTERN),
  position: z.number().int().positive(),
});
export type RunQueueEntry = z.infer<typeof RunQueueEntry>;

/** The plan statuses a per-run result may report (bmad-integration.md Plan statuses). */
export const BUILD_RESULT_STATUSES = ['draft', 'ready-for-dev', 'in-progress', 'in-review', 'built', 'done', 'blocked'] as const;

/**
 * The per-run JSON result Ogden Agents' side of the build session (5.4,
 * the server, never the sandboxed agent, which cannot reach the data
 * folder) writes in the run's folder in the data folder when the session
 * ends; the runner reads it (5.7), cross-checked with the run and the plan.
 * `blockedCondition` is the skill's own words; the run's blocked code is
 * only ever `BuildRunnerPort.blockedCode(blockedCondition)`, never a code a
 * file names (AD-12, security review). Never a secret.
 */
export const BUILD_RESULT_FILE = 'result.json';
export const BUILD_ACTIVITY_FILE = 'activity.ndjson';
export const BuildRunResult = z.object({
  version: z.literal(1),
  runId: RunId,
  ticketRef: z.string().regex(TICKET_REF_PATTERN),
  /** The plan's status when the session ended, or `null` when it couldn't be read. */
  status: z.enum(BUILD_RESULT_STATUSES).nullable(),
  /** The branch's head commit when the session ended. */
  commit: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/).nullable(),
  baseRevision: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/).nullable(),
  blockedCondition: z.string().max(2000).nullable(),
  blockedReason: z.string().max(2000).nullable(),
  /** The intent-gap patch beside the plan, repo-relative, for Apply the saved fix and retry (11.1). */
  intentGapPatch: z
    .string()
    .max(1024)
    .regex(/^_bmad-output\/(?:[^/\\\0]+\/)*[^/\\\0]+\.patch$/, 'The saved fix is a .patch file under _bmad-output.')
    .refine((path) => !path.split('/').some((segment) => segment === '..' || segment === '.'), 'The saved fix is a .patch file under _bmad-output.')
    .nullable(),
  /** Whether a command failed for want of network (builds have none; story 5.2 decision). */
  networkFailure: z.boolean().default(false),
  endedAt: IsoUtcTimestamp,
});
export type BuildRunResult = z.infer<typeof BuildRunResult>;
