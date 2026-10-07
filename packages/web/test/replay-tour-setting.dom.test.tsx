// @vitest-environment happy-dom
/**
 * Settings' Replay action (backlog story 19, AC4): disabled with no project
 * to point the tour at, and otherwise navigates to the first-listed project
 * and asks the tour store to open there.
 */
import type { Workspace } from '@ogden-agents/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayTourSetting } from '../src/tour/replay-tour-setting';
import { getTourSnapshot } from '../src/tour/tour-store';

const state = vi.hoisted(() => ({
  workspaces: undefined as Pick<Workspace, 'id'>[] | undefined,
  navigated: undefined as unknown,
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => (to: unknown) => (state.navigated = to) }));
vi.mock('@/workspaces/workspace-api', () => ({ useWorkspaces: () => ({ data: state.workspaces }) }));

beforeEach(() => {
  state.workspaces = undefined;
  state.navigated = undefined;
});
afterEach(cleanup);

describe('ReplayTourSetting', () => {
  it('is disabled with no project to replay the tour in', () => {
    state.workspaces = [];
    render(<ReplayTourSetting />);
    const button = screen.getByTestId('replay-tour');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(state.navigated).toBeUndefined();
    expect(getTourSnapshot().pendingReplayWsId).toBeUndefined();
  });

  it('navigates to the first project and asks the tour to open there', () => {
    state.workspaces = [{ id: 'ws_1' }, { id: 'ws_2' }];
    render(<ReplayTourSetting />);
    fireEvent.click(screen.getByTestId('replay-tour'));
    expect(state.navigated).toEqual({ to: '/w/$wsId', params: { wsId: 'ws_1' } });
    expect(getTourSnapshot().pendingReplayWsId).toBe('ws_1');
  });
});
