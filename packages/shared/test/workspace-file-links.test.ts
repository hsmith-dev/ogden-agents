/**
 * 8.7's contract: the links request (at most 100 `WorkspaceRelativePath`s,
 * strict) and its answer (paths only), the viewer's size words, and the
 * binary and too-large sentences as EXPERIENCE.md words them.
 */
import { describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  fileSizeWords,
  MAX_WORKSPACE_FILE_BYTES,
  MAX_WORKSPACE_FILE_LINKS,
  WORKSPACE_FILE_BINARY_TEXT,
  WORKSPACE_FILE_COPY_PATH_LABEL,
  WORKSPACE_FILE_SHOW_SOURCE_LABEL,
  WorkspaceFileLinksRequest,
  WorkspaceFileLinksResponse,
  workspaceFileLinkTitle,
  workspaceFileTooLargeText,
} from '../src/index.js';

describe('workspace file links contract (8.7)', () => {
  it('takes at most 100 workspace-relative paths and an optional session, nothing else', () => {
    expect(MAX_WORKSPACE_FILE_LINKS).toBe(100);
    expect(API_ROUTES.workspaceFileLinks).toBe('/api/v1/workspaces/:wsId/files/links');
    expect(WorkspaceFileLinksRequest.safeParse({ paths: ['src/a.ts', 'README.md'] }).success).toBe(true);
    expect(WorkspaceFileLinksRequest.safeParse({ paths: [], session: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3' }).success).toBe(true);
    expect(WorkspaceFileLinksRequest.safeParse({ paths: Array.from({ length: 100 }, (_, i) => `f${i}`) }).success).toBe(true);
    for (const body of [
      { paths: Array.from({ length: 101 }, (_, i) => `f${i}`) },
      { paths: ['../x'] },
      { paths: ['/etc/passwd'] },
      { paths: ['a\\b'] },
      { paths: ['C:/x'] },
      { paths: ['a//b'] },
      { paths: ['./a'] },
      { paths: [''] },
      { paths: 'src/a.ts' },
      { paths: [], session: 'nope' },
      { paths: [], extra: true },
      {},
    ]) {
      expect(WorkspaceFileLinksRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('answers paths only', () => {
    expect(WorkspaceFileLinksResponse.parse({ found: ['src/a.ts'] })).toEqual({ found: ['src/a.ts'] });
    expect(WorkspaceFileLinksResponse.safeParse({ found: ['/abs/src/a.ts'] }).success).toBe(false);
    expect(WorkspaceFileLinksResponse.safeParse({ found: ['src/a.ts'], realPath: '/x' }).success).toBe(false);
  });

  it('words sizes and the binary and too-large states as EXPERIENCE.md does, with no em or en dash', () => {
    expect([0, 1, 512, 1024, 3584, 1_048_575, 1_048_576, 2 * 1_048_576, 2.4 * 1_048_576, 1.1 * 1024 ** 3].map(fileSizeWords)).toEqual([
      '0 bytes',
      '1 byte',
      '512 bytes',
      '1 KB',
      '3.5 KB',
      '1 MB',
      '1 MB',
      '2 MB',
      '2.4 MB',
      '1.1 GB',
    ]);
    expect(WORKSPACE_FILE_BINARY_TEXT).toBe("Binary file. Ogden doesn't show its contents.");
    expect(workspaceFileTooLargeText(2 * 1_048_576)).toBe('This file is too large to show here (2 MB, limit 1 MB).');
    expect(workspaceFileTooLargeText(2.4 * 1_048_576, MAX_WORKSPACE_FILE_BYTES)).toBe('This file is too large to show here (2.4 MB, limit 1 MB).');
    expect(workspaceFileLinkTitle('src/a.ts', 12)).toBe('Open src/a.ts at line 12');
    expect(workspaceFileLinkTitle('src/a.ts')).toBe('Open src/a.ts');
    for (const text of [WORKSPACE_FILE_BINARY_TEXT, workspaceFileTooLargeText(5), WORKSPACE_FILE_COPY_PATH_LABEL, WORKSPACE_FILE_SHOW_SOURCE_LABEL]) expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});
