/**
 * The review findings of a build (story 5.9, E5-R9): what `bmad-build-auto`
 * wrote in the plan's Review Triage Log, read as plain text for the review
 * page. Ogden Agents runs no review of its own. The plan is read from the
 * run's worktree only when it is a plain file inside it (the same check the
 * board uses), at most {@link MAX_PLAN_BYTES}; each finding is masked and
 * cut. A plan with no log, or one that can't be read, has no findings.
 */
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewFinding } from '@ogden-agents/shared';
import { planConfined } from './run-aware-tickets.js';

const MAX_PLAN_BYTES = 512 * 1024;
const MAX_FINDINGS = 60;
const MAX_FINDING_CHARS = 600;

/** The findings in the plan text `markdown`: the bullets of its `## Review Triage Log` section. */
export function parseTriageLog(markdown: string, mask: (text: string) => string = (text) => text): ReviewFinding[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Review Triage Log\s*$/i.test(line));
  if (start === -1) return [];
  const bullets: Array<{ indent: number; text: string }> = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const found = /^(\s*)[-*]\s+(.*\S)\s*$/.exec(line);
    if (found !== null) bullets.push({ indent: found[1]!.length, text: found[2]! });
    // A wrapped line belongs to the bullet above it.
    else if (bullets.length > 0 && /^\s+\S/.test(line)) bullets[bullets.length - 1]!.text += ` ${line.trim()}`;
  }
  // The log groups findings under a pass heading (a top-level bullet); when there are nested bullets, those are the findings.
  const nested = bullets.some((bullet) => bullet.indent > 0);
  const chosen = nested ? bullets.filter((bullet) => bullet.indent > 0) : bullets;
  return chosen.slice(0, MAX_FINDINGS).map((bullet): ReviewFinding => {
    const text = mask(bullet.text.replace(/`/g, '')).slice(0, MAX_FINDING_CHARS);
    const severity = /\b(high|medium|low)\b/i.exec(text)?.[1]?.toLowerCase() as ReviewFinding['severity'] | undefined;
    return { kind: /\bdefer(?:red)?\b/i.test(text) ? 'deferred' : 'finding', severity: severity ?? null, text };
  });
}

/** The findings of the plan `plan` (repo-relative) in `worktree`; empty when it isn't a plain file there. Never throws. */
export function readPlanFindings(worktree: string | null, plan: string | null, mask?: (text: string) => string): ReviewFinding[] {
  if (worktree === null || plan === null || !planConfined(worktree, plan)) return [];
  let fd: number | undefined;
  try {
    // Opened without following a link and without blocking (a swapped-in FIFO), then judged on the opened file itself and read bounded.
    fd = openSync(join(worktree, ...plan.split('/')), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > MAX_PLAN_BYTES) return [];
    const buffer = Buffer.alloc(info.size);
    let read = 0;
    while (read < buffer.length) {
      const got = readSync(fd, buffer, read, buffer.length - read, read);
      if (got === 0) break;
      read += got;
    }
    return parseTriageLog(buffer.subarray(0, read).toString('utf8'), mask);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
