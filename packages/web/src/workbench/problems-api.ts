import {
  API_ROUTES,
  apiPath,
  problemDraftText,
  ProjectCommandRunDetail,
  ProjectCommandRunResponse,
  ProjectCommandsResponse,
  type ProblemItem,
  type ProjectCommand,
  type ProjectCommandInput,
} from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { call, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { readDraft, writeDraft } from '@/chat/drafts';

/**
 * The Workbench's Problems calls (AD-38; 8.9), sent with this tab's token. A
 * run's output and items are fetched while it is shown and never kept once
 * the panel closes (`gcTime: 0`); they never travel in an event.
 */

const COMMANDS_FAILED = "Ogden couldn't read this project's commands";
const SAVE_FAILED = "Ogden couldn't save these commands";
const RUN_FAILED = "Ogden couldn't run this command";
const RUN_READ_FAILED = "Ogden couldn't read this run";

/** `GET …/project-commands`: the declared commands and the offered scripts. */
export async function fetchProjectCommands(wsId: string, auth: Auth = tabAuth): Promise<ProjectCommandsResponse> {
  return ProjectCommandsResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceProjectCommands, { wsId }), {}, COMMANDS_FAILED));
}

/** `PUT …/project-commands`: the whole list, each confirmed with its exact text. */
export async function saveProjectCommands(wsId: string, commands: readonly ProjectCommandInput[], auth: Auth = tabAuth): Promise<ProjectCommandsResponse> {
  const init: RequestInit = { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commands }) };
  return ProjectCommandsResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceProjectCommands, { wsId }), init, SAVE_FAILED));
}

/** `POST …/project-commands/:commandId/runs`. */
export async function runProjectCommand(wsId: string, commandId: string, auth: Auth = tabAuth): Promise<ProjectCommandRunResponse> {
  return ProjectCommandRunResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceProjectCommandRuns, { wsId, commandId }), postJson({}), RUN_FAILED));
}

/** `POST …/project-command-runs/:runId/stop`. */
export async function stopProjectCommand(wsId: string, runId: string, auth: Auth = tabAuth): Promise<ProjectCommandRunResponse> {
  return ProjectCommandRunResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceProjectCommandRunStop, { wsId, runId }), postJson({}), RUN_FAILED));
}

/** `GET …/project-command-runs/:runId`: the run, its masked output and its failures. */
export async function fetchProjectCommandRun(wsId: string, runId: string, auth: Auth = tabAuth): Promise<ProjectCommandRunDetail> {
  return ProjectCommandRunDetail.parse(await call(auth, apiPath(API_ROUTES.workspaceProjectCommandRun, { wsId, runId }), {}, RUN_READ_FAILED));
}

export const projectCommandsKey = (wsId: string) => ['project-commands', wsId] as const;

/** The project's commands; read again every second while one of them runs. */
export function useProjectCommands(wsId: string) {
  return useQuery({
    queryKey: projectCommandsKey(wsId),
    queryFn: () => fetchProjectCommands(wsId),
    retry: false,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.declared.some((command) => command.lastRun?.state === 'running') ? 1000 : false),
  });
}

/** One run's detail, read every second while it runs; only when asked for. */
export function useProjectCommandRun(wsId: string, runId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['project-command-run', wsId, runId ?? ''],
    queryFn: () => fetchProjectCommandRun(wsId, runId!),
    enabled: enabled && runId !== undefined,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) => (query.state.data?.run.state === 'running' ? 1000 : false),
  });
}

/** A declared command as `PUT` takes it back: kept as it is (a script's confirmation stays the stored one). */
export function keptInput(command: ProjectCommand): ProjectCommandInput {
  return {
    id: command.id,
    label: command.label,
    command: command.command,
    source: command.source,
    confirmedText: command.command,
    ...(command.script === undefined ? {} : { script: command.script }),
  };
}

/** A command confirmed as the user saw it: a script with the text shown. */
export function confirmedInput(command: ProjectCommand): ProjectCommandInput {
  return { ...keptInput(command), ...(command.source === 'package_json' && command.scriptText !== undefined ? { confirmedScript: command.scriptText } : {}) };
}

/** `existing` and `addition` joined after a blank line (or `addition` alone). */
export const appendDraft = (existing: string, addition: string): string => (existing.trim() === '' ? addition : `${existing.replace(/\s+$/, '')}\n\n${addition}`);

/** Writes Ask the agent to fix this's text after the draft kept under `key`; nothing is sent. */
export function writeProblemDraft(key: string, command: string, item: Pick<ProblemItem, 'path' | 'line' | 'message' | 'detail'>): string {
  const text = appendDraft(readDraft(key), problemDraftText(command, item));
  writeDraft(key, text);
  return text;
}
