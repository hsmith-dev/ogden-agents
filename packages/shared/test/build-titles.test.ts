/**
 * Plain titles (26.6, E26-R6): a build session is named "Build 1.2: <ticket
 * title>" when core creates it; one named before by its first prompt (the
 * build skill's command) shows "Build 1.2", read-side only; a user's own
 * name still wins. The review page's tab reads "Review 1.2".
 */
import { describe, expect, it } from 'vitest';
import { buildSessionTitle, CHAT_NAME_MAX, chatName, reviewTabLabel } from '../src/index.js';

describe('build session titles', () => {
  it('a new build is named by its ticket ref and title', () => {
    expect(buildSessionTitle('1.2', 'Deposit checkout')).toBe('Build 1.2: Deposit checkout');
    expect(chatName({ title: null, autoTitle: buildSessionTitle('1.2', 'Deposit checkout') })).toBe('Build 1.2: Deposit checkout');
  });

  it('a ticket with no title is named by its ref alone', () => {
    expect(buildSessionTitle('1.2')).toBe('Build 1.2');
    expect(buildSessionTitle('1.2', null)).toBe('Build 1.2');
    expect(buildSessionTitle('1.2', '   ')).toBe('Build 1.2');
  });

  it('a long title is cut at a word, to the stored length, on one line', () => {
    const name = buildSessionTitle('1.2', 'word '.repeat(40));
    expect(name.startsWith('Build 1.2: word')).toBe(true);
    expect([...name].length).toBeLessThanOrEqual(CHAT_NAME_MAX);
    expect(buildSessionTitle('1.2', 'Two\nlines')).toBe('Build 1.2: Two lines');
  });

  it('an old build session named by the slash command shows "Build 1.2"', () => {
    const session = { title: null, autoTitle: '/bmad-build-auto ticket 1.2' };
    expect(chatName(session)).toBe('Build 1.2');
    expect(session.autoTitle).toBe('/bmad-build-auto ticket 1.2');
  });

  it('an old Codex build session with a note shows "Build 1.2"', () => {
    expect(chatName({ title: null, autoTitle: '$bmad-build-auto ticket 1.2 A note for the build…' })).toBe('Build 1.2');
    expect(chatName({ autoTitle: '/bmad-build-auto ticket 26.6-plain' })).toBe('Build 26.6-plain');
  });

  it('a renamed build keeps the user name', () => {
    expect(chatName({ title: 'Mine', autoTitle: '/bmad-build-auto ticket 1.2' })).toBe('Mine');
  });

  it('other automatic names are untouched', () => {
    expect(chatName({ title: null, autoTitle: 'Tell me about /bmad-build-auto ticket 1.2' })).toBe('Tell me about /bmad-build-auto ticket 1.2');
    expect(chatName({ title: null, autoTitle: '/bmad-build-autox ticket 1.2' })).toBe('/bmad-build-autox ticket 1.2');
  });

  it('the review page tab names its ticket', () => {
    expect(reviewTabLabel('1.2')).toBe('Review 1.2');
  });
});
