// @vitest-environment happy-dom
/**
 * Epic 6, entry 2 (the tracer), in the web: a chat's agent by its product
 * name, the bare agent picker for new chats (shown only when there is a
 * choice), and the status sidebar naming each chat's agent.
 */
import type { ChatAgentsResponse, CoreEvent, Session, Workspace } from '@ogden-agents/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPicker } from '../src/chat/agent-picker';
import { agentNameOf } from '../src/chat/chat-api';
import { applyEvent, emptyStore } from '../src/events/event-store';
import { buildSidebar } from '../src/shell/sidebar-model';

afterEach(cleanup);

const LIST: ChatAgentsResponse = {
  agents: [
    { agentId: 'claude-code', displayName: 'Claude Code', permissionModes: ['ask', 'auto', 'skip_all'] },
    { agentId: 'fake-agent', displayName: 'Fake Agent', permissionModes: ['ask', 'skip_all'] },
  ],
  defaultAgentId: 'claude-code',
};

describe('agentNameOf', () => {
  it("names a chat's agent from the list, a session from before agents could be chosen as Claude Code, and an unlisted one plainly", () => {
    expect(agentNameOf(LIST, 'fake-agent')).toBe('Fake Agent');
    expect(agentNameOf(LIST, 'claude-code')).toBe('Claude Code');
    expect(agentNameOf(LIST, undefined)).toBe('Claude Code');
    expect(agentNameOf(undefined, 'claude-code')).toBe('Claude Code');
    expect(agentNameOf(LIST, 'gone-agent')).toBe('The agent');
    expect(agentNameOf(undefined, 'fake-agent')).toBe('The agent');
  });
});

describe('AgentPicker', () => {
  it('is not shown while the install has one agent', () => {
    render(<AgentPicker agents={LIST.agents.slice(0, 1)} value="claude-code" onChange={() => {}} />);
    expect(screen.queryByTestId('agent-picker')).toBeNull();
  });

  it('offers each agent by its product name, the chosen one pressed, and reports a new choice only', () => {
    const onChange = vi.fn();
    render(<AgentPicker agents={LIST.agents} value="claude-code" onChange={onChange} />);
    const options = screen.getAllByTestId('agent-option');
    expect(options.map((option) => option.textContent)).toEqual(['Claude Code', 'Fake Agent']);
    expect(options[0]!.getAttribute('data-state')).toBe('on');
    fireEvent.click(options[1]!);
    expect(onChange).toHaveBeenCalledWith('fake-agent');
    onChange.mockClear();
    // Clicking the chosen agent again keeps it: a chat always has an agent.
    fireEvent.click(options[0]!);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the status sidebar names each chat by its agent (E6-R1)', () => {
  const workspace = { id: 'ws_a', path: '/repo', realPath: '/repo', createdAt: '2026-10-01T00:00:00.000Z' } as Workspace;
  const at = '2026-10-03T11:59:00.000Z';
  const session = (id: string, agentId: string | undefined, state: Session['state']) =>
    ({ id, workspaceId: 'ws_a', kind: 'chat', state, driver: 'ui', title: null, adapterRefs: {}, createdAt: at, updatedAt: at, ...(agentId === undefined ? {} : { agentId }) }) as unknown as Session;

  it("gives each row its chat's agent, and Needs you names the agent that asks", () => {
    const requested = {
      id: 'evt_1',
      seq: 1,
      at,
      workspaceId: 'ws_a',
      streamId: 'ses_fake',
      type: 'permission.requested',
      payload: {
        sessionId: 'ses_fake',
        requestId: 'req_1',
        toolCall: { toolCallId: 't1', title: 'Run npm test', kind: 'execute', command: 'npm test' },
        alwaysAllowScope: null,
        cautionLevel: 'ask_every_time',
      },
    } as unknown as CoreEvent;
    const model = buildSidebar(
      [workspace],
      [session('ses_claude', 'claude-code', 'working'), session('ses_fake', 'fake-agent', 'waiting'), session('ses_old', undefined, 'idle')],
      applyEvent(emptyStore(), requested),
      Date.parse('2026-10-03T12:00:00.000Z'),
      (agentId) => agentNameOf(LIST, agentId),
    );
    const names = Object.fromEntries(model.groups[0]!.rows.map((row) => [row.sesId, row.agentName]));
    expect(names).toEqual({ ses_claude: 'Claude Code', ses_fake: 'Fake Agent', ses_old: 'Claude Code' });
    expect(model.needsYou.map((entry) => entry.text)).toEqual(['Fake Agent wants to run npm test']);
  });
});
