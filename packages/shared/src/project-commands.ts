/**
 * Project commands and Problems (AD-38, CAP-34; epic v2 developer
 * experience, entry 2's contract, 8.9 runs and parses them): a project's
 * declared commands (test, lint, setup), the ones detected from
 * `package.json` and offered, a run's state, and its masked output and
 * parsed failures. Output and items are only ever in a `GET` response; the
 * two events carry ids, a state, an exit code and counts only (strict;
 * `events-workbench.ts`).
 */
import { z } from 'zod';
import { ProjectCommandRunId } from './ids.js';
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

/** One command. */
export const ProjectCommand = z.object({
  id: ProjectCommandId,
  label: z.string().trim().min(1).max(60),
  command: z.string().min(1).max(MAX_PROJECT_COMMAND_CHARS),
  source: ProjectCommandSource,
  /** Whether the user confirmed this exact text (a detected script whose text changed since is asked again). */
  confirmed: z.boolean(),
});
export type ProjectCommand = z.infer<typeof ProjectCommand>;

/** `GET …/project-commands` → this: the declared commands and the detected ones offered. */
export const ProjectCommandsResponse = z.object({
  declared: z.array(ProjectCommand),
  offered: z.array(ProjectCommand),
});
export type ProjectCommandsResponse = z.infer<typeof ProjectCommandsResponse>;

/** One command as the user saves it: `confirmedText` must be exactly its `command`, the text they saw. */
export const ProjectCommandInput = z
  .object({
    id: ProjectCommandId,
    label: z.string().trim().min(1).max(60),
    command: z.string().min(1).max(MAX_PROJECT_COMMAND_CHARS),
    source: ProjectCommandSource,
    confirmedText: z.string().min(1).max(MAX_PROJECT_COMMAND_CHARS),
  })
  .strict()
  .refine((input) => input.confirmedText === input.command, { message: 'Confirm the exact command.', path: ['confirmedText'] });
export type ProjectCommandInput = z.infer<typeof ProjectCommandInput>;

/** `PUT …/project-commands`: the project's commands, each confirmed with its exact text. Ids are unique. */
export const SetProjectCommandsRequest = z
  .object({ commands: z.array(ProjectCommandInput).max(MAX_PROJECT_COMMANDS) })
  .strict()
  .refine((request) => new Set(request.commands.map((command) => command.id)).size === request.commands.length, { message: 'Each command needs its own id.', path: ['commands'] });
export type SetProjectCommandsRequest = z.infer<typeof SetProjectCommandsRequest>;

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

/** The output kept: its last 1 MiB (runners print their failure summary last), masked. */
export const PROJECT_COMMAND_OUTPUT_MAX_BYTES = 1024 * 1024;
/** The most failures parsed from one run. */
export const PROJECT_COMMAND_MAX_ITEMS = 500;

/** The formats failures are parsed from (each with fixtures, 8.9). */
export const ProblemFormat = z.enum(['typescript', 'eslint', 'vitest', 'jest', 'pytest', 'go', 'rust']);
export type ProblemFormat = z.infer<typeof ProblemFormat>;

/** One parsed failure: where and what (its first line). */
export const ProblemItem = z.object({
  path: WorkspaceRelativePath,
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
  message: z.string().min(1).max(2000),
  format: ProblemFormat,
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
