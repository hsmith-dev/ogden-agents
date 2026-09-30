import { WS_PROTOCOL } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { bearerToken, chooseWebSocketProtocol, createTabTokens, TAB_TOKEN_IDLE_TTL_MS, webSocketToken } from '../src/auth.js';

function manualClock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('tab tokens', () => {
  it('are random, 256-bit, base64url, and valid only as minted', () => {
    const tabs = createTabTokens();
    const a = tabs.mint();
    const b = tabs.mint();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(tabs.verify(a)).toBe(true);
    expect(tabs.verify(b)).toBe(true);
    expect(tabs.verify(undefined)).toBe(false);
    expect(tabs.verify('')).toBe(false);
    expect(tabs.verify(`${a.slice(0, -1)}${a.endsWith('A') ? 'B' : 'A'}`)).toBe(false);
    expect(tabs.verify(createTabTokens().mint())).toBe(false);
  });

  it('expire after 12 hours unused; a use restarts the clock; a hold keeps them until released', () => {
    const clock = manualClock();
    const tabs = createTabTokens(clock.now);
    const idle = tabs.mint();
    const used = tabs.mint();
    const held = tabs.mint();
    const release = tabs.hold(held)!;
    clock.advance(TAB_TOKEN_IDLE_TTL_MS - 1);
    expect(tabs.verify(used)).toBe(true);
    clock.advance(1);
    expect(tabs.verify(idle)).toBe(false);
    expect(tabs.size()).toBe(2);
    clock.advance(TAB_TOKEN_IDLE_TTL_MS * 3);
    expect(tabs.verify(held)).toBe(true);
    expect(tabs.verify(used)).toBe(false);
    release();
    release(); // A second release changes nothing.
    clock.advance(TAB_TOKEN_IDLE_TTL_MS - 1);
    expect(tabs.size()).toBe(1);
    clock.advance(1);
    expect(tabs.verify(held)).toBe(false);
    expect(tabs.hold(held)).toBeUndefined();
    expect(tabs.size()).toBe(0);
  });
});

describe('reading the token from a request', () => {
  it('Authorization: only a well-formed Bearer header', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer abc')).toBe('abc');
    for (const header of [undefined, '', 'Bearer', 'Bearer ', 'Basic abc', 'abc', 'Bearer a b']) {
      expect(bearerToken(header), String(header)).toBeUndefined();
    }
  });

  it('Sec-WebSocket-Protocol: ogden.v1 plus exactly one ogden.auth.<token>', () => {
    expect(webSocketToken(`${WS_PROTOCOL}, ogden.auth.abc`)).toBe('abc');
    expect(webSocketToken(`ogden.auth.abc,${WS_PROTOCOL}`)).toBe('abc');
    for (const header of [undefined, '', WS_PROTOCOL, 'ogden.auth.abc', `${WS_PROTOCOL}, ogden.auth.`, `${WS_PROTOCOL}, ogden.auth.a, ogden.auth.b`]) {
      expect(webSocketToken(header), String(header)).toBeUndefined();
    }
  });

  it('the server echoes only ogden.v1, never the offer that carries the token', () => {
    expect(chooseWebSocketProtocol(new Set(['ogden.auth.abc', WS_PROTOCOL]))).toBe(WS_PROTOCOL);
    expect(chooseWebSocketProtocol(new Set(['ogden.auth.abc']))).toBe(false);
  });
});
