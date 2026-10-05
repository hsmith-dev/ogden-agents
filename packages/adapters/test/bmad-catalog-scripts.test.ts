/**
 * The fingerprint of a project's own BMad Method scripts (story 4.13, user
 * decision 2026-10-04: the script trust is bound to their contents):
 * `'none'` without `_bmad/scripts/`, a hash that changes with any file under
 * it (a planted `config_utils.py`, a module added beside it), ignores
 * `__pycache__` and line endings, and `undefined` for anything it can't hash
 * (a link). The catalog adapter answers it.
 */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBmadRepo, FAKE_TICKET_TREE_FILES, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { scriptsFingerprint } from '../src/bmad-catalog/scripts-fingerprint.js';
import { createBmadCatalog } from '../src/index.js';

const repos: FakeBmadRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.remove();
});
const repo = (files: Record<string, string> = {}, bmad = true) => {
  const made = createFakeBmadRepo({ bmad, files });
  repos.push(made);
  return made;
};
const SCRIPT = '_bmad/scripts/config_utils.py';

describe('scriptsFingerprint (story 4.13)', () => {
  it("is 'none' without _bmad/ or without _bmad/scripts/", async () => {
    expect(await scriptsFingerprint(repo({}, false).path)).toBe('none');
    expect(await scriptsFingerprint(repo().path)).toBe('none');
  });

  it('changes with a planted script or a module added beside it, and not with __pycache__ or CRLF', async () => {
    const r = repo({ [SCRIPT]: FAKE_TICKET_TREE_FILES[SCRIPT]! });
    const first = await scriptsFingerprint(r.path);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await createBmadCatalog().scriptsFingerprint(r.path)).toBe(first);

    mkdirSync(join(r.path, '_bmad', 'scripts', '__pycache__'));
    writeFileSync(join(r.path, '_bmad', 'scripts', '__pycache__', 'config_utils.cpython-312.pyc'), 'bytecode');
    expect(await scriptsFingerprint(r.path)).toBe(first);
    writeFileSync(join(r.path, SCRIPT), FAKE_TICKET_TREE_FILES[SCRIPT]!.replace(/\n/g, '\r\n'));
    expect(await scriptsFingerprint(r.path)).toBe(first);

    writeFileSync(join(r.path, SCRIPT), `import os\nos.system("touch /tmp/x")\n${FAKE_TICKET_TREE_FILES[SCRIPT]!}`);
    const planted = await scriptsFingerprint(r.path);
    expect(planted).not.toBe(first);
    writeFileSync(join(r.path, '_bmad', 'scripts', 'helper.py'), 'x = 1\n');
    expect(await scriptsFingerprint(r.path)).not.toBe(planted);
  });

  it('is undefined for a link (the scripts folder, or a file in it), and for a relative path', async () => {
    const target = repo({ [SCRIPT]: 'x = 1\n' });
    const linkedFolder = repo();
    const linkedFile = repo({ '_bmad/scripts/.keep': '' });
    try {
      symlinkSync(join(target.path, '_bmad', 'scripts'), join(linkedFolder.path, '_bmad', 'scripts'));
      symlinkSync(join(target.path, SCRIPT), join(linkedFile.path, SCRIPT));
    } catch {
      return; // No symlinks here (Windows without the privilege).
    }
    expect(await scriptsFingerprint(linkedFolder.path)).toBeUndefined();
    expect(await scriptsFingerprint(linkedFile.path)).toBeUndefined();
    expect(await scriptsFingerprint('relative/repo')).toBeUndefined();
  });
});
