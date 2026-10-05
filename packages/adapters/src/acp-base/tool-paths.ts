/**
 * Every path an ACP tool call names (story 2.8, moved into the shared ACP
 * client in 6.4). Which raw-input fields name a path is the agent's own;
 * the rule for using them is shared.
 */
import { isAbsolute, join } from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';

/** The raw-input fields of an agent's tools that name paths. */
export interface AcpToolInputPaths {
  /** Fields that name a file or folder. A field called `path` is also a search's folder. */
  pathFields: readonly string[];
  /** Fields of a search (a glob or a pattern) that can reach past its folder. */
  patternFields: readonly string[];
}

/**
 * Every path a tool call names: its locations, its diffs, and the path
 * fields of its raw input. Core lets a file-kind rule match only when all
 * of them lie inside the workspace, so naming more paths only narrows it.
 *
 * A search pattern is a path too when it can reach elsewhere: an absolute
 * one or one starting with `~` as given (core can't resolve `~`, so it
 * asks), and one with a `..` segment resolved against the search folder
 * (its `path`, else `cwd`). A search that names no folder searches `cwd`,
 * which is named for it.
 */
export function toolCallPaths(toolCall: acp.ToolCallUpdate, cwd: string, fields: AcpToolInputPaths): string[] {
  const paths = new Set<string>();
  for (const location of toolCall.locations ?? []) if (typeof location.path === 'string') paths.add(location.path);
  for (const item of toolCall.content ?? []) if (item.type === 'diff' && typeof item.path === 'string') paths.add(item.path);
  const raw = toolCall.rawInput;
  if (typeof raw === 'object' && raw !== null) {
    for (const field of fields.pathFields) {
      const value = (raw as Record<string, unknown>)[field];
      if (typeof value === 'string' && value !== '') paths.add(value);
    }
    const folder = (raw as Record<string, unknown>).path;
    const root = typeof folder === 'string' && folder !== '' ? folder : undefined;
    let patterned = false;
    for (const field of fields.patternFields) {
      const value = (raw as Record<string, unknown>)[field];
      if (typeof value !== 'string' || value === '') continue;
      patterned = true;
      if (value.startsWith('~') || isAbsolute(value)) paths.add(value);
      else if (value.split(/[\\/]/).includes('..')) {
        // Under a `~` folder the folder itself is already named, and core asks for it.
        if (root === undefined || !root.startsWith('~')) paths.add(join(root ?? cwd, value));
      }
    }
    if (patterned && root === undefined) paths.add(cwd);
  }
  return [...paths];
}

/** The command a shell tool call would run, when the agent put one in its raw input: the first of `fields` that holds a string. */
export function commandOf(rawInput: unknown, fields: readonly string[] = ['command']): string | undefined {
  if (typeof rawInput !== 'object' || rawInput === null) return undefined;
  for (const field of fields) {
    const command = (rawInput as Record<string, unknown>)[field];
    if (typeof command === 'string') return command;
  }
  return undefined;
}
