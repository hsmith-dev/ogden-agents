import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createAnnouncer, LiveRegion, nextMessage, openSession, POLITE_INTERVAL_MS, tabTitle } from '../src/shell/live-announcer';

const polite = (sesId: string, text: string) => ({ polite: [{ sesId, text }], assertive: [] });
const request = (id: string, sesId: string, text: string) => ({ polite: [], assertive: [{ id, sesId, text }] });

describe('live announcer (EXPERIENCE.md Accessibility Floor)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => {
    const said = { polite: [] as string[], assertive: [] as string[] };
    const announcer = createAnnouncer({ polite: (text) => said.polite.push(text), assertive: (text) => said.assertive.push(text) });
    return { said, announcer };
  };

  it('a burst of three changes within 5 s is one polite announcement, with the latest state per session', () => {
    const { said, announcer } = setup();
    announcer.announce(polite('ses_b', 'Letterpress: Chat is idle'), undefined);
    vi.advanceTimersByTime(1000);
    announcer.announce(polite('ses_a', 'Clay: Chat is done'), undefined);
    vi.advanceTimersByTime(1000);
    announcer.announce(polite('ses_b', 'Letterpress: Chat is working'), undefined);
    expect(said.polite).toEqual([]);
    vi.advanceTimersByTime(POLITE_INTERVAL_MS - 2000);
    expect(said.polite).toEqual(['Clay: Chat is done. Letterpress: Chat is working']);
    vi.advanceTimersByTime(60_000);
    expect(said.polite).toHaveLength(1);
  });

  it('never more than one polite announcement per 5 s', () => {
    const { said, announcer } = setup();
    for (let i = 0; i < 10; i++) {
      announcer.announce(polite(`ses_${i}`, `change ${i}`), undefined);
      vi.advanceTimersByTime(1000);
    }
    vi.advanceTimersByTime(POLITE_INTERVAL_MS);
    expect(said.polite).toEqual(['change 0. change 1. change 2. change 3. change 4', 'change 5. change 6. change 7. change 8. change 9']);
  });

  it('a new request in another session is announced assertively, once, at once', () => {
    const { said, announcer } = setup();
    announcer.announce(request('req_1', 'ses_b', 'Claude Code is waiting for you: run npm test'), 'ses_a');
    expect(said.assertive).toEqual(['Claude Code is waiting for you: run npm test']);
    announcer.announce(request('req_1', 'ses_b', 'Claude Code is waiting for you: run npm test'), 'ses_a');
    expect(said.assertive).toHaveLength(1);
  });

  it('a new request in the open session stays silent (its page announces the card), even after leaving it', () => {
    const { said, announcer } = setup();
    announcer.announce(request('req_1', 'ses_b', 'Claude Code is waiting for you: run npm test'), 'ses_b');
    announcer.announce(request('req_1', 'ses_b', 'Claude Code is waiting for you: run npm test'), undefined);
    expect(said.assertive).toEqual([]);
  });

  it('the chat on screen stays silent in the polite region too; others are still said', () => {
    const { said, announcer } = setup();
    announcer.announce({ polite: [{ sesId: 'ses_open', text: 'A: Chat is idle' }, { sesId: 'ses_b', text: 'B: Chat is working' }], assertive: [] }, 'ses_open');
    vi.advanceTimersByTime(POLITE_INTERVAL_MS);
    expect(said.polite).toEqual(['B: Chat is working']);
  });

  it('the same words twice are said twice: each message is a new keyed node in its region', () => {
    const { said, announcer } = setup();
    announcer.announce(polite('ses_b', 'B: Chat is working'), undefined);
    vi.advanceTimersByTime(POLITE_INTERVAL_MS);
    announcer.announce(polite('ses_b', 'B: Chat is working'), undefined);
    vi.advanceTimersByTime(POLITE_INTERVAL_MS);
    expect(said.polite).toEqual(['B: Chat is working', 'B: Chat is working']);

    const first = nextMessage({ text: '', n: 0 }, 'B: Chat is working');
    const second = nextMessage(first, 'B: Chat is working');
    expect(second.text).toBe(first.text);
    expect(second.n).not.toBe(first.n);
    const child = (message: typeof first) => (LiveRegion({ politeness: 'polite', message }) as ReactElement<{ children: ReactElement }>).props.children;
    expect(child(first).key).not.toBe(child(second).key);
    expect(renderToStaticMarkup(<LiveRegion politeness="assertive" message={second} />)).toBe(
      '<div aria-live="assertive" aria-atomic="true" class="sr-only"><span>B: Chat is working</span></div>',
    );
  });

  it('dispose drops what is queued', () => {
    const { said, announcer } = setup();
    announcer.announce(polite('ses_b', 'Letterpress: Chat is idle'), undefined);
    announcer.dispose();
    vi.advanceTimersByTime(POLITE_INTERVAL_MS * 2);
    expect(said.polite).toEqual([]);
  });
});

describe('tab title and the open session', () => {
  it('prefixes the Needs you count, and is plain at 0', () => {
    expect(tabTitle(1)).toBe('(1) Ogden Agents');
    expect(tabTitle(12)).toBe('(12) Ogden Agents');
    expect(tabTitle(0)).toBe('Ogden Agents');
  });

  it('reads the open session from the path', () => {
    expect(openSession('/w/ws_a/s/ses_b')).toBe('ses_b');
    expect(openSession('/w/ws_a/s/ses_b/')).toBe('ses_b');
    expect(openSession('/w/ws_a')).toBeUndefined();
    expect(openSession('/w/ws_a/settings')).toBeUndefined();
  });
});
