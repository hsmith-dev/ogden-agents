/**
 * The Workbench's Files use-case (AD-36): the client's path is checked
 * (relative, `/`, no `..`, `\`, `:` or NUL) and refused by name (`.git`,
 * credential folders but `.claude`, folded) before the port is asked; the
 * workspace's real path is the root; the port's refusals become
 * `PathProtectedError` and `NotFoundError`; without a port there is no
 * use-case; nothing is appended to the event log.
 */
import { realpathSync } from 'node:fs';
import { WORKSPACE_PATH_HARD_LINK_MESSAGE } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { isRefusedWorkspacePath, NotFoundError, PathProtectedError, ValidationError, type WorkspaceFilesPort, type WorkspacePathRefusal } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

/** A port that records each call and answers `answer`. */
function recordingPort(answer: WorkspacePathRefusal | 'ok' = 'ok') {
  const calls: Array<{ op: 'list' | 'read'; root: string; path: string }> = [];
  const port: WorkspaceFilesPort = {
    list: async (root, path) => {
      calls.push({ op: 'list', root, path });
      return answer === 'ok' ? { path, entries: [], truncated: false } : answer;
    },
    read: async (root, path) => {
      calls.push({ op: 'read', root, path });
      return answer === 'ok' ? { kind: 'text', path, content: 'hello', size: 5, masked: false } : answer;
    },
  };
  return { port, calls };
}

describe('workspace files use-case', () => {
  it('is undefined without a port', () => {
    expect(openTestCore().workspaceFiles).toBeUndefined();
  });

  it("lists the root and reads a file at the workspace's real path, appending nothing", async () => {
    const { port, calls } = recordingPort();
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: port });
    const repo = tempDir();
    const ws = core.entities.ensureWorkspace(repo);
    const seq = core.events.readAfter(0).length;
    expect(await core.workspaceFiles!.list(ws.id, undefined)).toEqual({ path: '', entries: [], truncated: false });
    expect(await core.workspaceFiles!.list(ws.id, '')).toEqual({ path: '', entries: [], truncated: false });
    expect(await core.workspaceFiles!.read(ws.id, 'src/a.ts')).toEqual({ kind: 'text', path: 'src/a.ts', content: 'hello', size: 5, masked: false });
    expect(calls).toEqual([
      { op: 'list', root: realpathSync.native(repo), path: '' },
      { op: 'list', root: realpathSync.native(repo), path: '' },
      { op: 'read', root: realpathSync.native(repo), path: 'src/a.ts' },
    ]);
    expect(core.events.readAfter(0)).toHaveLength(seq);
  });

  it('refuses a malformed path with a ValidationError, asking the port nothing', async () => {
    const { port, calls } = recordingPort();
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: port });
    const ws = core.entities.ensureWorkspace(tempDir());
    for (const path of ['../x', 'a/../b', '/etc/passwd', 'C:/x', 'a\\b', 'a:b', 'a\0b', 'a//b', './a', 'a/', 42, null]) {
      await expect(core.workspaceFiles!.read(ws.id, path), String(path)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(core.workspaceFiles!.read(ws.id, undefined)).rejects.toBeInstanceOf(ValidationError);
    await expect(core.workspaceFiles!.list(ws.id, '../x')).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toEqual([]);
  });

  it('refuses .git and credential folders by name, folded, asking the port nothing; .claude, AGENTS.md and _bmad pass', async () => {
    const { port, calls } = recordingPort();
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: port });
    const ws = core.entities.ensureWorkspace(tempDir());
    for (const path of ['.git/config', '.GIT/HEAD', '.git./x', 'a/.git', '.ssh/id_rsa', '.Ssh ', 'Library/Keychains/k', '.aws/credentials', '.config/gh/hosts.yml']) {
      await expect(core.workspaceFiles!.read(ws.id, path), path).rejects.toBeInstanceOf(PathProtectedError);
      await expect(core.workspaceFiles!.list(ws.id, path), path).rejects.toBeInstanceOf(PathProtectedError);
    }
    expect(calls).toEqual([]);
    for (const path of ['.claude/settings.json', 'AGENTS.md', 'CLAUDE.md', '_bmad/core/config.yaml', 'Library/notes.md', '.github/workflows/ci.yml']) {
      await expect(core.workspaceFiles!.read(ws.id, path), path).resolves.toMatchObject({ kind: 'text' });
    }
  });

  it("turns the port's refusals into PathProtectedError and NotFoundError, never naming the path", async () => {
    const protectedCore = openTestCore(undefined, undefined, { workspaceFilesPort: recordingPort({ refused: 'protected' }).port });
    const a = protectedCore.entities.ensureWorkspace(tempDir());
    await expect(protectedCore.workspaceFiles!.read(a.id, 'out/secret')).rejects.toBeInstanceOf(PathProtectedError);
    const missingCore = openTestCore(undefined, undefined, { workspaceFilesPort: recordingPort({ refused: 'not_found' }).port });
    const b = missingCore.entities.ensureWorkspace(tempDir());
    const error = await missingCore.workspaceFiles!.list(b.id, 'gone-folder').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as Error).message).not.toContain('gone-folder');
  });

  it('answers NotFoundError for an unknown or malformed workspace id', async () => {
    const { port, calls } = recordingPort();
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: port });
    await expect(core.workspaceFiles!.list('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', '')).rejects.toBeInstanceOf(NotFoundError);
    await expect(core.workspaceFiles!.read('nope', 'a.txt')).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toEqual([]);
  });

  it('isRefusedWorkspacePath matches whole segments and runs only', () => {
    expect(isRefusedWorkspacePath(['.gitignore'])).toBe(false);
    expect(isRefusedWorkspacePath(['src', '.git'])).toBe(true);
    expect(isRefusedWorkspacePath(['Library'])).toBe(false);
    expect(isRefusedWorkspacePath(['Keychains'])).toBe(false);
    expect(isRefusedWorkspacePath(['x', 'LIBRARY', 'keychains.'])).toBe(true);
    expect(isRefusedWorkspacePath(['Library', 'Application Support', 'Google', 'Chrome'])).toBe(true);
    expect(isRefusedWorkspacePath(['.claude'])).toBe(false);
    expect(isRefusedWorkspacePath(['.claude.json'])).toBe(true);
  });

  it('refuses any segment ending in .git (a bare repository), folded, asking the port nothing; .github and .gitignore pass', async () => {
    const { port, calls } = recordingPort();
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: port });
    const ws = core.entities.ensureWorkspace(tempDir());
    for (const path of ['repo.git', 'repo.git/config', 'a/b/Mirror.GIT/HEAD', 'x.git. /objects', 'repo.\uff47it/config', 'repo.\uff27\uff29\uff34/HEAD']) {
      await expect(core.workspaceFiles!.read(ws.id, path), path).rejects.toBeInstanceOf(PathProtectedError);
      await expect(core.workspaceFiles!.list(ws.id, path), path).rejects.toBeInstanceOf(PathProtectedError);
    }
    expect(calls).toEqual([]);
    for (const path of ['.github/workflows/ci.yml', '.gitignore', 'src/a.gitignore', 'git/x', 'digit']) {
      await expect(core.workspaceFiles!.read(ws.id, path), path).resolves.toMatchObject({ kind: 'text' });
    }
    expect(isRefusedWorkspacePath(['src', 'repo.git'])).toBe(true);
    expect(isRefusedWorkspacePath(['repo.gitx'])).toBe(false);
  });

  it("turns the port's hard-link refusal into PathProtectedError with the hard-link message", async () => {
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: recordingPort({ refused: 'protected', reason: 'hard_link' }).port });
    const ws = core.entities.ensureWorkspace(tempDir());
    const error = await core.workspaceFiles!.read(ws.id, 'notes.txt').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PathProtectedError);
    expect((error as Error).message).toBe(WORKSPACE_PATH_HARD_LINK_MESSAGE);
    expect((error as Error).message).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('workspace files use-case: review rows (defensive check)', () => {
  it('refuses Windows path forms (UNC, device, drive-relative, alternate data streams) and an over-long path as malformed', async () => {
    const { port, calls } = recordingPort();
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: port });
    const ws = core.entities.ensureWorkspace(tempDir());
    const paths = ['//server/share/x', '\\\\server\\share\\x', '\\\\?\\C:\\x', '//./CON', '//?/C:/x', 'C:x', 'c:', '.env::$DATA', 'a.txt:secret', '.git::$INDEX_ALLOCATION/config', 'x'.repeat(4097), 'a/./b', '..', '.'];
    for (const path of paths) {
      await expect(core.workspaceFiles!.read(ws.id, path), path.slice(0, 40)).rejects.toBeInstanceOf(ValidationError);
      await expect(core.workspaceFiles!.list(ws.id, path), path.slice(0, 40)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(calls).toEqual([]);
  });

  it('refuses trailing dot and space runs, mixed case and the Kelvin-sign variant by name, asking the port nothing', async () => {
    const { port, calls } = recordingPort();
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: port });
    const ws = core.entities.ensureWorkspace(tempDir());
    for (const path of ['.git. . ./config', '.GiT  /HEAD', 'src/.Git./objects', '.\u212aube/config', 'LIBRARY /keychains./login.keychain-db', '.Local/Share/Keyrings/x', '.CONFIG/gh/hosts.yml', '.claude.json', '.Claude.JSON.']) {
      await expect(core.workspaceFiles!.read(ws.id, path), path).rejects.toBeInstanceOf(PathProtectedError);
    }
    expect(calls).toEqual([]);
  });

  it('passes a percent-encoded or look-alike name to the port as the literal name it is, never decoding it', async () => {
    const { port, calls } = recordingPort();
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: port });
    const ws = core.entities.ensureWorkspace(tempDir());
    for (const path of ['%2e%2e/x', '.%67it/config', '..notes', '...']) await core.workspaceFiles!.read(ws.id, path);
    expect(calls.map((call) => call.path)).toEqual(['%2e%2e/x', '.%67it/config', '..notes', '...']);
  });

  // Defence in depth: APFS and NTFS fold U+017F (long s) to `s`, so `.ſſh` opens `.ssh`; core's fold refuses it by name too.
  it('refuses the long-s variant of .ssh by name, asking the port nothing', async () => {
    const { port, calls } = recordingPort();
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: port });
    const ws = core.entities.ensureWorkspace(tempDir());
    await expect(core.workspaceFiles!.read(ws.id, '.\u017f\u017fh/id_rsa')).rejects.toBeInstanceOf(PathProtectedError);
    expect(calls).toEqual([]);
  });
});
