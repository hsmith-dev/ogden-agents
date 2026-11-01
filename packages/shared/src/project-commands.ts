/**
 * Project commands and Problems (AD-38, CAP-34; epic v2 developer
 * experience, entry 2's contract, 8.9 runs and parses them): a project's
 * declared commands (test, lint, setup), the ones detected from
 * `package.json` and offered, a run's state, and its masked output and
 * parsed failures. Output and items are only ever in a `GET` response; the
 * events carry ids, a state, an exit code and counts only (strict;
 * `events-workbench.ts`).
 */
import { z } from 'zod';
import { ProjectCommandRunId } from './ids.js';
import { redactSecrets } from './secret-patterns.js';
import { IsoUtcTimestamp } from './time.js';
import { WorkspaceRelativePath } from './workspace-files.js';

/** A command's id: a short lower-case slug (`test`, `lint`, `type-check`). */
export const ProjectCommandId = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9-]*$/, 'A command id: lower-case letters, digits and dashes.');
export type ProjectCommandId = z.infer<typeof ProjectCommandId>;

/** Where a command came from: the project's settings, or a `package.json` script (offered until confirmed). */
export const ProjectCommandSource = z.enum(['settings', 'package_json']);
export type ProjectCommandSource = z.infer<typeof ProjectCommandSource>;

/** The longest command text. */
export const MAX_PROJECT_COMMAND_CHARS = 2000;
/** The most commands a project declares. */
export const MAX_PROJECT_COMMANDS = 20;

/** A `package.json` script's name, as `<pm> run <script>` names it (never starting with `-`, so never an option). */
export const PackageScriptName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_@][A-Za-z0-9_@:./-]*$/, "A package.json script's name.");
export type PackageScriptName = z.infer<typeof PackageScriptName>;

/** A run's state. */
export const ProjectCommandRunState = z.enum(['running', 'passed', 'failed', 'stopped', 'error']);
export type ProjectCommandRunState = z.infer<typeof ProjectCommandRunState>;

/** One run of a command. */
export const ProjectCommandRun = z.object({
  id: ProjectCommandRunId,
  commandId: ProjectCommandId,
  state: ProjectCommandRunState,
  /** `null` while running, and when it never started or was killed. */
  exitCode: z.number().int().nullable(),
  /** How many failures were parsed. */
  itemCount: z.number().int().nonnegative(),
  startedAt: IsoUtcTimestamp,
  finishedAt: IsoUtcTimestamp.nullable(),
});
export type ProjectCommandRun = z.infer<typeof ProjectCommandRun>;

/** One command. */
export const ProjectCommand = z.object({
  id: ProjectCommandId,
  label: z.string().trim().min(1).max(60),
  /** What runs, as the user reads it: a settings command's text, or `<pm> run <script>` for a script. */
  command: z.string().min(1).max(MAX_PROJECT_COMMAND_CHARS),
  source: ProjectCommandSource,
  /** Whether the user confirmed this exact text (a detected script whose text changed since is asked again). */
  confirmed: z.boolean(),
  /** A `package_json` command's script name. */
  script: PackageScriptName.optional(),
  /** That script's text in `package.json` now (absent when the script is gone): what the user confirms. */
  scriptText: z.string().max(MAX_PROJECT_COMMAND_CHARS).optional(),
  /** Its latest run since the server started, or `null`. */
  lastRun: ProjectCommandRun.nullable(),
});
export type ProjectCommand = z.infer<typeof ProjectCommand>;

/** `GET …/project-commands` → this: the declared commands and the detected ones offered. */
export const ProjectCommandsResponse = z.object({
  declared: z.array(ProjectCommand),
  offered: z.array(ProjectCommand),
});
export type ProjectCommandsResponse = z.infer<typeof ProjectCommandsResponse>;

/**
 * One command as the user saves it: `confirmedText` must be exactly its
 * `command`, the text they saw. A `package_json` command names its
 * `script`, and `confirmedScript` is the script's text the user confirmed
 * (absent: keep the confirmation already stored for that command); a
 * settings command names neither.
 */
export const ProjectCommandInput = z
  .object({
    id: ProjectCommandId,
    label: z.string().trim().min(1).max(60),
    command: z.string().min(1).max(MAX_PROJECT_COMMAND_CHARS),
    source: ProjectCommandSource,
    confirmedText: z.string().min(1).max(MAX_PROJECT_COMMAND_CHARS),
    script: PackageScriptName.optional(),
    confirmedScript: z.string().min(1).max(MAX_PROJECT_COMMAND_CHARS).optional(),
  })
  .strict()
  .refine((input) => input.confirmedText === input.command, { message: 'Confirm the exact command.', path: ['confirmedText'] })
  .refine((input) => (input.source === 'package_json' ? input.script !== undefined : input.script === undefined && input.confirmedScript === undefined), {
    message: 'A package.json command names its script; a settings command does not.',
    path: ['script'],
  });
export type ProjectCommandInput = z.infer<typeof ProjectCommandInput>;

/** `PUT …/project-commands`: the project's commands, each confirmed with its exact text. Ids are unique. */
export const SetProjectCommandsRequest = z
  .object({ commands: z.array(ProjectCommandInput).max(MAX_PROJECT_COMMANDS) })
  .strict()
  .refine((request) => new Set(request.commands.map((command) => command.id)).size === request.commands.length, { message: 'Each command needs its own id.', path: ['commands'] });
export type SetProjectCommandsRequest = z.infer<typeof SetProjectCommandsRequest>;

/** The output kept: its last 1 MiB (runners print their failure summary last), masked. */
export const PROJECT_COMMAND_OUTPUT_MAX_BYTES = 1024 * 1024;
/** The most failures parsed from one run. */
export const PROJECT_COMMAND_MAX_ITEMS = 500;
/** How long a run may take before it is stopped (`error`). */
export const PROJECT_COMMAND_MAX_RUN_MS = 30 * 60 * 1000;

/** The formats failures are parsed from (each with fixtures, 8.9). */
export const ProblemFormat = z.enum(['typescript', 'eslint', 'vitest', 'jest', 'pytest', 'go', 'rust']);
export type ProblemFormat = z.infer<typeof ProblemFormat>;

/** The most output lines kept with one failure. */
export const PROBLEM_DETAIL_MAX_LINES = 20;
/** The most characters kept with one failure. */
export const PROBLEM_DETAIL_MAX_CHARS = 2000;

/** One parsed failure: where and what (its first line). */
export const ProblemItem = z.object({
  path: WorkspaceRelativePath,
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
  message: z.string().min(1).max(2000),
  format: ProblemFormat,
  /** The output lines that came with it (masked): at most {@link PROBLEM_DETAIL_MAX_LINES} lines and {@link PROBLEM_DETAIL_MAX_CHARS} characters. */
  detail: z.string().max(PROBLEM_DETAIL_MAX_CHARS).optional(),
});
export type ProblemItem = z.infer<typeof ProblemItem>;

/** `GET …/project-command-runs/:runId` → this: the run, its masked output and its failures. */
export const ProjectCommandRunDetail = z.object({
  run: ProjectCommandRun,
  /** Masked with AD-16's patterns; the last {@link PROJECT_COMMAND_OUTPUT_MAX_BYTES}. */
  output: z.string(),
  /** The output was cut to its last part. */
  truncated: z.boolean(),
  items: z.array(ProblemItem).max(PROJECT_COMMAND_MAX_ITEMS),
  /** Whether a known format read the output; `false`: it is shown as printed. */
  parsed: z.boolean(),
});
export type ProjectCommandRunDetail = z.infer<typeof ProjectCommandRunDetail>;

/** `POST …/project-commands/:commandId/runs` and `POST …/project-command-runs/:runId/stop` → this. */
export const ProjectCommandRunResponse = z.object({ run: ProjectCommandRun });
export type ProjectCommandRunResponse = z.infer<typeof ProjectCommandRunResponse>;

/** The Workbench's Problems panel. */
export const WORKBENCH_PROBLEMS_LABEL = 'Problems';
/** Problems in a project not trusted yet. */
export const PROBLEMS_UNTRUSTED_TEXT = "Problems runs this project's own commands, so it needs you to trust this project first.";
/** No command declared. */
export const PROBLEMS_NO_COMMANDS_TEXT = 'No test or lint command yet.';
/** Output no known format read. */
export const PROBLEMS_UNPARSED_TEXT = "Ogden couldn't read the failures from this output, so here it is as printed.";
/** The offer of detected scripts. */
export const problemsOfferText = (names: readonly string[]): string => `Found in package.json: ${names.join(', ')}. Use them?`;
/** The labels detected scripts are offered under. */
export const PROBLEMS_DETECTED_LABELS: Readonly<Record<'test' | 'lint', string>> = { test: 'Tests', lint: 'Lint' };
export const PROBLEMS_USE_OFFER_LABEL = 'Use these';
export const PROBLEMS_NOT_NOW_LABEL = 'Not now';
export const PROBLEMS_RUN_LABEL = 'Run';
export const PROBLEMS_STOP_LABEL = 'Stop';
export const PROBLEMS_SHOW_OUTPUT_LABEL = 'Show output';
export const PROBLEMS_HIDE_OUTPUT_LABEL = 'Hide output';
export const PROBLEMS_ADD_COMMAND_LABEL = 'Add a command';
export const PROBLEMS_SAVE_COMMAND_LABEL = 'Save command';
export const PROBLEMS_CANCEL_LABEL = 'Cancel';
export const PROBLEMS_COMMAND_NAME_LABEL = 'Name';
export const PROBLEMS_COMMAND_TEXT_LABEL = 'Command';
export const PROBLEMS_COMMAND_TEXT_HINT = 'One program and its arguments. Ogden runs it in the project folder, without a shell.';
export const PROBLEMS_USE_NEW_TEXT_LABEL = 'Use the new text';
/** A run in progress. */
export const PROBLEMS_RUNNING_TEXT = 'Running';
/** Ask the agent to fix this: fills the project's latest chat's composer, never sends. */
export const PROBLEMS_ASK_AGENT_LABEL = 'Ask the agent to fix this';
/** The same, when the project has no chat yet: the new chat's composer. */
export const PROBLEMS_ASK_NEW_CHAT_LABEL = 'Ask in a new chat';
/** The run's output panel. */
export const PROBLEMS_OUTPUT_LABEL = 'Output';
/** A run that passed but whose output still named failures. */
export const PROBLEMS_NONE_FOUND_TEXT = 'No failures found.';

/** The 409 `command_changed` message: the script's text isn't the one the user confirmed. */
export const COMMAND_CHANGED_MESSAGE = 'This command changed since you confirmed it. Check the new text and confirm it again.';
/** A declared script whose text changed since it was confirmed. */
export const problemsScriptChangedText = (script: string): string =>
  `The ${script} script in package.json, or this project's package manager settings, changed since you confirmed it. Check the text before it runs.`;
/** A declared script that package.json no longer has. */
export const problemsScriptGoneText = (script: string): string => `package.json has no ${script} script any more.`;

/** Why a command can't be run without a shell, each in plain words. */
export const PROJECT_COMMAND_REFUSALS = {
  empty: 'Type the command to run.',
  operator: "Ogden runs one program with its arguments, without a shell, so it can't use &&, |, ;, redirects, ( ) or $. Put the steps in a script and run that.",
  expansion: "Ogden runs without a shell, so $ and backquotes inside double quotes aren't expanded. Write the value itself, or use single quotes.",
  newline: 'A command is one line.',
  glob: "Ogden runs without a shell, so it doesn't expand * ? or [ ]. Name the files, or let the tool find them.",
  home: "Ogden runs without a shell, so it doesn't expand ~. Give the full path.",
  assignment: "Ogden can't set a variable like NAME=value before the command, since it runs without a shell. Set it in the tool's own config.",
  quote: 'A quote in this command is not closed.',
  relative: "Give an absolute path for the program, or just the program's name if it's on your PATH.",
  shell: 'Ogden runs commands without a shell, so it doesn\'t start one. Run the program itself.',
  wrapper: "Ogden runs the program itself, so it doesn't start it through env, sudo, nohup, xargs, find -exec or a similar wrapper. Run the program directly.",
} as const;
export type ProjectCommandRefusal = keyof typeof PROJECT_COMMAND_REFUSALS;

/** `n failures` (one: `1 failure`). */
export const failuresText = (count: number): string => `${count} ${count === 1 ? 'failure' : 'failures'}`;

/** A finished run in a row: `Passed`, `Failed: 2 failures`, `Failed (exit code 1)`, `Stopped`, `Couldn't run`. */
export function problemsResultText(run: Pick<ProjectCommandRun, 'state' | 'exitCode' | 'itemCount'>): string {
  switch (run.state) {
    case 'running':
      return PROBLEMS_RUNNING_TEXT;
    case 'passed':
      return 'Passed';
    case 'failed':
      return run.itemCount > 0 ? `Failed: ${failuresText(run.itemCount)}` : run.exitCode === null ? 'Failed' : `Failed (exit code ${run.exitCode})`;
    case 'stopped':
      return 'Stopped';
    case 'error':
      return "Couldn't run";
  }
}

/** What the live region says once a run ends: `Tests finished: 2 failures`, `Lint finished: passed`. */
export function problemsFinishedText(label: string, run: Pick<ProjectCommandRun, 'state' | 'exitCode' | 'itemCount'>): string {
  if (run.state === 'stopped') return `${label} stopped`;
  if (run.state === 'error') return `${label} couldn't run`;
  if (run.state === 'passed') return `${label} finished: passed`;
  return `${label} finished: ${run.itemCount > 0 ? failuresText(run.itemCount) : 'failed'}`;
}

/**
 * The composer text Ask the agent to fix this writes, from the item: what
 * ran, the failure at its `file:line`, and its output lines. The whole text
 * is masked (the command's own text may hold a token).
 */
export function problemDraftText(command: string, item: Pick<ProblemItem, 'path' | 'line' | 'message' | 'detail'>): string {
  const head = `Fix this failure from ${command}:\n\n${item.path}:${item.line} ${item.message}`;
  return redactSecrets(item.detail === undefined || item.detail.trim() === '' ? head : `${head}\n\n${item.detail}`);
}
