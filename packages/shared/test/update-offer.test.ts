/** Which newer version a running version is told about (story 13.7). */
import { describe, expect, it } from 'vitest';
import { channelOf, decideUpdate } from '../src/semver.js';

describe('decideUpdate', () => {
  it.each([
    ['0.4.0', { latest: '0.5.0' }, { version: '0.5.0', tag: 'latest' }],
    ['0.5.0', { latest: '0.5.0' }, null],
    ['0.5.0', { latest: '0.4.9' }, null],
    ['0.4.0', { latest: '0.4.0', next: '0.5.0-rc.1' }, null],
    ['0.4.0', { next: '0.5.0' }, null],
    ['0.4.0', { latest: '0.5.0-rc.1' }, null],
    ['0.5.0-rc.1', { latest: '0.5.0', next: '0.5.0-rc.2' }, { version: '0.5.0', tag: 'latest' }],
    ['0.5.0-rc.1', { latest: '0.4.0', next: '0.5.0-rc.2' }, { version: '0.5.0-rc.2', tag: 'next' }],
    ['0.5.0-rc.2', { latest: '0.4.0', next: '0.5.0-rc.2' }, null],
    ['0.5.0-rc.2', { latest: '0.4.0', next: '0.5.0-rc.1' }, null],
    ['0.5.0-rc.1', { latest: '0.6.0', next: '0.7.0-rc.1' }, { version: '0.7.0-rc.1', tag: 'next' }],
    ['0.5.0-rc.1', { latest: 'garbage', next: '0.5.0-rc.2' }, { version: '0.5.0-rc.2', tag: 'next' }],
    ['not a version', { latest: '9.9.9' }, null],
    ['0.4.0', {}, null],
  ])('%s with %j offers %j', (current, tags, expected) => {
    expect(decideUpdate(current, tags)).toEqual(expected === null ? null : { ...expected, source: 'npm' });
    // The source is only a label on the offer.
    expect(decideUpdate(current, tags, 'github-releases')).toEqual(expected === null ? null : { ...expected, source: 'github-releases' });
  });

  it('names the channel', () => {
    expect([channelOf('0.5.0'), channelOf('0.5.0-rc.1'), channelOf('x')]).toEqual(['stable', 'preview', undefined]);
  });
});
