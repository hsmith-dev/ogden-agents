/**
 * The one safe error-code reader (story 9.6): a short identifier from
 * `code`, or the caller's fallback; never anything from the message.
 */
import { describe, expect, it } from 'vitest';
import { errorCode } from '../src/error-code.js';

describe('errorCode', () => {
  it('passes a short identifier through', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'ENOENT' }), 'unknown')).toBe('ENOENT');
    expect(errorCode({ code: 'GenericFailure' }, 'keychain_error')).toBe('GenericFailure');
    expect(errorCode({ code: 'agent_unavailable' }, 'unknown')).toBe('agent_unavailable');
  });

  it('answers the fallback for anything else, never the message', () => {
    for (const error of [undefined, null, 'ENOENT', 42, {}, { code: 7 }, { code: '' }, { code: 'spawn /home/me/node ENOENT' }, { code: 'x'.repeat(41) }, new Error('ENOENT')]) {
      expect(errorCode(error, 'fallback')).toBe('fallback');
    }
  });
});
