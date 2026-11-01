import {
  MAX_PROJECT_COMMAND_CHARS,
  PROBLEMS_ADD_COMMAND_LABEL,
  PROBLEMS_ASK_AGENT_LABEL,
  PROBLEMS_ASK_NEW_CHAT_LABEL,
  PROBLEMS_CANCEL_LABEL,
  PROBLEMS_COMMAND_NAME_LABEL,
  PROBLEMS_COMMAND_TEXT_HINT,
  PROBLEMS_COMMAND_TEXT_LABEL,
  PROBLEMS_HIDE_OUTPUT_LABEL,
  PROBLEMS_NO_COMMANDS_TEXT,
  PROBLEMS_NONE_FOUND_TEXT,
  PROBLEMS_NOT_NOW_LABEL,
  PROBLEMS_OUTPUT_LABEL,
  PROBLEMS_RUN_LABEL,
  PROBLEMS_SAVE_COMMAND_LABEL,
  PROBLEMS_SHOW_OUTPUT_LABEL,
  PROBLEMS_STOP_LABEL,
  PROBLEMS_UNPARSED_TEXT,
  PROBLEMS_UNTRUSTED_TEXT,
  PROBLEMS_USE_NEW_TEXT_LABEL,
  PROBLEMS_USE_OFFER_LABEL,
  PROJECT_TRUST_ALLOW,
  problemsFinishedText,
  problemsOfferText,
  problemsResultText,
  problemsScriptChangedText,
  problemsScriptGoneText,
  SCRIPT_TRUST_FAILED,
  type ProblemItem,
  type ProjectCommand,
  type ProjectCommandInput,
  type ProjectCommandRun,
  type ProjectCommandsResponse,
} from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isApiError } from '@/api/http';
import { keepSaved } from '@/api/keep-saved';
import { chatDraftKey, newChatDraftKey } from '@/chat/drafts';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Notice } from '@/ui/notice';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { useSessions } from '@/workspaces/workspace-api';
import { trustProjectScripts } from '@/workspaces/workspace-settings-api';
import { OpenInEditorButton } from './open-in-editor';
import { PathLink } from './path-links';
import {
  confirmedInput,
  keptInput,
  projectCommandsKey,
  runProjectCommand,
  saveProjectCommands,
  stopProjectCommand,
  useProjectCommandRun,
  useProjectCommands,
  writeProblemDraft,
} from './problems-api';

/** The longest command name (`ProjectCommand.label`). */
const MAX_PROJECT_COMMAND_LABEL_CHARS = 60;

/** Not now on the offer, kept in this browser per project (never on the server). */
const NOT_NOW_PREFIX = 'ogden-agents.problems-offer-dismissed.v1:';

function readNotNow(wsId: string): boolean {
  try {
    return window.localStorage.getItem(NOT_NOW_PREFIX + wsId) === '1';
  } catch {
    return false;
  }
}

function writeNotNow(wsId: string): void {
  try {
    window.localStorage.setItem(NOT_NOW_PREFIX + wsId, '1');
  } catch {
    // Blocked storage: the offer comes back next time.
  }
}

/** A command id from its name: lower-case letters, digits and dashes, unique among `taken`. */
export function commandIdFor(name: string, taken: ReadonlySet<string>): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const base = /^[a-z]/.test(slug) ? slug : `cmd-${slug}`.replace(/-+$/, '');
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** The items of one run grouped by file, in the order first seen. */
export function groupByFile(items: readonly ProblemItem[]): Array<{ path: string; items: ProblemItem[] }> {
  const groups = new Map<string, ProblemItem[]>();
  for (const item of items) groups.set(item.path, [...(groups.get(item.path) ?? []), item]);
  return [...groups].map(([path, grouped]) => ({ path, items: grouped }));
}

export interface WorkbenchProblemsProps {
  wsId: string;
}

/**
 * The Workbench's Problems panel (AD-38; 8.9, EXPERIENCE.md Problems): in a
 * trusted project, its declared test and lint commands, each with Run or
 * Stop, its last result and Show output; a run's failures grouped by file,
 * each a link to the viewer at its line and Ask the agent to fix this,
 * which fills a chat's composer draft and opens it, never sending. The
 * `package.json` offer (Use these, Not now), a script changed since it was
 * confirmed, and Add a command. A polite live region says once when a run
 * finishes. Before the project is trusted, only the trust prompt.
 */
export function WorkbenchProblems({ wsId }: WorkbenchProblemsProps) {
  const commands = useProjectCommands(wsId);
  if (commands.isError) {
    if (isApiError(commands.error, 'scripts_not_trusted')) return <ProblemsTrust wsId={wsId} onTrusted={() => void commands.refetch()} />;
    return (
      <Notice variant="blocked" data-testid="problems-error">
        {commands.error.message}
      </Notice>
    );
  }
  if (!commands.isSuccess) {
    return (
      <div className="flex flex-col gap-2" data-testid="problems-loading">
        <Skeleton />
        <Skeleton />
      </div>
    );
  }
  return <ProblemsBody wsId={wsId} data={commands.data} />;
}

/** The trust prompt: Problems runs the project's own commands. */
function ProblemsTrust({ wsId, onTrusted }: { wsId: string; onTrusted: () => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const allow = () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    trustProjectScripts(wsId).then(
      async (settings) => {
        await keepSaved(queryClient, ['workspace-settings', wsId], settings);
        setBusy(false);
        onTrusted();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(failure instanceof Error && failure.message !== '' ? failure.message : SCRIPT_TRUST_FAILED);
      },
    );
  };
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="problems-trust">
      <Notice
        action={
          <Button data-testid="problems-trust-allow" aria-disabled={busy || undefined} onClick={allow}>
            {PROJECT_TRUST_ALLOW}
          </Button>
        }
      >
        <span>{PROBLEMS_UNTRUSTED_TEXT}</span>
      </Notice>
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="problems-trust-error">
          {error}
        </Text>
      )}
    </div>
  );
}

function ProblemsBody({ wsId, data }: { wsId: string; data: ProjectCommandsResponse }) {
  const queryClient = useQueryClient();
  const [notNow, setNotNow] = useState(() => readNotNow(wsId));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState('');
  /** Runs already announced: each finish is said once. */
  const announced = useRef(new Set<string>());
  const announce = (label: string, run: ProjectCommandRun) => {
    if (announced.current.has(run.id)) return;
    announced.current.add(run.id);
    setAnnouncement(problemsFinishedText(label, run));
  };

  const save = async (next: ProjectCommandInput[]): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    setSaveError(undefined);
    try {
      queryClient.setQueryData(projectCommandsKey(wsId), await saveProjectCommands(wsId, next));
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      await queryClient.invalidateQueries({ queryKey: projectCommandsKey(wsId) });
      return false;
    } finally {
      setSaving(false);
    }
  };
  const kept = data.declared.map(keptInput);
  const changed = data.declared.filter((command) => command.source === 'package_json' && !command.confirmed);
  const offered = notNow ? [] : data.offered;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="workbench-problems">
      <div role="status" aria-live="polite" className="sr-only" data-testid="problems-announcement">
        {announcement}
      </div>
      {offered.length === 0 ? null : (
        <Notice
          data-testid="problems-offer"
          action={
            <span className="flex flex-wrap gap-2">
              <Button data-testid="problems-use-offer" aria-disabled={saving || undefined} onClick={() => void save([...kept, ...offered.map(confirmedInput)])}>
                {PROBLEMS_USE_OFFER_LABEL}
              </Button>
              <Button
                variant="outline"
                data-testid="problems-not-now"
                onClick={() => {
                  writeNotNow(wsId);
                  setNotNow(true);
                }}
              >
                {PROBLEMS_NOT_NOW_LABEL}
              </Button>
            </span>
          }
        >
          <span className="flex min-w-0 flex-col gap-1">
            <span>{problemsOfferText(offered.map((command) => command.script ?? command.id))}</span>
            {offered.map((command) => (
              <span key={command.id} className="min-w-0 text-caption text-muted-foreground" data-testid="problems-offer-script">
                <span className="text-foreground">{command.script}</span>: <code className="font-mono break-all">{command.scriptText}</code>
              </span>
            ))}
          </span>
        </Notice>
      )}
      {changed.map((command) => (
        <Notice
          key={command.id}
          variant="blocked"
          glyphLabel="Changed"
          data-testid="problems-changed"
          data-command-id={command.id}
          action={
            command.scriptText === undefined ? undefined : (
              <Button
                data-testid="problems-use-new-text"
                aria-disabled={saving || undefined}
                onClick={() => void save(data.declared.map((one) => (one.id === command.id ? confirmedInput(one) : keptInput(one))))}
              >
                {PROBLEMS_USE_NEW_TEXT_LABEL}
              </Button>
            )
          }
        >
          <span className="flex min-w-0 flex-col gap-1">
            <span>{command.scriptText === undefined ? problemsScriptGoneText(command.script ?? command.id) : problemsScriptChangedText(command.script ?? command.id)}</span>
            {command.scriptText === undefined ? null : <code className="font-mono text-caption break-all text-muted-foreground">{command.scriptText}</code>}
          </span>
        </Notice>
      ))}
      {saveError === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="problems-save-error">
          {saveError}
        </Text>
      )}
      {data.declared.length === 0 ? (
        <Text variant="caption" data-testid="problems-empty">
          {PROBLEMS_NO_COMMANDS_TEXT}
        </Text>
      ) : (
        <ul className="m-0 flex min-w-0 list-none flex-col gap-4 p-0" data-testid="problems-commands">
          {data.declared.map((command) => (
            <CommandRow key={command.id} wsId={wsId} command={command} onFinished={announce} />
          ))}
        </ul>
      )}
      <AddCommand
        saving={saving}
        onAdd={(name, text) => {
          const id = commandIdFor(name, new Set(data.declared.map((command) => command.id)));
          return save([...kept, { id, label: name, command: text, source: 'settings', confirmedText: text }]);
        }}
      />
    </div>
  );
}

/** One declared command: Run or Stop, its last result, Show output, and its failures. */
function CommandRow({ wsId, command, onFinished }: { wsId: string; command: ProjectCommand; onFinished: (label: string, run: ProjectCommandRun) => void }) {
  const queryClient = useQueryClient();
  const [showOutput, setShowOutput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const run = command.lastRun;
  const running = run?.state === 'running';
  const detail = useProjectCommandRun(wsId, run?.id, run !== null);
  // The run's own answer is fresher than the list's while it runs.
  const shownRun = detail.data?.run.id === run?.id ? (detail.data?.run ?? run) : run;
  const refresh = () => queryClient.invalidateQueries({ queryKey: projectCommandsKey(wsId) });
  // Once the run ends, the list reads it too.
  const finishedRun = shownRun !== null && shownRun.state !== 'running' && running ? shownRun.id : undefined;
  useEffect(() => {
    if (finishedRun !== undefined) void queryClient.invalidateQueries({ queryKey: projectCommandsKey(wsId) });
  }, [finishedRun, queryClient, wsId]);
  /** Runs this tab started or saw running: their finish is announced (once, by the panel). */
  const watched = useRef(new Set<string>());
  useEffect(() => {
    if (shownRun === null) return;
    if (shownRun.state === 'running') watched.current.add(shownRun.id);
    else if (watched.current.has(shownRun.id)) onFinished(command.label, shownRun);
  }, [shownRun, command.label, onFinished]);

  const act = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  const isRunning = shownRun?.state === 'running';
  const outputId = `problems-output-${command.id}`;
  const items = detail.data?.items ?? [];
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-(--panel-padding)" data-testid="problems-command" data-command-id={command.id}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Text variant="label" as="h2" className="font-semibold" data-testid="problems-command-label">
            {command.label}
          </Text>
          <code className="font-mono text-mono-compact break-all text-muted-foreground" data-testid="problems-command-text">
            {command.command}
          </code>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {shownRun === null ? null : (
            <Text variant="caption" data-testid="problems-result" data-state={shownRun.state}>
              {problemsResultText(shownRun)}
            </Text>
          )}
          {isRunning ? (
            <Button variant="outline" data-testid="problems-stop" aria-disabled={busy || undefined} onClick={() => void act(() => stopProjectCommand(wsId, shownRun.id))}>
              {PROBLEMS_STOP_LABEL}
            </Button>
          ) : (
            <Button
              data-testid="problems-run"
              aria-label={`${PROBLEMS_RUN_LABEL} ${command.label}`}
              aria-disabled={busy || !command.confirmed || undefined}
              onClick={() => {
                if (command.confirmed) void act(async () => watched.current.add((await runProjectCommand(wsId, command.id)).run.id));
              }}
            >
              {PROBLEMS_RUN_LABEL}
            </Button>
          )}
          {shownRun === null ? null : (
            <Button variant="ghost" data-testid="problems-show-output" aria-expanded={showOutput} aria-controls={outputId} onClick={() => setShowOutput((open) => !open)}>
              {showOutput ? PROBLEMS_HIDE_OUTPUT_LABEL : PROBLEMS_SHOW_OUTPUT_LABEL}
            </Button>
          )}
        </div>
      </div>
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="problems-run-error">
          {error}
        </Text>
      )}
      {showOutput && detail.data !== undefined ? (
        <pre
          id={outputId}
          tabIndex={0}
          aria-label={`${PROBLEMS_OUTPUT_LABEL}: ${command.label}`}
          className="m-0 max-h-80 min-w-0 overflow-auto rounded-md bg-muted p-2 font-mono text-mono-compact whitespace-pre text-foreground"
          data-testid="problems-output"
        >
          {detail.data.output}
        </pre>
      ) : null}
      {detail.data === undefined || isRunning ? null : <RunItems wsId={wsId} command={command} items={items} parsed={detail.data.parsed} failed={detail.data.run.state === 'failed'} />}
    </li>
  );
}

/** A finished run's failures, grouped by file; a failed run nothing could read says so. */
function RunItems({ wsId, command, items, parsed, failed }: { wsId: string; command: ProjectCommand; items: ProblemItem[]; parsed: boolean; failed: boolean }) {
  const groups = useMemo(() => groupByFile(items), [items]);
  if (items.length === 0) {
    if (failed && !parsed) {
      return (
        <Text variant="caption" data-testid="problems-unparsed">
          {PROBLEMS_UNPARSED_TEXT}
        </Text>
      );
    }
    if (failed) {
      return (
        <Text variant="caption" data-testid="problems-none">
          {PROBLEMS_NONE_FOUND_TEXT}
        </Text>
      );
    }
    return null;
  }
  return (
    <ul className="m-0 flex min-w-0 list-none flex-col gap-3 p-0" data-testid="problems-files">
      {groups.map((group) => (
        <li key={group.path} className="flex min-w-0 flex-col gap-1" data-testid="problems-file" data-path={group.path}>
          <Text variant="mono-compact" as="h3" className="break-all text-foreground">
            {group.path}
          </Text>
          <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
            {group.items.map((item, index) => (
              <ProblemRow key={`${item.line}:${item.column ?? ''}:${index}`} wsId={wsId} command={command} item={item} />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** One failure: its `file:line` link, its message, Ask the agent to fix this, and Open in editor at its line. */
function ProblemRow({ wsId, command, item }: { wsId: string; command: ProjectCommand; item: ProblemItem }) {
  const navigate = useNavigate();
  const { sessions } = useSessions(wsId);
  const latest = sessions?.find((session) => session.kind === 'chat');
  const where = `${item.path}:${item.line}`;
  const ask = () => {
    if (latest === undefined) {
      writeProblemDraft(newChatDraftKey(wsId), command.command, item);
      void navigate({ to: '/w/$wsId/new', params: { wsId } });
      return;
    }
    writeProblemDraft(chatDraftKey(wsId, latest.id), command.command, item);
    void navigate({ to: '/w/$wsId/s/$sesId', params: { wsId, sesId: latest.id } });
  };
  return (
    <li className="flex min-w-0 flex-col gap-1 border-l-2 border-border pl-3" data-testid="problems-item" data-path={item.path} data-line={item.line}>
      <span className="min-w-0">
        <PathLink wsId={wsId} session={undefined} target={{ path: item.path, line: item.line }}>
          {where}
        </PathLink>
      </span>
      <Text variant="caption" className="break-words text-foreground" data-testid="problems-item-message">
        {item.message}
      </Text>
      <span className="flex flex-wrap items-center gap-1">
        <Button variant="outline" size="sm" data-testid="problems-ask" aria-label={`${latest === undefined ? PROBLEMS_ASK_NEW_CHAT_LABEL : PROBLEMS_ASK_AGENT_LABEL}: ${where}`} onClick={ask}>
          {latest === undefined ? PROBLEMS_ASK_NEW_CHAT_LABEL : PROBLEMS_ASK_AGENT_LABEL}
        </Button>
        <OpenInEditorButton wsId={wsId} session={undefined} target={{ path: item.path, line: item.line, column: item.column ?? undefined }} testId="problems-open-in-editor" />
      </span>
    </li>
  );
}

/** Add a command: its name and its text, which is saved exactly as typed (refused when it needs a shell). */
function AddCommand({ saving, onAdd }: { saving: boolean; onAdd: (name: string, text: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  if (!open) {
    return (
      <span>
        <Button variant="outline" data-testid="problems-add" onClick={() => setOpen(true)}>
          {PROBLEMS_ADD_COMMAND_LABEL}
        </Button>
      </span>
    );
  }
  const empty = name.trim() === '' || text.trim() === '';
  return (
    <form
      className="flex min-w-0 flex-col gap-3"
      data-testid="problems-add-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (empty || saving) return;
        void onAdd(name.trim(), text.trim()).then((saved) => {
          if (!saved) return;
          setOpen(false);
          setName('');
          setText('');
        });
      }}
    >
      <Field id="problems-command-name" label={PROBLEMS_COMMAND_NAME_LABEL}>
        <Input id="problems-command-name" value={name} maxLength={MAX_PROJECT_COMMAND_LABEL_CHARS} onChange={(event) => setName(event.target.value)} data-testid="problems-command-name" />
      </Field>
      <Field id="problems-command-text" label={PROBLEMS_COMMAND_TEXT_LABEL} description={PROBLEMS_COMMAND_TEXT_HINT}>
        <Input
          id="problems-command-text"
          aria-describedby="problems-command-text-description"
          className="font-mono"
          value={text}
          maxLength={MAX_PROJECT_COMMAND_CHARS}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => setText(event.target.value)}
          data-testid="problems-command-input"
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" aria-disabled={empty || saving || undefined} data-testid="problems-save-command">
          {PROBLEMS_SAVE_COMMAND_LABEL}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {PROBLEMS_CANCEL_LABEL}
        </Button>
      </div>
    </form>
  );
}
