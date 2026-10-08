/**
 * AD-28's conflict rule (epic 18 story 6): each two-way field keeps its
 * baseline value unless changed on exactly one side; a genuine two-sided
 * conflict keeps local and is noted, except on an explicit Refresh. The
 * `done` exception overrides all of that for `status`, even on Refresh.
 */
import { describe, expect, it } from 'vitest';
import { reconcileField, reconcileStatus } from '../src/tickets-jira/conflict-resolution.js';

describe('reconcileField (title/body)', () => {
  it('keeps local when neither side changed', () => {
    expect(reconcileField('Same', 'Same', 'Same', false)).toEqual({ action: 'keep', value: 'Same' });
  });

  it('pushes local to Jira when only local changed (AD-28: "a local title/body edit pushes to the matching Jira issue")', () => {
    expect(reconcileField('Old title', 'Local edit', 'Old title', false)).toEqual({ action: 'push', value: 'Local edit' });
  });

  it('applies Jira\'s value when only Jira changed', () => {
    expect(reconcileField('Old title', 'Old title', 'Jira changed it', false)).toEqual({ action: 'apply', value: 'Jira changed it' });
  });

  it('keeps local, unchanged by the fact Jira also changed, when both landed on the same new value', () => {
    expect(reconcileField('Old', 'New value', 'New value', false)).toEqual({ action: 'keep', value: 'New value' });
  });

  it('is a genuine conflict when both changed to different values, on the background poll', () => {
    expect(reconcileField('Old', 'Local change', 'Jira change', false)).toEqual({ action: 'conflict', value: 'Local change', conflict: { local: 'Local change', jira: 'Jira change' } });
  });

  it('resolves a genuine conflict to Jira\'s value on an explicit Refresh', () => {
    expect(reconcileField('Old', 'Local change', 'Jira change', true)).toEqual({ action: 'apply', value: 'Jira change' });
  });
});

describe('reconcileStatus', () => {
  it('keeps local when Jira is still the same status (even a different but equivalent name)', () => {
    // "To Do" and "Backlog" both map to draft: not a meaningful Jira-side change.
    expect(reconcileStatus('To Do', 'draft', 'Backlog', false)).toEqual({ action: 'keep', value: 'draft' });
  });

  it('applies Jira\'s mapped status when only Jira changed, for an ordinary pipeline status', () => {
    expect(reconcileStatus('To Do', 'draft', 'In Progress', false)).toEqual({ action: 'apply', value: 'in-progress' });
  });

  it('pushes local to Jira when only local changed', () => {
    expect(reconcileStatus('To Do', 'in-review', 'To Do', false)).toEqual({ action: 'push', value: 'in-review' });
  });

  it('is a genuine conflict when both changed to different statuses, on the background poll', () => {
    const outcome = reconcileStatus('To Do', 'in-progress', 'In Review', false);
    expect(outcome).toMatchObject({ action: 'conflict', value: 'in-progress', reason: 'both_changed' });
  });

  it('resolves a genuine status conflict to Jira\'s mapped value on an explicit Refresh, when that move is itself forward', () => {
    expect(reconcileStatus('To Do', 'in-progress', 'In Review', true)).toEqual({ action: 'apply', value: 'in-review' });
  });

  it('never applies a Jira done-equivalent status automatically, not even on an explicit Refresh (AD-28\'s exception)', () => {
    expect(reconcileStatus('In Progress', 'in-progress', 'Done', false)).toMatchObject({ action: 'conflict', reason: 'done_exception' });
    expect(reconcileStatus('In Progress', 'in-progress', 'Done', true)).toMatchObject({ action: 'conflict', reason: 'done_exception' });
  });

  it('is fine with a pulled Jira status that already matches local done (no exception needed when local already agrees)', () => {
    expect(reconcileStatus('In Progress', 'done', 'Done', false)).toEqual({ action: 'keep', value: 'done' });
  });

  it('never pulls a backward move: local already past in-review, Jira moved back to To Do', () => {
    // Only Jira changed (local still matches the baseline), but applying it would move the ticket backward on BMad's
    // own pipeline (in-review -> draft) -- AD-28's own "including some backward ones" case.
    const outcome = reconcileStatus('In Review', 'in-review', 'To Do', false);
    expect(outcome).toMatchObject({ action: 'conflict', reason: 'no_valid_transition' });
  });

  it('still allows a forward pull even when the baseline-vs-local check alone would have applied it', () => {
    expect(reconcileStatus('To Do', 'draft', 'In Review', false)).toEqual({ action: 'apply', value: 'in-review' });
  });

  it('always allows moving into or out of blocked, in either pipeline direction', () => {
    expect(reconcileStatus('In Review', 'in-review', 'Blocked', false)).toEqual({ action: 'apply', value: 'blocked' });
    expect(reconcileStatus('Blocked', 'blocked', 'To Do', false)).toEqual({ action: 'apply', value: 'draft' });
  });
});
