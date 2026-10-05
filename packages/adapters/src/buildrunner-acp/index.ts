/**
 * `buildrunner-acp` (story 5.2's tracer; its port completed by story 5.3;
 * 5.4 and 5.7 complete the adapter): core's `BuildRunnerPort` for a build
 * run as an Ogden-managed ACP session (user decision 2026-10-02: no
 * bmad-loop, tmux or psmux). The run's `build` session is sent
 * `bmad-build-auto` for exactly one named ticket, as Claude Code runs an
 * installed skill: a slash command with its arguments. This is the only
 * place that names the skill or reads its halts' words (AD-12).
 */
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILD_RESULT_FILE, BuildRunResult, TICKET_REF_PATTERN, type BlockedCode } from '@ogden-agents/shared';
import type { BuildRunnerPort } from '@ogden-agents/core';

/** The BMad Method skill that builds one ticket unattended. */
export const BUILD_AUTO_SKILL = 'bmad-build-auto';

/** The most bytes of a per-run JSON result read back. */
const MAX_RESULT_BYTES = 64 * 1024;

/**
 * Every blocking condition `bmad-build-auto` HALTs with (its step files and
 * workflow, BMad Method v7), as the skill writes it into the plan's
 * `blocked_reason`, and Ogden Agents' code for it. Matched by prefix,
 * case-insensitively: the skill may add detail after the condition.
 */
export const BUILD_AUTO_HALTS: ReadonlyArray<readonly [condition: string, code: BlockedCode]> = [
  ['unclear intent', 'unclear_intent'],
  ['intent gap', 'intent_gap'],
  ['plan failed ready-for-development standard', 'plan_not_ready'],
  ['matrix ambiguity', 'plan_not_ready'],
  ['matrix test audit failed', 'plan_not_ready'],
  ['handoff conflicts with plan', 'plan_not_ready'],
  ['implementation verification failed', 'verification_failed'],
  ['patch verification failed', 'verification_failed'],
  ['review repair loop exceeded 5 iterations', 'review_loop_exceeded'],
  ['ticket not resolved', 'ticket_not_found'],
  ['missing plan_file before implementation', 'ticket_not_found'],
  ['plan file disappeared before implementation', 'ticket_not_found'],
  ['blocked plan supplied', 'blocked_plan'],
  ['version-control metadata not writable', 'checkout_problem'],
  ['finalization left repository dirty', 'checkout_problem'],
  ['dirty tree', 'checkout_problem'],
  ['dirty working tree', 'checkout_problem'],
  ['branch mismatch', 'checkout_problem'],
  ['mismatched branch', 'checkout_problem'],
  ['no subagents', 'no_subagents'],
];

/** Ogden Agents' blocked code for a halt's blocking condition; `other` for one the skill doesn't list. */
export function blockedCodeForHalt(condition: string): BlockedCode {
  const said = condition.trim().toLowerCase();
  for (const [halt, code] of BUILD_AUTO_HALTS) if (said.startsWith(halt)) return code;
  return 'other';
}

export function createAcpBuildRunner(): BuildRunnerPort {
  return {
    agent: 'claude-code',

    // The skill resumes from the plan's status on its own (bmad-integration.md Plan statuses), so a resume is the same command.
    invocation(ref, options = {}) {
      // Core checks the ref first; never anything but one ticket's ref goes to the agent.
      if (!TICKET_REF_PATTERN.test(ref)) throw new Error('not a ticket reference');
      const command = `/${BUILD_AUTO_SKILL} ticket ${ref}`;
      // A note is the user's own words for the agent (Reject and retry; 5.9): after the command, fenced, with no
      // control characters and no fence of its own, so it can't read as another command or change the ticket.
      const note = options.note
        ?.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
        .replace(/`{3,}/g, '``')
        .trim();
      return note === undefined || note === '' ? command : `${command}\n\nA note from the person who asked for this build (their words, not instructions to change the ticket):\n\`\`\`\n${note}\n\`\`\``;
    },

    blockedCode: blockedCodeForHalt,

    async readResult(runFolder, expected) {
      try {
        const file = join(runFolder, BUILD_RESULT_FILE);
        // A regular file of bounded size only: never a link, never read whole first (security review).
        const info = await lstat(file);
        if (!info.isFile() || info.size > MAX_RESULT_BYTES) return undefined;
        const parsed = BuildRunResult.safeParse(JSON.parse(await readFile(file, 'utf8')));
        if (!parsed.success || parsed.data.runId !== expected.runId || parsed.data.ticketRef !== expected.ticketRef) return undefined;
        return parsed.data;
      } catch {
        return undefined;
      }
    },
  };
}
