// @vitest-environment happy-dom
/**
 * The composer keeps unsent text per chat (backlog story 6), in a DOM: a
 * draft follows its key across chats and remounts, a send the server accepts
 * clears it (but not text typed meanwhile), a refused send keeps it, the
 * Not-sent restore is kept, and an emptied field forgets it.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Composer, type ComposerProps } from '../src/chat/composer';
import { readDraft } from '../src/chat/drafts';

const input = () => screen.getByLabelText('Message Claude Code') as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });

function mount(props: Partial<ComposerProps>) {
  const all: ComposerProps = { label: 'Message Claude Code', onSend: async () => undefined, ...props };
  const view = render(<Composer {...all} />);
  return { rerender: (next: Partial<ComposerProps>) => view.rerender(<Composer {...all} {...next} />), unmount: view.unmount };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('composer drafts', () => {
  it('shows each chat its own draft when the page moves between chats', () => {
    const view = mount({ draftKey: 'ws:a' });
    type('for chat a');
    view.rerender({ draftKey: 'ws:b' });
    expect(input().value).toBe('');
    type('for chat b');
    view.rerender({ draftKey: 'ws:a' });
    expect(input().value).toBe('for chat a');
    view.rerender({ draftKey: 'ws:b' });
    expect(input().value).toBe('for chat b');
  });

  it('restores a draft after the composer is mounted again (navigation, reload)', () => {
    const first = mount({ draftKey: 'ws:a' });
    type('half a thought');
    first.unmount();
    mount({ draftKey: 'ws:a' });
    expect(input().value).toBe('half a thought');
  });

  it('keeps nothing without a key', () => {
    const first = mount({});
    type('not kept');
    first.unmount();
    mount({});
    expect(input().value).toBe('');
    expect(window.localStorage.length).toBe(0);
  });

  it('clears the draft once the server accepts the send, keeping text typed meanwhile', async () => {
    const send = deferred();
    mount({ draftKey: 'ws:a', onSend: () => send.promise });
    type('first');
    fireEvent.keyDown(input(), { key: 'Enter' });
    type('first and second');
    await act(async () => send.resolve());
    expect(input().value).toBe('first and second');
    expect(readDraft('ws:a')).toBe('first and second');
  });

  it('clears an accepted send fully, even after the composer has gone (a first chat opens its page)', async () => {
    const send = deferred();
    const view = mount({ draftKey: 'ws:new', onSend: () => send.promise });
    type('start here');
    fireEvent.keyDown(input(), { key: 'Enter' });
    view.unmount();
    await act(async () => send.resolve());
    expect(readDraft('ws:new')).toBe('');
  });

  it('keeps the text and the draft when the send is refused', async () => {
    const send = deferred();
    mount({ draftKey: 'ws:a', onSend: () => send.promise });
    type('try me');
    fireEvent.keyDown(input(), { key: 'Enter' });
    await act(async () => send.reject(new Error('Not now.')));
    expect(input().value).toBe('try me');
    expect(readDraft('ws:a')).toBe('try me');
    expect(screen.getByTestId('composer-error').textContent).toBe('Not now.');
  });

  it('does not clear another chat when a send finishes after the page moved on', async () => {
    const send = deferred();
    const view = mount({ draftKey: 'ws:a', onSend: () => send.promise });
    type('same words');
    fireEvent.keyDown(input(), { key: 'Enter' });
    view.rerender({ draftKey: 'ws:b' });
    type('same words');
    await act(async () => send.resolve());
    expect(input().value).toBe('same words');
    expect(readDraft('ws:b')).toBe('same words');
    expect(readDraft('ws:a')).toBe('');
  });

  it('puts Not-sent text back ahead of the draft, and keeps the result as the draft', () => {
    const view = mount({ draftKey: 'ws:a' });
    type('typed');
    view.rerender({ restore: { key: 'msg_1', text: 'not sent' } });
    expect(input().value).toBe('not sent\n\ntyped');
    expect(readDraft('ws:a')).toBe('not sent\n\ntyped');
  });

  it('forgets the draft when the user empties the field', () => {
    const first = mount({ draftKey: 'ws:a' });
    type('gone soon');
    type('');
    first.unmount();
    mount({ draftKey: 'ws:a' });
    expect(input().value).toBe('');
    expect(window.localStorage.length).toBe(0);
  });
});
