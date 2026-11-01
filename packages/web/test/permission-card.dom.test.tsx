// @vitest-environment happy-dom
/**
 * The permission card's Always allow scope in a DOM (AD-40, epic 26 story 8):
 * for a command, a choice of two (the exact command, selected by default, and
 * commands starting with Ogden's prefix); arrow keys move within it and `2`
 * saves the selected one, sending only the choice. A refusal the server sent
 * is shown instead. The REST call is replaced.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptPermission } from '../src/chat/transcript';
import { PermissionCard } from '../src/permissions/permission-card';

const sent = vi.hoisted(() => ({ bodies: [] as unknown[] }));
vi.mock('@/chat/chat-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  decidePermission: async (_wsId: string, _sesId: string, _requestId: string, body: unknown) => {
    sent.bodies.push(body);
  },
}));

afterEach(cleanup);
beforeEach(() => {
  sent.bodies = [];
});

const pending = (overrides: Partial<TranscriptPermission> = {}): TranscriptPermission => ({
  requestId: 'preq_1',
  toolCall: { toolCallId: 't1', title: 'Run npm test -- cart', kind: 'execute', command: 'npm test -- cart' },
  scope: { kind: 'command_exact', value: 'npm test -- cart', label: 'npm test -- cart' },
  prefixScope: { kind: 'command_prefix', value: 'npm test', label: 'npm test' },
  cautionLevel: 'ask_every_time',
  requestedAt: '2026-10-31T12:00:00.000Z',
  status: 'pending',
  resolution: undefined,
  ...overrides,
});

const mount = (permission: TranscriptPermission) =>
  render(<PermissionCard permission={permission} wsId="ws_1" sesId="ses_1" projectName="shop-frontend" agentName="Claude Code" />);

describe('Always allow by how a command starts (AD-40)', () => {
  it('offers the exact command, selected, and the prefix second', () => {
    mount(pending());
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.closest('[data-slot="radio-group-option"]')?.textContent)).toEqual([
      'Exactly npm test -- cart in shop-frontend',
      'Commands starting with npm test in shop-frontend',
    ]);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(screen.getByRole('radiogroup', { name: 'What Always allow covers' })).not.toBeNull();
  });

  it('2 without changing the choice saves the current scope', async () => {
    mount(pending());
    fireEvent.keyDown(screen.getByTestId('permission-card'), { key: '2' });
    await waitFor(() => expect(sent.bodies).toEqual([{ decision: 'allow_always', scope: 'current' }]));
  });

  it('arrow keys move within the choice, and 2 saves the selected prefix', async () => {
    mount(pending());
    const [current] = screen.getAllByRole('radio');
    current!.focus();
    fireEvent.keyDown(current!, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getAllByRole('radio')[1]!.getAttribute('aria-checked')).toBe('true'));
    fireEvent.keyDown(document.activeElement ?? screen.getByTestId('permission-card'), { key: '2' });
    await waitFor(() => expect(sent.bodies).toEqual([{ decision: 'allow_always', scope: 'prefix' }]));
  });

  it('clicking the prefix, then Always allow, saves the prefix; Allow once sends no scope', async () => {
    mount(pending());
    fireEvent.click(screen.getAllByRole('radio')[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Always allow' }));
    await waitFor(() => expect(sent.bodies).toEqual([{ decision: 'allow_always', scope: 'prefix' }]));
    cleanup();
    mount(pending());
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(sent.bodies.at(-1)).toEqual({ decision: 'allow_once' }));
  });

  it('without a prefix scope the card writes the one scope and sends no choice', async () => {
    mount(pending({ prefixScope: undefined, toolCall: { toolCallId: 't1', title: 'Run sed -n 1p a', kind: 'execute', command: 'sed -n 1p a' }, scope: { kind: 'command_exact', value: 'sed -n 1p a', label: 'sed -n 1p a' } }));
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByTestId('permission-scope').textContent).toBe('Exactly sed -n 1p a in shop-frontend');
    fireEvent.keyDown(screen.getByTestId('permission-card'), { key: '2' });
    await waitFor(() => expect(sent.bodies).toEqual([{ decision: 'allow_always' }]));
  });

  it("shows the server's refusal and offers no Always allow; 2 does nothing", async () => {
    const refusal = "Always allow isn't offered for this command, because it runs more than one thing.";
    mount(pending({ toolCall: { toolCallId: 't1', title: 'Run it', kind: 'execute', command: 'npm test && npm run deploy' }, scope: null, prefixScope: undefined, refusal }));
    expect(screen.queryByRole('button', { name: 'Always allow' })).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByTestId('permission-scope').textContent).toBe(refusal);
    fireEvent.keyDown(screen.getByTestId('permission-card'), { key: '2' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.bodies).toEqual([]);
  });

  it('the record line says what a prefix rule covers', () => {
    const at = '2026-10-31T12:01:00.000Z';
    mount(pending({ status: 'resolved', resolution: { decision: 'allow_always', by: 'user', reason: undefined, ruleId: 'rule_1', scope: { kind: 'command_prefix', value: 'npm test', label: 'npm test' }, ruleRemoved: false, at } }));
    expect(screen.getByTestId('permission-record-text').textContent).toBe('Always allowed: commands starting with npm test');
    cleanup();
    mount(pending({ status: 'resolved', resolution: { decision: 'allow_always', by: 'user', reason: undefined, ruleId: 'rule_2', scope: { kind: 'command_exact', value: 'npm test -- cart', label: 'npm test -- cart' }, ruleRemoved: false, at } }));
    expect(screen.getByTestId('permission-record-text').textContent).toBe('Always allowed: npm test -- cart');
  });
});
