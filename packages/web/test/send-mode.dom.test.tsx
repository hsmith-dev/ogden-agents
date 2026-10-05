// @vitest-environment happy-dom
/**
 * Send now or wait (2026-10-04), in a DOM: the composer's two ways while the
 * agent works (`Enter` the project's choice, `Cmd/Ctrl+Enter` and the menu
 * the other), one way only otherwise, and the list of waiting messages with
 * its keyboard-reachable Edit, Move, Send now and Remove. The REST calls are
 * stand-ins.
 */
import type { WhileWorking } from '@ogden-agents/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../src/chat/composer';
import { QueuedMessages } from '../src/chat/queued-messages';
import type { TranscriptMessage } from '../src/chat/transcript';
import { TooltipProvider } from '../src/ui/tooltip';

const calls = vi.hoisted(() => ({ list: [] as unknown[][] }));
vi.mock('@/chat/send-mode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/chat/send-mode')>()),
  updateQueuedMessage: async (...args: unknown[]) => void calls.list.push(['update', ...args]),
  removeQueuedMessage: async (...args: unknown[]) => void calls.list.push(['remove', ...args]),
  sendQueuedMessageNow: async (...args: unknown[]) => void calls.list.push(['sendNow', ...args]),
}));

afterEach(() => {
  cleanup();
  calls.list = [];
});

function composer(props: { whileWorking?: WhileWorking; working?: boolean }) {
  const sent: Array<[string, WhileWorking | undefined]> = [];
  render(
    <TooltipProvider>
      <Composer label="Message Claude Code" {...props} onSend={async (text, delivery) => void sent.push([text, delivery])} />
    </TooltipProvider>,
  );
  const field = screen.getByRole('textbox', { name: 'Message Claude Code' });
  const type = (text: string) => fireEvent.change(field, { target: { value: text } });
  return { sent, field, type };
}

const flush = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

describe('the composer while the agent works', () => {
  it('sends the default way on Enter and the other way on Cmd or Ctrl+Enter', async () => {
    const { sent, field, type } = composer({ whileWorking: 'wait', working: true });
    type('later is fine');
    fireEvent.keyDown(field, { key: 'Enter' });
    await flush();
    type('now please');
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    await flush();
    type('also now');
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
    await flush();
    expect(sent).toEqual([
      ['later is fine', 'wait'],
      ['now please', 'now'],
      ['also now', 'now'],
    ]);
  });

  it('offers both ways in a menu beside Send, whose trigger is not named Send', async () => {
    const { sent, type } = composer({ whileWorking: 'now', working: true });
    expect(screen.getAllByRole('button', { name: /send/i }).map((button) => button.getAttribute('aria-label'))).toEqual(['Send']);
    type('after it finishes');
    const trigger = screen.getByRole('button', { name: 'Choose when it goes' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const wait = await screen.findByRole('menuitem', { name: /Send after it finishes/ });
    fireEvent.click(wait);
    await flush();
    expect(sent).toEqual([['after it finishes', 'wait']]);
  });

  it('has one way only when the composer is not told the choice', async () => {
    const { sent, field, type } = composer({});
    expect(screen.queryByRole('button', { name: 'Choose when it goes' })).toBeNull();
    type('hello');
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    await flush();
    expect(sent).toEqual([['hello', undefined]]);
  });
});

const waiting = (messageId: string, text: string, now = false): TranscriptMessage => ({ messageId, role: 'user', text, streaming: false, status: 'queued', ...(now ? { now: true } : {}) });

describe('the messages that wait', () => {
  const list = (messages: TranscriptMessage[], options: { blocked?: string; readOnly?: boolean } = {}) => {
    const errors: Array<string | undefined> = [];
    render(<QueuedMessages wsId="ws_1" sesId="ses_1" messages={messages} readOnly={options.readOnly ?? false} sendNowBlockedReason={options.blocked} onError={(message) => errors.push(message)} />);
    return { errors };
  };

  it('is a labelled list whose buttons edit, move, send now and remove each message', async () => {
    list([waiting('m1', 'first'), waiting('m2', 'second')]);
    expect(screen.getByRole('list', { name: 'Messages waiting to be sent' })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]!);
    await flush();
    fireEvent.click(screen.getAllByRole('button', { name: 'Send now' })[1]!);
    await flush();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
    await flush();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]!);
    const field = screen.getByRole('textbox', { name: 'Edit waiting message' });
    fireEvent.change(field, { target: { value: 'second, edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(calls.list).toEqual([
      ['update', 'ws_1', 'ses_1', 'm1', { position: 1 }],
      ['sendNow', 'ws_1', 'ses_1', 'm2'],
      ['remove', 'ws_1', 'ses_1', 'm1'],
      ['update', 'ws_1', 'ses_1', 'm2', { content: 'second, edited' }],
    ]);
  });

  it('says why a message can not go right away while a card waits, and changes nothing', async () => {
    const { errors } = list([waiting('m1', 'first')], { blocked: 'Answer the request above first, then send your message.' });
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await flush();
    expect(calls.list).toEqual([]);
    expect(errors.at(-1)).toBe('Answer the request above first, then send your message.');
  });

  it('shows a message being sent right away as such, and offers nothing while the terminal drives', () => {
    list([waiting('m1', 'urgent', true)], { readOnly: true });
    expect(screen.getByTestId('message-queue-status').textContent).toBe('Sending now');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
