/**
 * `workspace-files-memory` (epic 8 entry 2): an in-memory
 * `WorkspaceFilesPort` for tests and the Workbench lanes (the server wires
 * `workspace-files-node`). Each root is a record of `path → text`; a folder
 * is any prefix of a file's path. It refuses what core refuses by name
 * (`isRefusedWorkspacePath`) and anything a test marks `protected`, and
 * records every call with its root kind. Its `search` matches as 8.8 will
 * (text: each matching line; names: the path), uncapped, so the use-case's
 * clamp is what a test sees; `locate` answers `<root>/<path>`.
 */
import { isRefusedWorkspacePath, type WorkspaceFilesPort, type WorkspacePathRefusal, type WorkspaceRootKind, type WorkspaceSearchPortQuery } from '@ogden-agents/core';
import type { WorkspaceFileEntry, WorkspaceSearchFile } from '@ogden-agents/shared';

export interface MemoryWorkspaceFilesCall {
  op: 'list' | 'read' | 'search' | 'locate';
  root: string;
  kind: WorkspaceRootKind;
  /** The path, or the query for a search. */
  path: string;
}

export interface MemoryWorkspaceFiles extends WorkspaceFilesPort {
  readonly calls: MemoryWorkspaceFilesCall[];
  /** Sets the files under `root` (`path → text`), replacing any. */
  setFiles(root: string, files: Record<string, string>): void;
  /** Paths (relative to any root) refused as protected. */
  readonly protectedPaths: Set<string>;
}

const PROTECTED: WorkspacePathRefusal = { refused: 'protected' };
const NOT_FOUND: WorkspacePathRefusal = { refused: 'not_found' };

export interface MemoryWorkspaceFilesOptions {
  /** Without search (as `workspace-files-node` today): the search route answers 501. */
  search?: boolean;
}

export function createMemoryWorkspaceFiles({ search = true }: MemoryWorkspaceFilesOptions = {}): MemoryWorkspaceFiles {
  const roots = new Map<string, Map<string, string>>();
  const calls: MemoryWorkspaceFilesCall[] = [];
  const protectedPaths = new Set<string>();
  const filesOf = (root: string): Map<string, string> | undefined => roots.get(root);
  const refused = (path: string): boolean => path !== '' && (isRefusedWorkspacePath(path.split('/')) || protectedPaths.has(path));

  const port: MemoryWorkspaceFiles = {
    calls,
    protectedPaths,
    setFiles(root, files) {
      roots.set(root, new Map(Object.entries(files)));
    },
    async list(root, path, kind = 'project') {
      calls.push({ op: 'list', root, kind, path });
      if (refused(path)) return PROTECTED;
      const files = filesOf(root);
      if (files === undefined || files.has(path)) return NOT_FOUND;
      const prefix = path === '' ? '' : `${path}/`;
      const below = [...files.keys()].filter((file) => file.startsWith(prefix));
      if (path !== '' && below.length === 0) return NOT_FOUND;
      const entries = new Map<string, WorkspaceFileEntry>();
      for (const file of below) {
        const [name, ...rest] = file.slice(prefix.length).split('/');
        const entryPath = `${prefix}${name!}`;
        entries.set(name!, { name: name!, path: entryPath, kind: rest.length > 0 ? 'folder' : 'file', protected: refused(entryPath) });
      }
      const sorted = [...entries.values()].sort((a, b) => (a.kind === b.kind ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.kind === 'folder' ? -1 : 1));
      return { path, entries: sorted, truncated: false };
    },
    async read(root, path, kind = 'project') {
      calls.push({ op: 'read', root, kind, path });
      if (refused(path)) return PROTECTED;
      const content = filesOf(root)?.get(path);
      if (content === undefined) return NOT_FOUND;
      return { kind: 'text', path, content, size: Buffer.byteLength(content), masked: false };
    },
    async locate(root, path, kind = 'project') {
      calls.push({ op: 'locate', root, kind, path });
      if (refused(path)) return PROTECTED;
      if (filesOf(root)?.get(path) === undefined) return NOT_FOUND;
      return { realPath: `${root}/${path}` };
    },
  };
  if (search) {
    port.search = async (root: string, query: WorkspaceSearchPortQuery, kind: WorkspaceRootKind = 'project') => {
      calls.push({ op: 'search', root, kind, path: query.q });
      const fold = (text: string): string => (query.matchCase ? text : text.toLowerCase());
      const needle = fold(query.q);
      const found: WorkspaceSearchFile[] = [];
      for (const [path, content] of [...(filesOf(root) ?? new Map<string, string>())].sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (refused(path)) continue;
        if (query.mode === 'names') {
          if (fold(path).includes(needle)) found.push({ path, matches: [] });
          continue;
        }
        const matches = content.split('\n').flatMap((line, index) => {
          const at = fold(line).indexOf(needle);
          return at === -1 ? [] : [{ line: index + 1, column: at + 1, preview: line }];
        });
        if (matches.length > 0) found.push({ path, matches });
      }
      return { files: found, truncated: false };
    };
  }
  return port;
}
