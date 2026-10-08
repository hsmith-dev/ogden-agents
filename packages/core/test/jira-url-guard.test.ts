/**
 * The outbound Jira site URL guard (epic 18 story 3; CAP-26, AD-27, AD-29):
 * https-only, no redirect, every resolved address checked and never
 * loopback, link-local, private-range or a known cloud metadata address. No
 * test reaches the real network: `lookup` is always a fake.
 */
import { describe, expect, it } from 'vitest';
import { checkJiraSiteUrl, isBlockedJiraAddress, JiraUrlRejectedError, type ResolvedAddress } from '../src/index.js';

const lookupOf = (addresses: ResolvedAddress[]) => async () => addresses;
const realPublicV4: ResolvedAddress = { address: '8.8.8.8', family: 4 };

describe('checkJiraSiteUrl', () => {
  it('accepts a public https host and cleans the URL', async () => {
    const checked = await checkJiraSiteUrl('https://My-Team.Atlassian.net/', lookupOf([realPublicV4]));
    expect(checked).toEqual({ url: 'https://my-team.atlassian.net', host: 'my-team.atlassian.net', addresses: [realPublicV4] });
  });

  it('rejects a plain http address outright, with no loopback exception', async () => {
    await expect(checkJiraSiteUrl('http://my-team.atlassian.net', lookupOf([realPublicV4]))).rejects.toMatchObject({ reason: 'scheme' });
  });

  it('rejects an address with embedded credentials', async () => {
    await expect(checkJiraSiteUrl('https://user:pass@my-team.atlassian.net', lookupOf([realPublicV4]))).rejects.toMatchObject({ reason: 'credentials' });
  });

  it('rejects a query string or fragment', async () => {
    await expect(checkJiraSiteUrl('https://my-team.atlassian.net/?x=1', lookupOf([realPublicV4]))).rejects.toMatchObject({ reason: 'extras' });
  });

  it('rejects empty input', async () => {
    await expect(checkJiraSiteUrl('   ', lookupOf([realPublicV4]))).rejects.toMatchObject({ reason: 'empty' });
  });

  it('rejects unparsable input', async () => {
    await expect(checkJiraSiteUrl('not a url', lookupOf([realPublicV4]))).rejects.toMatchObject({ reason: 'invalid' });
  });

  it.each([
    ['loopback v4', '127.0.0.1'],
    ['loopback v6', '::1'],
    ['link-local / cloud metadata v4', '169.254.169.254'],
    ['link-local v6', 'fe80::1'],
    ['RFC1918 10/8', '10.1.2.3'],
    ['RFC1918 172.16/12', '172.16.0.5'],
    ['RFC1918 192.168/16', '192.168.1.1'],
    ['unique-local v6', 'fc00::1'],
    ['this network', '0.0.0.1'],
    ['shared address space / CGNAT', '100.64.0.1'],
    ['multicast/reserved', '224.0.0.1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['NAT64-embedded private', '64:ff9b::a00:1'],
    ['Teredo', '2001:0:1::1'],
  ])('rejects a hostname resolving to a %s address (%s)', async (_label, address) => {
    const family: 4 | 6 = address.includes(':') ? 6 : 4;
    await expect(checkJiraSiteUrl('https://sneaky.example.com', lookupOf([{ address, family }]))).rejects.toMatchObject({ reason: 'blocked_address' });
  });

  it('rejects when any resolved address is blocked, even if another is public (never half-trusted)', async () => {
    await expect(checkJiraSiteUrl('https://multi.example.com', lookupOf([realPublicV4, { address: '127.0.0.1', family: 4 }]))).rejects.toMatchObject({ reason: 'blocked_address' });
  });

  it('rejects when the host has no address at all', async () => {
    await expect(checkJiraSiteUrl('https://nowhere.example.com', lookupOf([]))).rejects.toMatchObject({ reason: 'no_address' });
  });

  it('rejects when the lookup itself fails', async () => {
    await expect(
      checkJiraSiteUrl('https://nowhere.example.com', async () => {
        throw new Error('ENOTFOUND');
      }),
    ).rejects.toMatchObject({ reason: 'network' });
  });

  it('accepts an IPv4 literal host directly (no lookup call) when it is public', async () => {
    let called = false;
    const checked = await checkJiraSiteUrl('https://8.8.8.8', async () => {
      called = true;
      return [];
    });
    expect(called).toBe(false);
    expect(checked.host).toBe('8.8.8.8');
  });

  it('rejects an IPv4 literal host directly when it is private, with no lookup call', async () => {
    await expect(checkJiraSiteUrl('https://192.168.1.1', lookupOf([]))).rejects.toMatchObject({ reason: 'blocked_address' });
  });

  it('is a JiraUrlRejectedError with a plain message', async () => {
    const error = await checkJiraSiteUrl('http://x.example.com', lookupOf([realPublicV4])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JiraUrlRejectedError);
    expect((error as Error).message).toBe('Jira must be reached over https.');
  });
});

describe('isBlockedJiraAddress', () => {
  it('treats an address that cannot be parsed as either family as blocked', () => {
    expect(isBlockedJiraAddress('not-an-address')).toBe(true);
  });

  it('allows an ordinary public address', () => {
    expect(isBlockedJiraAddress(realPublicV4.address)).toBe(false);
    expect(isBlockedJiraAddress('2606:4700:4700::1111')).toBe(false); // a real public IPv6 (Cloudflare) shape
  });
});
