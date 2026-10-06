import { MANAGER_DECISION_VERSION } from '@ogden-agents/shared';
import { dispatchableSteps, validateDecisionFor, type ManagerDecisionContext, type ManagerResult } from '../src/index.js';
import type { ManagerDecision } from '@ogden-agents/shared';

/**
 * The decision of a manager that has no opinion (story 15.9): send the first step that can go now, else say the goal is done. It goes through
 * the same check a real manager's answer does, so a step the check refuses is a failure here too.
 */
export function decideInOrder(context: ManagerDecisionContext): ManagerResult<ManagerDecision> {
  const next = dispatchableSteps(context)?.[0];
  return validateDecisionFor(
    context,
    next === undefined ? { version: MANAGER_DECISION_VERSION, action: 'done', reason: 'Every step has been done.' } : { version: MANAGER_DECISION_VERSION, action: 'dispatch', reason: 'It is the next step.', step_id: next },
  );
}
