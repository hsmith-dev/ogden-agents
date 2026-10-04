/**
 * The build session's permission policy (story 5.2, user decision
 * 2026-10-04): deny by default, enforced by core with no card. Pure: the
 * path rules are played with an injected normalizer (symlinks, `..`,
 * case-insensitive filesystems, Windows 8.3 names), plus one check on this
 * computer's real filesystem.
 */
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentPermissionRequest } from '../src/agent-port.js';
import { decideBuildPermission, nodePathNormalizer, normalizeBuildPath, type BuildPermissionScope, type PathNormalizer } from '../src/build-permission-policy.js';
import { PROTECTED_PATHS } from '../src/permission-matching.js';

/** A normalizer over a fake filesystem: `links` maps a real-path prefix to where it leads. */
function fakeFs({ platform = 'posix', links = {}, insensitive = false }: { platform?: 'posix' | 'win32'; links?: Record<string, string>; insensitive?: boolean } = {}): PathNormalizer {
  return {
    platform,
    realpath(path) {
      for (const [from, to] of Object.entries(links)) {
        if (path === from || path.startsWith(`${from}${platform === 'win32' ? '\\' : '/'}`)) return to + path.slice(from.length);
      }
      return path;
    },
    caseInsensitive: () => insensitive,
  };
}

const POSIX_SCOPE: BuildPermissionScope = {
  worktree: '/data/w/abcdefgh',
  gitWritable: ['/repo/.git/objects', '/repo/.git/refs', '/repo/.git/logs', '/repo/.git/worktrees/abcdefgh'],
  protectedPaths: PROTECTED_PATHS,
};

const edit = (...paths: string[]): AgentPermissionRequest => ({ toolCallId: 't', title: 'Write', kind: 'edit', paths });

describe('decideBuildPermission (story 5.2)', () => {
  it('allows a file edit or write whose every path is inside the worktree, relative ones against it', () => {
    const fs = fakeFs();
    expect(decideBuildPermission(edit('/data/w/abcdefgh/src/a.ts'), POSIX_SCOPE, fs)).toEqual({ outcome: 'allow_once' });
    expect(decideBuildPermission(edit('src/a.ts', '/data/w/abcdefgh/README.md'), POSIX_SCOPE, fs)).toEqual({ outcome: 'allow_once' });
    expect(decideBuildPermission(edit('_bmad-output/initiative/plan.md'), POSIX_SCOPE, fs).outcome).toBe('allow_once');
  });

  it('allows the git paths a commit there needs, never hooks or config', () => {
    const fs = fakeFs();
    expect(decideBuildPermission(edit('/repo/.git/objects/ab/cdef'), POSIX_SCOPE, fs).outcome).toBe('allow_once');
    expect(decideBuildPermission(edit('/repo/.git/worktrees/abcdefgh/index'), POSIX_SCOPE, fs).outcome).toBe('allow_once');
    expect(decideBuildPermission(edit('/repo/.git/hooks/pre-commit'), POSIX_SCOPE, fs).outcome).toBe('deny');
    expect(decideBuildPermission(edit('/repo/.git/config'), POSIX_SCOPE, fs).outcome).toBe('deny');
    expect(decideBuildPermission(edit('/repo/.git/worktrees/other/index'), POSIX_SCOPE, fs).outcome).toBe('deny');
  });

  it('denies a path outside, one that leaves through `..`, the worktree itself, `~`, and a mix with one outside', () => {
    const fs = fakeFs();
    for (const path of ['/etc/passwd', '../escape.txt', '/data/w/abcdefgh/../other/x', '/data/w/abcdefghi/x', '/data/w/abcdefgh', '~/.zshrc', '']) {
      expect(decideBuildPermission(edit(path), POSIX_SCOPE, fs).outcome, path).toBe('deny');
    }
    expect(decideBuildPermission(edit('src/a.ts', '/tmp/b.ts'), POSIX_SCOPE, fs).outcome).toBe('deny');
  });

  it('denies the protected paths at any depth: _bmad, .git, .claude, AGENTS.md, …', () => {
    const fs = fakeFs();
    for (const path of ['_bmad/scripts/config_utils.py', '.git', 'sub/.git/hooks/x', '.claude/settings.json', 'docs/AGENTS.md', 'CLAUDE.md', '.mcp.json', '.envrc', '_BMAD/x']) {
      expect(decideBuildPermission(edit(path), POSIX_SCOPE, fs).outcome, path).toBe('deny');
    }
  });

  it('resolves symlinks: a link inside that leads outside is denied, a link outside that leads inside is allowed', () => {
    const fs = fakeFs({ links: { '/data/w/abcdefgh/out': '/etc', '/elsewhere': '/data/w/abcdefgh/src' } });
    expect(decideBuildPermission(edit('out/passwd'), POSIX_SCOPE, fs).outcome).toBe('deny');
    expect(decideBuildPermission(edit('/elsewhere/a.ts'), POSIX_SCOPE, fs).outcome).toBe('allow_once');
    // A link to a protected folder counts as it.
    const toBmad = fakeFs({ links: { '/data/w/abcdefgh/lib': '/data/w/abcdefgh/_bmad' } });
    expect(decideBuildPermission(edit('lib/scripts/x.py'), POSIX_SCOPE, toBmad).outcome).toBe('deny');
    // A path that can't be resolved is denied.
    const broken: PathNormalizer = { ...fakeFs(), realpath: (path) => (path.includes('gone') ? undefined : path) };
    expect(decideBuildPermission(edit('gone/x'), POSIX_SCOPE, broken).outcome).toBe('deny');
  });

  it('compares case-insensitively only where the filesystem is', () => {
    expect(decideBuildPermission(edit('/DATA/W/ABCDEFGH/src/a.ts'), POSIX_SCOPE, fakeFs({ insensitive: true })).outcome).toBe('allow_once');
    expect(decideBuildPermission(edit('/DATA/W/ABCDEFGH/src/a.ts'), POSIX_SCOPE, fakeFs()).outcome).toBe('deny');
    expect(decideBuildPermission(edit('/REPO/.GIT/HOOKS/x'), POSIX_SCOPE, fakeFs({ insensitive: true })).outcome).toBe('deny');
  });

  it('on Windows: inside allowed, an 8.3 short name refused, another drive denied', () => {
    const scope: BuildPermissionScope = { worktree: 'C:\\Data\\w\\abcdefgh', gitWritable: ['C:\\repo\\.git\\objects'], protectedPaths: PROTECTED_PATHS };
    const fs = fakeFs({ platform: 'win32', insensitive: true });
    expect(decideBuildPermission(edit('C:\\Data\\w\\abcdefgh\\src\\a.ts'), scope, fs).outcome).toBe('allow_once');
    expect(decideBuildPermission(edit('src\\a.ts'), scope, fs).outcome).toBe('allow_once');
    expect(decideBuildPermission(edit('c:\\data\\W\\ABCDEFGH\\src\\a.ts'), scope, fs).outcome).toBe('allow_once');
    expect(decideBuildPermission(edit('C:\\Data\\w\\ABCDEF~1\\src\\a.ts'), scope, fs).outcome).toBe('deny');
    expect(normalizeBuildPath('C:\\PROGRA~1\\x', scope.worktree, fs)).toBeUndefined();
    expect(decideBuildPermission(edit('D:\\Data\\w\\abcdefgh\\a.ts'), scope, fs).outcome).toBe('deny');
    expect(decideBuildPermission(edit('C:\\Data\\w\\abcdefgh\\_bmad\\x'), scope, fs).outcome).toBe('deny');
  });

  it('decides on the raw paths, never the masked ones shown to the user (review loop 1)', () => {
    const fs = fakeFs();
    const masked = { toolCallId: 't', title: 'Write', kind: 'edit', paths: ['/data/w/abcdefgh/[redacted]'], rawPaths: ['/etc/sk-secret'] };
    expect(decideBuildPermission(masked, POSIX_SCOPE, fs).outcome).toBe('deny');
    expect(decideBuildPermission({ ...masked, rawPaths: ['/data/w/abcdefgh/a.ts'] }, POSIX_SCOPE, fs).outcome).toBe('allow_once');
  });

  it('denies everything that is not a file edit: commands, reads, fetches, MCP, unknown, and an edit naming no path', () => {
    const fs = fakeFs();
    for (const kind of ['execute', 'read', 'fetch', 'search', 'delete', 'move', 'switch_mode', 'other', 'think', undefined]) {
      expect(decideBuildPermission({ toolCallId: 't', title: 'x', kind, paths: ['src/a.ts'] }, POSIX_SCOPE, fs).outcome, String(kind)).toBe('deny');
    }
    expect(decideBuildPermission({ toolCallId: 't', title: 'mcp__server__tool', paths: [] }, POSIX_SCOPE, fs).outcome).toBe('deny');
    expect(decideBuildPermission(edit(), POSIX_SCOPE, fs).outcome).toBe('deny');
  });
});

describe("decideBuildPermission on this computer's filesystem", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('follows a real symlink out of the worktree, and allows a new file in a new folder inside it', () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-policy-')));
    dirs.push(root);
    const worktree = join(root, 'w', 'abcdefgh');
    mkdirSync(worktree, { recursive: true });
    mkdirSync(join(root, 'outside'));
    try {
      symlinkSync(join(root, 'outside'), join(worktree, 'link'), 'dir');
    } catch {
      // No symlinks here (Windows without the privilege): the fake filesystem cases above cover it.
      return;
    }
    const scope = { worktree, gitWritable: [], protectedPaths: PROTECTED_PATHS };
    const fs = nodePathNormalizer();
    expect(decideBuildPermission(edit('link/x.txt'), scope, fs).outcome).toBe('deny');
    expect(decideBuildPermission(edit('new/deeper/x.txt'), scope, fs).outcome).toBe('allow_once');
  });

  it('refuses a dangling symlink (a write would follow it out) and a file with a second hard link (review loop 1)', () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-policy-')));
    dirs.push(root);
    const worktree = join(root, 'w', 'abcdefgh');
    mkdirSync(worktree, { recursive: true });
    const scope = { worktree, gitWritable: [], protectedPaths: PROTECTED_PATHS };
    const fs = nodePathNormalizer();
    writeFileSync(join(root, 'outside.txt'), 'x');
    writeFileSync(join(worktree, 'mine.txt'), 'x');
    expect(decideBuildPermission(edit('mine.txt'), scope, fs).outcome).toBe('allow_once');
    linkSync(join(root, 'outside.txt'), join(worktree, 'linked.txt'));
    expect(decideBuildPermission(edit('linked.txt'), scope, fs).outcome).toBe('deny');
    try {
      symlinkSync(join(root, 'not-yet'), join(worktree, 'dangling'), 'file');
      symlinkSync(join(root, 'no-dir'), join(worktree, 'dangling-dir'), 'dir');
    } catch {
      return;
    }
    expect(decideBuildPermission(edit('dangling'), scope, fs).outcome).toBe('deny');
    expect(decideBuildPermission(edit('dangling-dir/x.txt'), scope, fs).outcome).toBe('deny');
  });
});
