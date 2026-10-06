import { describe, expect, it } from 'vitest';
import { AddLocalEndpointRequest, endpointKeyName, readEndpointAddress, remoteConfirmationWords, UpdateLocalEndpointRequest } from '../src/index.js';

describe('reading an endpoint address (epic 14 story 14.3)', () => {
  it.each(['http://localhost:1234/v1', 'http://127.0.0.1:11434/v1', 'http://127.1:8080/v1', 'http://[::1]:1234/v1', 'http://LOCALHOST/v1', 'http://2130706433/v1'])('%s is this computer', (address) => {
    const read = readEndpointAddress(address);
    expect(read).toMatchObject({ ok: true, loopback: true, insecureRemote: false });
  });

  it.each([
    'http://192.168.1.20:8000/v1',
    'http://10.0.0.5/v1',
    'https://api.example.com/v1',
    'http://localhost.evil.com/v1',
    'http://foo.localhost:1234/v1',
    'http://0.0.0.0:1234/v1',
    'http://[::ffff:127.0.0.1]:1234/v1',
    'http://127.0.0.1.nip.io/v1',
    'http://my-server.lan:1234/v1',
    'http://localhost./v1',
  ])('%s is another host', (address) => {
    expect(readEndpointAddress(address)).toMatchObject({ ok: true, loopback: false });
  });

  it('warns about plain http to another host only', () => {
    expect(readEndpointAddress('http://192.168.1.20:8000/v1')).toMatchObject({ insecureRemote: true });
    expect(readEndpointAddress('https://api.example.com/v1')).toMatchObject({ insecureRemote: false });
    expect(readEndpointAddress('http://localhost:1234/v1')).toMatchObject({ insecureRemote: false });
  });

  it('cleans the address: lower-case host, no trailing slash, its host and port kept for the confirmation', () => {
    expect(readEndpointAddress('  HTTP://Example.COM:8443/v1/  ')).toMatchObject({ ok: true, url: 'http://example.com:8443/v1', host: 'http://example.com:8443' });
    expect(readEndpointAddress('http://localhost:1234')).toMatchObject({ url: 'http://localhost:1234', host: 'http://localhost:1234' });
  });

  it.each([
    ['', 'empty'],
    ['not a url', 'invalid'],
    ['ftp://localhost/v1', 'scheme'],
    ['http://user:pass@localhost:1234/v1', 'credentials'],
    ['http://user@localhost:1234/v1', 'credentials'],
    ['http://localhost:1234/v1?key=abc', 'extras'],
    ['http://localhost:1234/v1#x', 'extras'],
    ['http://localhost:1234/v1?', 'extras'],
    [`http://localhost/${'a'.repeat(2100)}`, 'tooLong'],
  ])('refuses %j', (address, problem) => {
    const read = readEndpointAddress(address);
    expect(read).toMatchObject({ ok: false, problem });
    // Plain words, never the address, and no dash.
    expect(JSON.stringify(read)).not.toMatch(/pass:|user@/);
    expect((read as { reason: string }).reason).not.toMatch(/—|–/);
  });
});

describe('the endpoint requests', () => {
  it('accepts a minimal add and refuses an address that cannot be used, an unknown field and an empty key', () => {
    expect(AddLocalEndpointRequest.safeParse({ label: 'My Mac', baseUrl: 'http://localhost:1234/v1' }).success).toBe(true);
    expect(AddLocalEndpointRequest.safeParse({ label: 'x', baseUrl: 'ftp://x' }).success).toBe(false);
    expect(AddLocalEndpointRequest.safeParse({ label: 'x', baseUrl: 'http://localhost/v1', extra: 1 }).success).toBe(false);
    expect(AddLocalEndpointRequest.safeParse({ label: 'x', baseUrl: 'http://localhost/v1', key: '' }).success).toBe(false);
    expect(AddLocalEndpointRequest.safeParse({ label: '  ', baseUrl: 'http://localhost/v1' }).success).toBe(false);
    expect(AddLocalEndpointRequest.safeParse({ label: 'x', baseUrl: 'http://localhost/v1', preset: 'Bad Preset!' }).success).toBe(false);
  });

  it('needs something to change', () => {
    expect(UpdateLocalEndpointRequest.safeParse({}).success).toBe(false);
    expect(UpdateLocalEndpointRequest.safeParse({ model: null }).success).toBe(true);
  });

  it('binds a confirmation to the scheme too: the same name over http and https are different hosts', () => {
    const a = readEndpointAddress('https://a.example.com/v1');
    const b = readEndpointAddress('http://a.example.com/v1');
    expect(a).toMatchObject({ host: 'https://a.example.com' });
    expect(b).toMatchObject({ host: 'http://a.example.com' });
  });

  it('refuses a key with a line break or a hidden character, and trims the ends', () => {
    expect(AddLocalEndpointRequest.safeParse({ label: 'x', baseUrl: 'http://localhost/v1', key: 'abc\ndef' }).success).toBe(false);
    expect(AddLocalEndpointRequest.safeParse({ label: 'x', baseUrl: 'http://localhost/v1', key: 'abc\u0000' }).success).toBe(false);
    const ok = AddLocalEndpointRequest.safeParse({ label: 'x', baseUrl: 'http://localhost/v1', key: '  abc123\n' });
    expect(ok.success && ok.data.key).toBe('abc123');
  });

  it('names the key after the endpoint id', () => {
    expect(endpointKeyName('lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3')).toBe('agent-endpoint-key/lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3');
  });

  it('words the confirmation with the host, warns about plain http, and uses no dash', () => {
    const plain = remoteConfirmationWords('192.168.1.20:8000', true);
    const secure = remoteConfirmationWords('api.example.com', false);
    expect(plain).toContain('192.168.1.20:8000');
    expect(plain).toMatch(/plain http/);
    expect(secure).not.toMatch(/plain http/);
    expect(plain + secure).not.toMatch(/—|–/);
  });
});

describe('the team types (types only; epic 15 builds on them)', () => {
  it('has four roles, an empty roster, and an assignee that is an agent or a model on an endpoint', async () => {
    const { TEAM_ROLES, TeamAssignee, TeamRoster, emptyRoster } = await import('../src/index.js');
    expect(TEAM_ROLES).toEqual(['manager', 'planner', 'worker', 'reviewer']);
    expect(emptyRoster()).toEqual({ manager: null, planner: null, worker: null, reviewer: null });
    expect(TeamAssignee.safeParse({ kind: 'agent', agentId: 'claude-code' }).success).toBe(true);
    expect(TeamAssignee.safeParse({ kind: 'model', endpointId: 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3', model: 'qwen:7b' }).success).toBe(true);
    expect(TeamAssignee.safeParse({ kind: 'model', endpointId: 'nonsense', model: 'm' }).success).toBe(false);
    expect(TeamRoster.safeParse({ worker: { kind: 'agent', agentId: 'x' } }).success).toBe(true);
  });
});
