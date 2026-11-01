import {
  WORKSPACE_SEARCH_CAPPED_TEXT,
  WORKSPACE_SEARCH_EMPTY_TEXT,
  WORKSPACE_SEARCH_FIELD_LABEL,
  WORKSPACE_SEARCH_MATCH_CASE_LABEL,
  WORKSPACE_SEARCH_MAX_QUERY,
  WORKSPACE_SEARCH_MODE_LABEL,
  WORKSPACE_SEARCH_NAMES_LABEL,
  WORKSPACE_SEARCH_REGEX_LABEL,
  WORKSPACE_SEARCH_STOPPED_TEXT,
  WORKSPACE_SEARCH_TEXT_LABEL,
  WORKSPACE_SEARCH_UNAVAILABLE_TEXT,
  workspaceFileLinkTitle,
  workspaceSearchNoMatchText,
  type WorkspaceSearchFile,
  type WorkspaceSearchMode,
  type WorkspaceSearchResponse,
} from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChatApiError } from '@/api/http';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Skeleton } from '@/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group';
import { Text } from '@/ui/typography';
import { useWorkspaceSearch } from './workbench-api';

/** How long typing pauses before the search runs. */
export const SEARCH_DEBOUNCE_MS = 250;

/** What the panel's address holds: the query and its options. */
export interface WorkbenchSearchState {
  q: string;
  mode: WorkspaceSearchMode;
  matchCase: boolean;
  regex: boolean;
}

export interface WorkbenchSearchProps extends WorkbenchSearchState {
  wsId: string;
  /** A worktree chat's id: its worktree is searched (8.2's root). */
  session?: string | undefined;
  /** A new query or option, for the page's address (typing replaces the history entry). */
  onChange: (next: WorkbenchSearchState) => void;
}

/**
 * The Workbench's Search panel (8.8, CAP-34): one field with **Text** and
 * **File names**, **Match case** and **Regex**. The search runs after a
 * short pause in typing, its results grouped by file, each matching line a
 * link to the viewer at that line (click or `Enter`). The query and options
 * are the page's address, so a reload or a link shows the same search.
 */
export function WorkbenchSearch({ wsId, session, q, mode, matchCase, regex, onChange }: WorkbenchSearchProps) {
  const [text, setText] = useState(q);
  // The query in the address as last seen: when it changes from outside (back, a link), the field takes it.
  const [shown, setShown] = useState(q);
  // What this field last sent to the address: its own change never overwrites newer typing.
  const sent = useRef(q);
  if (q !== shown) {
    setShown(q);
    if (q !== sent.current) {
      sent.current = q;
      setText(q);
    }
  }
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => field.current?.focus(), []);
  const latest = useRef({ mode, matchCase, regex, onChange });
  latest.current = { mode, matchCase, regex, onChange };
  useEffect(() => {
    if (text === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = text;
      const { mode: m, matchCase: c, regex: r, onChange: change } = latest.current;
      change({ q: text, mode: m, matchCase: c, regex: r });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  /** An option changed: sent at once, with the field's text as it is now. */
  const choose = (next: Omit<WorkbenchSearchState, 'q'>) => {
    sent.current = text;
    onChange({ q: text, ...next });
  };
  const options = [...(matchCase ? ['matchCase'] : []), ...(regex ? ['regex'] : [])];
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="workbench-search">
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor="workbench-search-field">{WORKSPACE_SEARCH_FIELD_LABEL}</Label>
        <Input
          ref={field}
          id="workbench-search-field"
          type="search"
          value={text}
          maxLength={WORKSPACE_SEARCH_MAX_QUERY}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          data-testid="search-field"
        />
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(next) => (next === 'text' || next === 'names' ? choose({ mode: next, matchCase, regex }) : undefined)}
            aria-label={WORKSPACE_SEARCH_MODE_LABEL}
            data-testid="search-mode"
          >
            <ToggleGroupItem value="text" data-testid="search-mode-text">
              {WORKSPACE_SEARCH_TEXT_LABEL}
            </ToggleGroupItem>
            <ToggleGroupItem value="names" data-testid="search-mode-names">
              {WORKSPACE_SEARCH_NAMES_LABEL}
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="multiple"
            value={options}
            onValueChange={(next) => choose({ mode, matchCase: next.includes('matchCase'), regex: next.includes('regex') })}
            aria-label="Search options"
            data-testid="search-options"
          >
            <ToggleGroupItem value="matchCase" data-testid="search-match-case">
              {WORKSPACE_SEARCH_MATCH_CASE_LABEL}
            </ToggleGroupItem>
            <ToggleGroupItem value="regex" data-testid="search-regex">
              {WORKSPACE_SEARCH_REGEX_LABEL}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      <SearchResults wsId={wsId} session={session} q={q} mode={mode} matchCase={matchCase} regex={regex} />
    </div>
  );
}

/** A one-sentence state of the panel, announced. */
function SearchState({ testId, children }: { testId: string; children: string }) {
  return (
    <Text variant="body" tone="muted" role="status" data-testid={testId}>
      {children}
    </Text>
  );
}

function SearchResults({ wsId, session, q, mode, matchCase, regex }: WorkbenchSearchState & { wsId: string; session: string | undefined }) {
  const search = useWorkspaceSearch(wsId, { q, mode, matchCase, regex, session });
  if (q === '') return <SearchState testId="search-empty">{WORKSPACE_SEARCH_EMPTY_TEXT}</SearchState>;
  if (search.isError) {
    // A server that can't search yet (501): the panel says so in its own words.
    const unavailable = search.error instanceof ChatApiError && search.error.status === 501;
    return <SearchState testId={unavailable ? 'search-unavailable' : 'search-error'}>{unavailable ? WORKSPACE_SEARCH_UNAVAILABLE_TEXT : search.error.message}</SearchState>;
  }
  if (!search.isSuccess) {
    return (
      <div className="flex flex-col gap-1" data-testid="search-loading">
        <span role="status" className="sr-only">
          Searching
        </span>
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }
  const answer = search.data;
  if (answer.files.length === 0) return <SearchState testId={answer.truncated ? 'search-stopped' : 'search-no-match'}>{answer.truncated ? WORKSPACE_SEARCH_STOPPED_TEXT : workspaceSearchNoMatchText(q)}</SearchState>;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="search-results">
      {answer.truncated ? <SearchState testId={matchCount(answer) >= answer.limit ? 'search-capped' : 'search-stopped'}>{matchCount(answer) >= answer.limit ? WORKSPACE_SEARCH_CAPPED_TEXT : WORKSPACE_SEARCH_STOPPED_TEXT}</SearchState> : null}
      {mode === 'names' ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Matching files" data-testid="search-names">
          {answer.files.map((file) => (
            <li key={file.path}>
              <ResultLink wsId={wsId} session={session} path={file.path} testId="search-name">
                <span className="min-w-0 break-all">{file.path}</span>
              </ResultLink>
            </li>
          ))}
        </ul>
      ) : (
        answer.files.map((file) => <FileResults key={file.path} wsId={wsId} session={session} file={file} />)
      )}
    </div>
  );
}

/** The matches an answer holds (a File names hit counts as one). */
const matchCount = (answer: WorkspaceSearchResponse): number => answer.files.reduce((sum, file) => sum + Math.max(1, file.matches.length), 0);

/** One file's matching lines, under its path. */
function FileResults({ wsId, session, file }: { wsId: string; session: string | undefined; file: WorkspaceSearchFile }) {
  return (
    <section aria-label={file.path} className="flex min-w-0 flex-col rounded-md border border-border bg-card" data-testid="search-file" data-path={file.path}>
      <Text as="h2" variant="mono-compact" className="m-0 border-b border-border px-3 py-1 break-all text-foreground" data-testid="search-file-path">
        {file.path}
      </Text>
      <ul className="m-0 flex list-none flex-col p-1">
        {file.matches.map((match) => (
          <li key={match.line}>
            <ResultLink wsId={wsId} session={session} path={file.path} line={match.line} testId="search-match">
              <span aria-hidden className="shrink-0 text-right text-muted-foreground tabular-nums">
                {match.line}
              </span>
              <span className="min-w-0 whitespace-pre-wrap wrap-anywhere text-foreground">{match.preview}</span>
            </ResultLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A result: a link to the viewer (Files, at the line), titled "Open <path> at line <n>". */
function ResultLink({ wsId, session, path, line, testId, children }: { wsId: string; session: string | undefined; path: string; line?: number; testId: string; children: ReactNode }) {
  return (
    <Link
      to="/w/$wsId/workbench"
      params={{ wsId }}
      search={{ path, ...(line === undefined ? {} : { line }), ...(session === undefined ? {} : { session }) }}
      title={workspaceFileLinkTitle(path, line)}
      className="flex min-h-(--row-height) min-w-0 items-start gap-3 rounded-md px-2 py-1 font-mono text-mono-compact text-foreground transition-colors duration-(--motion-fast) ease-standard hover:bg-accent"
      data-testid={testId}
      data-line={line}
    >
      {children}
    </Link>
  );
}
