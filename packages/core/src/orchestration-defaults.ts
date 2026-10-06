/**
 * The install's orchestration defaults (epic 15, story 15.8): the mode new
 * projects are offered, and the limits of every run (instructions, depth,
 * minutes), each within its bounds. They are install-level preferences kept
 * beside the defaults for new projects (`preferences.json`) and change
 * through `settings.orchestration_defaults_changed`.
 *
 * Making Dispatch automatically the default needs the user's confirmation
 * every time it is set, and it never reaches a project: a project starts on
 * Approve each instruction and confirms automatic for itself, once, in its
 * own settings (the confirmation is recorded in that project's event log).
 * Nothing here can reach a project's own mode.
 */
import {
  AUTOMATIC_NEEDS_CONFIRMATION,
  BoundedRunLimits,
  DEFAULT_ORCHESTRATION_MODE,
  RUN_LIMITS,
  SETTINGS_STREAM,
  UpdateOrchestrationDefaultsRequest,
  type OrchestrationDefaults,
} from '@ogden-agents/shared';
import { ConfirmationRequiredError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import type { NewProjectDefaultsStore } from './new-projects.js';

export interface OrchestrationDefaultsUseCase {
  /** The default mode and the limits as kept (Approve each instruction, 20 instructions, depth 3, 30 minutes when nothing was set). */
  get(): OrchestrationDefaults;
  /**
   * Changes them (`UpdateOrchestrationDefaultsRequest`; what is left out is kept) and appends `settings.orchestration_defaults_changed`
   * when something changed. {@link ValidationError} for a limit out of its bounds or nothing to change, and
   * {@link ConfirmationRequiredError} for Dispatch automatically without `confirm: true`; nothing is written then.
   */
  set(input: unknown): OrchestrationDefaults;
}

export interface OrchestrationDefaultsOptions {
  events: EventLog;
  defaults: Pick<NewProjectDefaultsStore, 'get' | 'setOrchestration'>;
}

export function createOrchestrationDefaults({ events, defaults }: OrchestrationDefaultsOptions): OrchestrationDefaultsUseCase {
  const read = (): OrchestrationDefaults => {
    const kept = defaults.get();
    // A stored limit outside today's bounds (a hand edited file) reads as the defaults rather than running with it.
    const limits = BoundedRunLimits.safeParse(kept.orchestrationLimits);
    return { mode: kept.orchestrationMode ?? DEFAULT_ORCHESTRATION_MODE, limits: limits.success ? limits.data : { ...RUN_LIMITS } };
  };
  return {
    get: read,
    set(input) {
      const parsed = UpdateOrchestrationDefaultsRequest.safeParse(input);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Choose a setting to change.', parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })));
      if (parsed.data.mode === 'automatic' && parsed.data.confirm !== true) throw new ConfirmationRequiredError(AUTOMATIC_NEEDS_CONFIRMATION);
      const previous = read();
      const next: OrchestrationDefaults = { mode: parsed.data.mode ?? previous.mode, limits: { ...previous.limits, ...parsed.data.limits } };
      const changed = next.mode !== previous.mode || next.limits.maxInstructions !== previous.limits.maxInstructions || next.limits.maxDepth !== previous.limits.maxDepth || next.limits.maxMinutes !== previous.limits.maxMinutes;
      if (!changed) return previous;
      const kept = defaults.setOrchestration(next);
      events.append({
        type: 'settings.orchestration_defaults_changed',
        workspaceId: null,
        streamId: SETTINGS_STREAM,
        payload: { mode: kept.mode, previousMode: previous.mode, limits: kept.limits, previousLimits: previous.limits, ...(parsed.data.mode === 'automatic' && kept.mode === 'automatic' ? { automaticConfirmed: true as const } : {}) },
      });
      return kept;
    },
  };
}
