/**
 * Open in editor's launcher in a test run (story 8.10): confined to the
 * folder `OGDEN_AGENTS_TEST_EDITOR_PATH` names, by real path. `''` finds
 * nothing; a link in the folder that leads out of it (to a real program) is
 * not found; a fake `code` in the folder is.
 */
import { chmodSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServerEditorLauncher } from '../src/start-editor.js';
import { tempDataDir } from './helpers.js';

describe.skipIf(process.platform === 'win32')('createServerEditorLauncher in a test run', () => {
  it("'' lists nothing", async () => {
    expect(await createServerEditorLauncher({}, { editorPath: '' }).list()).toEqual([]);
  });

  it('does not find a link out of the folder, and finds a fake code in it', async () => {
    const folder = realpathSync(tempDataDir());
    const outside = realpathSync(tempDataDir());
    writeFileSync(join(outside, 'real-code'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(outside, 'real-code'), 0o755);
    symlinkSync(join(outside, 'real-code'), join(folder, 'code'));
    expect(await createServerEditorLauncher({}, { editorPath: folder }).list()).toEqual([]);

    const fakes = realpathSync(tempDataDir());
    writeFileSync(join(fakes, 'code'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(fakes, 'code'), 0o755);
    expect(await createServerEditorLauncher({}, { editorPath: fakes }).list()).toEqual([{ id: 'vscode', name: 'VS Code' }]);
  });
});
