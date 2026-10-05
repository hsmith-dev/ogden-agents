/**
 * `scripts/bmad-fork-sync.mjs` without git or the network (the
 * maintained-fork story, user decision 2026-10-04): it pushes only to the
 * fork, never to anything of bmad-code-org, names each sync's tag without
 * reusing one, and prints the lock entry with the upstream base.
 */
import { describe, expect, it } from 'vitest';
import { FORK_URL, lockEntry, nextTag, pushAllowed, UPSTREAM_URL } from '../scripts/bmad-fork-sync.mjs';

describe('bmad-fork-sync.mjs', () => {
  it('pushes only to the fork, never to upstream', () => {
    expect(pushAllowed(FORK_URL)).toBe(true);
    expect(pushAllowed('https://github.com/hsmith-dev/BMAD-METHOD')).toBe(true);
    expect(pushAllowed('git@github.com:hsmith-dev/BMAD-METHOD.git')).toBe(true);
    expect(pushAllowed(UPSTREAM_URL)).toBe(false);
    expect(pushAllowed('git@github.com:bmad-code-org/BMAD-METHOD.git')).toBe(false);
    expect(pushAllowed('https://github.com/hsmith-dev/bmad-code-org-mirror.git')).toBe(false);
    expect(pushAllowed('no-push-to-upstream')).toBe(false);
  });

  it('names a new tag per sync and never reuses one', () => {
    expect(nextTag([], '2026-10-04')).toBe('ogden-agents/2026-10-04');
    expect(nextTag(['ogden-agents/2026-10-04'], '2026-10-04')).toBe('ogden-agents/2026-10-04.2');
    expect(nextTag(['ogden-agents/2026-10-04', 'ogden-agents/2026-10-04.2'], '2026-10-04')).toBe('ogden-agents/2026-10-04.3');
  });

  it('prints the lock entry on the fork, with the upstream base', () => {
    const commit = 'a'.repeat(40);
    const base = 'b'.repeat(40);
    expect(lockEntry({ commit, tag: 'ogden-agents/2026-10-04', base, version: '6.13.0-next' })).toMatchObject({
      repo: 'hsmith-dev/BMAD-METHOD',
      ref: 'ogden-agents/2026-10-04',
      commit,
      base: { repo: 'bmad-code-org/BMAD-METHOD', ref: 'main', commit: base },
    });
  });
});
