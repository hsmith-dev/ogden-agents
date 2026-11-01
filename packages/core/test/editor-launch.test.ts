/**
 * Open in editor's choice (AD-39; story 8.10): Settings, Projects, Editor
 * keeps one editor in `<dataDir>/editor.json` (0600, replaced in one step);
 * the default is the chosen one while it is found, else the first found;
 * only an editor found now can be chosen; an unreadable record reads as no
 * choice, reported by its code only. An open with no editor named uses the
 * default.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EditorInfo } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createEditorChoice, EDITOR_CHOICE_FILE, EditorUnavailableError, ValidationError, type EditorLauncherPort, type WorkspaceFilesPort } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

function launcher(editors: EditorInfo[]) {
  const opens: string[] = [];
  const port: EditorLauncherPort & { editors: EditorInfo[] } = {
    editors,
    list: async () => [...port.editors],
    open: async (editorId) => {
      opens.push(editorId);
      return 'opened';
    },
  };
  return { port, opens };
}

const files: WorkspaceFilesPort = {
  list: async (_root, path) => ({ path, entries: [], truncated: false }),
  read: async (_root, path) => ({ kind: 'text', path, content: 'x', size: 1, masked: false }),
  locate: async (root, path) => ({ realPath: join(root, path) }),
};

const VSCODE = { id: 'vscode', name: 'VS Code' };
const CURSOR = { id: 'cursor', name: 'Cursor' };

describe('the editor choice (8.10)', () => {
  it('defaults to the first found; a chosen editor is kept, becomes the default and opens files; gone, the default falls back', async () => {
    const dataDir = tempDir();
    const editor = launcher([VSCODE, CURSOR]);
    const core = openTestCore(dataDir, undefined, { workspaceFilesPort: files, editorLauncherPort: editor.port });
    const repo = tempDir();
    const workspace = core.entities.ensureWorkspace(repo);
    const launch = core.editorLaunch!;
    expect(await launch.editors()).toEqual({ editors: [VSCODE, CURSOR], defaultEditorId: 'vscode', chosenEditorId: null });

    expect(await launch.setChoice({ editorId: 'cursor' })).toEqual({ editors: [VSCODE, CURSOR], defaultEditorId: 'cursor', chosenEditorId: 'cursor' });
    expect(JSON.parse(readFileSync(join(dataDir, EDITOR_CHOICE_FILE), 'utf8'))).toEqual({ editorId: 'cursor' });
    if (process.platform !== 'win32') expect(statSync(join(dataDir, EDITOR_CHOICE_FILE)).mode & 0o777).toBe(0o600);
    expect(await launch.open(workspace.id, { path: 'src/a.ts', line: 3 })).toEqual({ editorId: 'cursor', editorName: 'Cursor' });
    // Named, it still wins over the choice.
    expect(await launch.open(workspace.id, { path: 'src/a.ts', editorId: 'vscode' })).toEqual({ editorId: 'vscode', editorName: 'VS Code' });
    expect(editor.opens).toEqual(['cursor', 'vscode']);

    // Cursor uninstalled: the choice is kept, the default is the first found again.
    editor.port.editors = [VSCODE];
    expect(await launch.editors()).toEqual({ editors: [VSCODE], defaultEditorId: 'vscode', chosenEditorId: 'cursor' });
    expect(await launch.open(workspace.id, { path: 'src/a.ts' })).toEqual({ editorId: 'vscode', editorName: 'VS Code' });

    // `null` forgets it.
    expect(await launch.setChoice({ editorId: null })).toMatchObject({ defaultEditorId: 'vscode', chosenEditorId: null });
  });

  it('refuses an editor not found now (409) and a malformed body (400), keeping nothing', async () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir, undefined, { workspaceFilesPort: files, editorLauncherPort: launcher([VSCODE]).port });
    const launch = core.editorLaunch!;
    await expect(launch.setChoice({ editorId: 'cursor' })).rejects.toBeInstanceOf(EditorUnavailableError);
    for (const body of [{}, { editorId: 'Not An Id' }, { editorId: '../code' }, { editorId: 'vscode', path: '/usr/bin/sh' }, null, 'vscode']) await expect(launch.setChoice(body), JSON.stringify(body)).rejects.toBeInstanceOf(ValidationError);
    expect(() => statSync(join(dataDir, EDITOR_CHOICE_FILE))).toThrow();
    const none = openTestCore(tempDir(), undefined, { workspaceFilesPort: files, editorLauncherPort: launcher([]).port });
    expect(await none.editorLaunch!.editors()).toEqual({ editors: [], defaultEditorId: null, chosenEditorId: null });
    await expect(none.editorLaunch!.setChoice({ editorId: 'vscode' })).rejects.toBeInstanceOf(EditorUnavailableError);
  });

  it('reads an unusable record as no choice and reports its code once', () => {
    const dataDir = tempDir();
    const codes: string[] = [];
    const choice = createEditorChoice({ dataDir, onError: (code) => codes.push(code) });
    expect(choice.get()).toBeNull();
    writeFileSync(join(dataDir, EDITOR_CHOICE_FILE), 'not json');
    expect(choice.get()).toBeNull();
    writeFileSync(join(dataDir, EDITOR_CHOICE_FILE), JSON.stringify({ editorId: '/usr/bin/sh' }));
    expect(choice.get()).toBeNull();
    expect(codes).toEqual(['corrupt']);
    choice.set('zed');
    expect(choice.get()).toBe('zed');
    const folder = join(tempDir(), 'editor.json');
    mkdirSync(folder);
    const unreadable = createEditorChoice({ dataDir: join(folder, '..'), onError: (code) => codes.push(code) });
    expect(unreadable.get()).toBeNull();
    expect(codes.at(-1)).toMatch(/^E[A-Z]+$/);
  });
});
