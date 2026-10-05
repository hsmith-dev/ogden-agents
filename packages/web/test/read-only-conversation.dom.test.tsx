// @vitest-environment happy-dom
/**
 * The read-only conversation while the terminal drives (story 3.6 review F2):
 * it stays readable by role, and nothing in it sends. A permission card's
 * buttons are `aria-disabled` with no handler (a click or `1`/`2`/`3` sends no
 * answer), and a record offers no Undo Always allow. Outside it, the same card
 * still answers.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptPermission } from '../src/chat/transcript';

const calls = vi.hoisted(() => ({ decide: vi.fn(() => Promise.resolve()), remove: vi.fn(() => Promise.resolve()) }));
vi.mock('@/chat/chat-api', async (original) => ({
  ...(await original<typeof import('../src/chat/chat-api')>()),
  decidePermission: calls.decide,
  removePermissionRule: calls.remove,
}));

const { ReadOnlyConversation } = await import('../src/chat/read-only');
const { PermissionCard } = await import('../src/permissions/permission-card');
const { conversationProps, READ_ONLY_CONVERSATION } = await import('../src/terminal/terminal-pane');
const { PageBody } = await import('../src/ui/page');

afterEach(() => {
  cleanup();
  calls.decide.mockClear();
  calls.remove.mockClear();
});

const pending = (): TranscriptPermission => ({
  requestId: 'preq_1',
  toolCall: { toolCallId: 't1', title: 'Run npm install stripe', kind: 'execute', command: 'npm install stripe' },
  scope: { kind: 'command_prefix', value: 'npm install', label: 'npm install' },
  cautionLevel: 'ask_every_time',
  requestedAt: '2026-09-30T12:00:00.000Z',
  status: 'pending',
  resolution: undefined,
});

const alwaysAllowed = (): TranscriptPermission => ({
  ...pending(),
  status: 'resolved',
  resolution: { decision: 'allow_always', by: 'user', reason: undefined, ruleId: 'rule_1', ruleRemoved: false, at: '2026-09-30T12:01:00.000Z' },
});

function conversation(readOnly: boolean, children: ReactNode) {
  render(
    <PageBody {...conversationProps(readOnly, true)}>
      <ReadOnlyConversation.Provider value={readOnly}>{children}</ReadOnlyConversation.Provider>
    </PageBody>,
  );
}

describe('the read-only conversation (review F2)', () => {
  it('stays readable by role under its read-only name', () => {
    conversation(true, <p>Hello from the fake agent.</p>);
    const region = screen.getByRole('region', { name: READ_ONLY_CONVERSATION });
    expect(region.textContent).toContain('Hello from the fake agent.');
    expect(region.hasAttribute('inert')).toBe(false);
    expect(region.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("makes a waiting card's answers aria-disabled: a click or a number key sends nothing", () => {
    conversation(true, <PermissionCard permission={pending()} wsId="ws_1" sesId="ses_1" projectName="clay" agentName="Claude Code" />);
    for (const name of ['Allow once', 'Always allow', 'Deny']) {
      const button = screen.getByRole('button', { name });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.hasAttribute('aria-keyshortcuts')).toBe(false);
      fireEvent.click(button);
    }
    fireEvent.keyDown(screen.getByTestId('permission-card'), { key: '1' });
    expect(calls.decide).not.toHaveBeenCalled();
    // Still readable: the command is there.
    expect(screen.getByTestId('permission-command').textContent).toBe('npm install stripe');
  });

  it('offers no Undo Always allow on a record', () => {
    conversation(true, <PermissionCard permission={alwaysAllowed()} wsId="ws_1" sesId="ses_1" projectName="clay" agentName="Claude Code" />);
    expect(screen.getByTestId('permission-record-text').tagName).toBe('SPAN');
    expect(screen.queryByRole('button')).toBeNull();
    expect(calls.remove).not.toHaveBeenCalled();
  });

  it('outside it, the same card still answers', () => {
    conversation(false, <PermissionCard permission={pending()} wsId="ws_1" sesId="ses_1" projectName="clay" agentName="Claude Code" />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(calls.decide).toHaveBeenCalledWith('ws_1', 'ses_1', 'preq_1', { decision: 'allow_once' });
  });
});
