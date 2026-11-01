/**
 * Links to the Workbench viewer (8.7, E8-R1, E8-R2): from the paths and
 * `file:line` targets an agent names in a reply, and from a markdown file's
 * relative links. A candidate becomes a link only once the server's links
 * route confirmed it is a file the viewer would open (inside the project, or
 * the chat's worktree, and not refused); until then, and for anything
 * unconfirmed, it stays text. A link is always the in-app viewer route
 * (`/w/:wsId/workbench?path=&line=&session=`): never an absolute path, a
 * `file:` address or anything the browser leaves the app for.
 */
import { API_ROUTES, apiPath, EDITOR_OPEN_FAILED_LABEL, MAX_WORKSPACE_FILE_LINKS, WorkspaceFileLinksResponse, WorkspaceRelativePath, workspaceFileLinkTitle } from '@ogden-agents/shared';
import { useQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { call, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { pathTokens, UNSAFE_CHARACTERS, type FileTarget, type MarkdownLinks } from '@/ui/markdown';
import { EditorStatus, openInEditorClick, useEditors, useOpenInEditor } from './open-in-editor';
import { parentOf } from './workbench-api';

/** The highest line a link may name. */
const MAX_LINE = 10_000_000;

/** A positive line number from its digits, or `undefined`. */
function lineOf(digits: string | undefined): number | undefined {
  if (digits === undefined) return undefined;
  const line = Number(digits);
  return Number.isSafeInteger(line) && line >= 1 && line <= MAX_LINE ? line : undefined;
}

/** A path token's shape: the characters a candidate is made of. */
const PATH_CHARS = /^[A-Za-z0-9_@+.\-/]+$/;
/** A last segment with a file extension (`.ts`, `.md`, `.env`). */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]*$/;

/**
 * A chat candidate (`src/a.ts`, `./src/a.ts:12`, `src/a.ts:12:3`,
 * `src/a.ts#L12`) as a viewer target, or `null`: it must be made of path
 * characters, hold a `/` or end in an extension, and parse as a
 * `WorkspaceRelativePath` once a leading `./` is dropped. Never a URL, an
 * absolute, `~` or `..` path.
 */
export function parseFileTarget(token: string): FileTarget | null {
  const match = /^(.+?)(?::(\d+)(?::\d+)?|#L(\d+))?$/.exec(token);
  if (match === null) return null;
  let path = match[1]!;
  if (path.startsWith('./')) path = path.slice(2);
  if (!PATH_CHARS.test(path) || (!path.includes('/') && !EXTENSION.test(path))) return null;
  if (!WorkspaceRelativePath.safeParse(path).success) return null;
  const digits = match[2] ?? match[3];
  const line = lineOf(digits);
  if (digits !== undefined && line === undefined) return null;
  return line === undefined ? { path } : { path, line };
}

/** The distinct paths of the chat candidates in `text`, at most {@link MAX_WORKSPACE_FILE_LINKS}, in the order they appear. */
export function pathCandidates(text: string): string[] {
  const paths = new Set<string>();
  for (const line of outsideFences(text)) {
    for (const { token } of pathTokens(line)) {
      const target = parseFileTarget(token);
      if (target !== null) paths.add(target.path);
      if (paths.size >= MAX_WORKSPACE_FILE_LINKS) return [...paths];
    }
  }
  return [...paths];
}

/** A fence line as the renderer reads it: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The lines of `text` outside fenced code blocks (never linked), so code can't use up the candidate cap. */
function outsideFences(text: string): string[] {
  const kept: string[] = [];
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const marker = FENCE.exec(line)?.[1];
    if (fence === undefined) {
      if (marker === undefined) kept.push(line);
      else fence = marker;
    } else if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) {
      fence = undefined;
    }
  }
  return kept;
}

/** A scheme (`https:`, `javascript:`, `file:`, `c:`): a relative link never has one. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * A markdown file's link destination resolved against the file's folder, or
 * `null` (the link stays text): an anchor (`#…`), anything with a scheme,
 * `//host`, an absolute or `~` path, a backslash, or a path that leaves the
 * project once `.` and `..` are applied. A `?query` is dropped, `#L12` is
 * the line, and the path is percent-decoded once.
 */
export function resolveRelative(fromFile: string, href: string): FileTarget | null {
  let target = href.trim();
  if (target.startsWith('<')) {
    const end = target.indexOf('>');
    if (end === -1) return null;
    target = target.slice(1, end);
  } else {
    target = target.split(/[ \t]/, 1)[0] ?? '';
  }
  if (target === '' || target.startsWith('#') || target.startsWith('/') || target.startsWith('~') || target.includes('\\') || SCHEME.test(target)) return null;
  const hash = target.indexOf('#');
  const fragment = hash === -1 ? '' : target.slice(hash + 1);
  let pathPart = hash === -1 ? target : target.slice(0, hash);
  const query = pathPart.indexOf('?');
  if (query !== -1) pathPart = pathPart.slice(0, query);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return null;
  }
  // Controls, invisible and direction-changing characters as `safeHref` refuses them; a plain space is a file name's own.
  if (decoded === '' || decoded.startsWith('/') || decoded.startsWith('~') || /[\\:\0]/.test(decoded) || UNSAFE_CHARACTERS.test(decoded.replaceAll(' ', '_'))) return null;
  const segments = parentOf(fromFile) === '' ? [] : parentOf(fromFile).split('/');
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      // Above the project's root: never a link.
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const path = segments.join('/');
  if (!WorkspaceRelativePath.safeParse(path).success) return null;
  const lineMatch = /^L(\d+)(?:-L?\d+)?$/.exec(fragment);
  const line = lineOf(lineMatch?.[1]);
  return line === undefined ? { path } : { path, line };
}

/** A markdown link's destination as written: `[text](destination)`, its brackets and parentheses as the renderer reads them. */
const LINK_DESTINATION = /!?\[[^[\]\n]*\]\(((?:[^()\n]|\([^()\n]*\))*)\)/g;

/** The distinct files a markdown file's relative links lead to, at most {@link MAX_WORKSPACE_FILE_LINKS}. */
export function markdownLinkCandidates(fromFile: string, source: string): string[] {
  const paths = new Set<string>();
  for (const match of source.matchAll(LINK_DESTINATION)) {
    const target = resolveRelative(fromFile, match[1] ?? '');
    if (target !== null) paths.add(target.path);
    if (paths.size >= MAX_WORKSPACE_FILE_LINKS) break;
  }
  return [...paths];
}

/** `POST /api/v1/workspaces/:wsId/files/links`: which of `paths` are files the viewer would open. */
export async function fetchFileLinks(wsId: string, paths: readonly string[], session: string | undefined, auth: Auth = tabAuth): Promise<string[]> {
  const body = session === undefined ? { paths } : { paths, session };
  const json = await call(auth, apiPath(API_ROUTES.workspaceFileLinks, { wsId }), postJson(body), "Ogden couldn't check those paths");
  return WorkspaceFileLinksResponse.parse(json).found;
}

/**
 * Paths asked about within one tick, gathered into requests of at most
 * {@link MAX_WORKSPACE_FILE_LINKS} per project and chat: every message on
 * screen asks in the same few requests.
 */
const batches = new Map<string, { wsId: string; session: string | undefined; waiting: Map<string, ((found: boolean) => void)[]>; fail: ((error: unknown) => void)[] }>();

function askBatched(wsId: string, session: string | undefined, path: string): Promise<boolean> {
  const key = `${wsId}\u0000${session ?? ''}`;
  return new Promise((resolve, reject) => {
    let batch = batches.get(key);
    if (batch === undefined) {
      const created = { wsId, session, waiting: new Map<string, ((found: boolean) => void)[]>(), fail: [] as ((error: unknown) => void)[] };
      batches.set(key, created);
      batch = created;
      setTimeout(() => {
        batches.delete(key);
        void flush(created);
      }, 0);
    }
    batch.waiting.set(path, [...(batch.waiting.get(path) ?? []), resolve]);
    batch.fail.push(reject);
  });
}

async function flush(batch: { wsId: string; session: string | undefined; waiting: Map<string, ((found: boolean) => void)[]>; fail: ((error: unknown) => void)[] }) {
  const paths = [...batch.waiting.keys()];
  try {
    for (let start = 0; start < paths.length; start += MAX_WORKSPACE_FILE_LINKS) {
      const chunk = paths.slice(start, start + MAX_WORKSPACE_FILE_LINKS);
      const found = new Set(await fetchFileLinks(batch.wsId, chunk, batch.session));
      for (const path of chunk) for (const resolve of batch.waiting.get(path) ?? []) resolve(found.has(path));
    }
  } catch (error) {
    // A promise already resolved ignores this.
    for (const reject of batch.fail) reject(error);
  }
}

/** How long a path's answer is kept before it is asked again. */
const CONFIRMED_STALE_MS = 30_000;

/**
 * The paths of `candidates` the server confirmed, as one set whose identity
 * changes only when its members do. Each path is its own cached query
 * (asked once however many messages name it), batched into few requests.
 * While `enabled` is false (a reply still streaming) nothing is asked. An
 * unknown, loading or failed answer is not confirmed.
 */
export function useConfirmedPaths(wsId: string, candidates: readonly string[], session: string | undefined, enabled = true): ReadonlySet<string> {
  const results = useQueries({
    queries: candidates.map((path) => ({
      queryKey: ['workspace-file-link', wsId, session ?? '', path] as const,
      queryFn: () => askBatched(wsId, session, path),
      enabled,
      retry: false,
      staleTime: CONFIRMED_STALE_MS,
    })),
  });
  const confirmed = candidates.filter((_, index) => results[index]?.data === true);
  // A key no path can collide with; the set is built from the paths themselves, never split back out of it.
  const key = JSON.stringify(confirmed);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `confirmed` changes exactly when `key` does.
  return useMemo(() => new Set(confirmed), [key]);
}

/** The viewer's address for a target, as the router builds it. */
export function viewerSearch(target: FileTarget, session: string | undefined): { path: string; line?: number; session?: string } {
  return { path: target.path, ...(target.line === undefined ? {} : { line: target.line }), ...(session === undefined ? {} : { session }) };
}

/**
 * A link to the viewer: mono, in-app, titled "Open <path> at line <n>"; its
 * name is the text as written. `Cmd`/`Ctrl`+click opens the file at its line
 * in the user's editor instead (8.10), or, with none found, says so; what
 * happened is said in a `role=status` beside it.
 */
export function PathLink({ wsId, session, target, children }: { wsId: string; session: string | undefined; target: FileTarget; children: ReactNode }) {
  const editors = useEditors();
  const { open, refuse, feedback } = useOpenInEditor(wsId, session);
  return (
    <>
    <Link
      to="/w/$wsId/workbench"
      params={{ wsId }}
      search={viewerSearch(target, session)}
      title={workspaceFileLinkTitle(target.path, target.line)}
      data-slot="markdown-path-link"
      data-path={target.path}
      className="font-mono text-mono-compact break-all text-foreground underline underline-offset-2"
      onClick={(event) => openInEditorClick(event, editors, target, open, refuse)}
    >
      {children}
    </Link>
    {feedback === undefined ? null : (
      <span className="ml-1 font-sans text-caption text-muted-foreground" aria-hidden data-testid="path-link-editor-feedback">
        {feedback.kind === 'opened' ? feedback.text : EDITOR_OPEN_FAILED_LABEL}
      </span>
    )}
    <EditorStatus feedback={feedback} testId="path-link-editor-status" />
    </>
  );
}

/** {@link MarkdownLinks} over a confirmed set (exported for tests): `resolveTarget` reads a link's destination, `pathAt` (chat) a bare token. */
export function viewerLinks(wsId: string, session: string | undefined, confirmed: ReadonlySet<string>, resolveTarget: (destination: string) => FileTarget | null, bare: boolean): MarkdownLinks {
  const confirm = (target: FileTarget | null) => (target !== null && confirmed.has(target.path) ? target : null);
  const links: MarkdownLinks = {
    resolve: (destination) => confirm(resolveTarget(destination)),
    render: (target, children, key) => (
      <PathLink key={key} wsId={wsId} session={session} target={target}>
        {children}
      </PathLink>
    ),
  };
  if (bare) links.pathAt = (text) => confirm(parseFileTarget(text));
  return links;
}

/**
 * Viewer links for an agent's reply in chat `sesId` (its worktree's files
 * when it has one): bare paths, code spans and link destinations that the
 * server confirmed. `undefined` until any is confirmed, so the reply renders
 * exactly as before.
 */
export function useChatPathLinks(wsId: string, sesId: string, source: string, streaming: boolean): MarkdownLinks | undefined {
  const candidates = useMemo(() => (streaming ? [] : pathCandidates(source)), [source, streaming]);
  const confirmed = useConfirmedPaths(wsId, candidates, sesId, !streaming);
  return useMemo(() => (confirmed.size === 0 ? undefined : viewerLinks(wsId, sesId, confirmed, (destination) => parseFileTarget(destination.trim().replace(/^<(.*)>$/, '$1')), true)), [wsId, sesId, confirmed]);
}

/** Viewer links for a markdown file at `path`: its relative links that lead to confirmed files. */
export function useMarkdownFileLinks(wsId: string, path: string, source: string, session: string | undefined): MarkdownLinks | undefined {
  const candidates = useMemo(() => markdownLinkCandidates(path, source), [path, source]);
  const confirmed = useConfirmedPaths(wsId, candidates, session);
  return useMemo(() => (confirmed.size === 0 ? undefined : viewerLinks(wsId, session, confirmed, (destination) => resolveRelative(path, destination), false)), [wsId, session, path, confirmed]);
}
