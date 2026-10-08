/**
 * The outbound Jira site URL guard (epic 18 story 3; CAP-26, AD-27, AD-29;
 * the architecture security review's finding 2). Ogden's server calls out
 * to a user-typed Jira site on a recurring, unattended, credentialed basis
 * (a 5-minute poll, AD-27), so the address is checked before it is ever
 * used, not only once at link time.
 *
 * Built on the same resolve-once-connect-to-that-address architecture
 * `notify-webhook` already uses (`packages/adapters/src/notify-webhook/index.ts`):
 * a hostname is resolved exactly once, every address it has is checked, and
 * the one request that follows connects to the checked address, so a DNS
 * answer that changes between the check and the connect (rebinding) can
 * never bypass the check. The policy here is the opposite of
 * `notify-webhook`'s, by design: a notification webhook *allows* loopback
 * and private addresses ("a notification app on the user's own network is
 * the point"); Jira never should, because the resolved host also receives
 * the stored API token on every poll. This guard therefore also blocks
 * loopback and private-range addresses that `notify-webhook` deliberately
 * allows, on top of the link-local, metadata, and reserved ranges both
 * guards refuse.
 *
 * `https:` only, always: unlike `notify-webhook`'s "http to this computer
 * only" exception, there is no loopback exception here — a Jira site is
 * never this computer, so there is nothing plain `http:` could legitimately
 * reach.
 */
import { isIP } from 'node:net';
import { CoreError } from './errors.js';

/** Why a site URL (or its resolved address) was refused: see the exported checks below for which case applies. */
export type JiraUrlRejectionReason = 'empty' | 'invalid' | 'scheme' | 'credentials' | 'extras' | 'blocked_address' | 'no_address' | 'redirect' | 'timeout' | 'network';

const REASON_WORDS: Readonly<Record<JiraUrlRejectionReason, string>> = {
  empty: 'Enter the Jira site address.',
  invalid: "That doesn't look like a web address.",
  scheme: 'Jira must be reached over https.',
  credentials: 'The address must not contain a username or password.',
  extras: 'Remove anything after the address itself.',
  blocked_address: 'That address cannot be used: it resolves to this computer or a private network, never a public Jira site.',
  no_address: "That address couldn't be resolved.",
  redirect: 'That address redirected to another one; Jira must be reached directly.',
  timeout: "Jira didn't answer in time.",
  network: "Jira couldn't be reached.",
};

export function jiraUrlRejectionMessage(reason: JiraUrlRejectionReason): string {
  return REASON_WORDS[reason];
}

/** A site URL rejected before any request was made (the guard itself), as opposed to a network-level failure. */
export class JiraUrlRejectedError extends CoreError {
  override readonly name = 'JiraUrlRejectedError';
  constructor(readonly reason: JiraUrlRejectionReason) {
    super('jira_url_rejected', jiraUrlRejectionMessage(reason));
  }
}

/** One address a hostname resolved to. */
export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Looks up every address a hostname has. Default: the OS resolver (through the injected `lookupHost`, so tests never touch the network). */
export type JiraHostLookup = (host: string) => Promise<ResolvedAddress[]>;

function ipv4Parts(address: string): [number, number, number, number] | undefined {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? (parts as [number, number, number, number]) : undefined;
}

/** The IPv6 address as eight 16-bit groups, `::` expanded, a trailing dotted IPv4 folded in. `undefined` for anything this parser can't read (treated as blocked: an address that can't be classified is never trusted). */
function ipv6Groups(address: string): number[] | undefined {
  let text = address.toLowerCase().split('%')[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (dotted !== undefined) {
    const v4 = ipv4Parts(dotted);
    if (v4 === undefined) return undefined;
    text = `${text.slice(0, -dotted.length)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] === '' ? [] : halves[0]!.split(':');
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : [];
  if (halves.length === 1 && head.length !== 8) return undefined;
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 2 && fill < 1)) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail].map((group) => parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : undefined;
}

/** Whether `address` (an IPv4 literal) is loopback, private, link-local, shared/CGNAT, "this network", multicast, reserved, or a known cloud metadata address. An address that can't be read as IPv4 is handled by the caller. */
function isBlockedIpv4(address: string): boolean {
  const parts = ipv4Parts(address);
  if (parts === undefined) return true;
  const [a, b] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // shared address space / CGNAT (also where some cloud metadata sits)
  if (a === 169 && b === 254) return true; // link-local, including 169.254.169.254 (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 0 && parts[2] === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && parts[2] === 2) return true; // documentation (TEST-NET-1)
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // documentation (TEST-NET-2)
  if (a === 203 && b === 0 && parts[2] === 113) return true; // documentation (TEST-NET-3)
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** Whether `address` (an IPv6 literal) is loopback, unique-local/private, link-local, unspecified, multicast, a Teredo tunnel, or embeds an IPv4 address this function would block. */
function isBlockedIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (groups === undefined) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];
  if (groups.every((group) => group === 0)) return true; // `::` (unspecified) and `::1` is handled next (they differ only in g7)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1 loopback
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  const embedded = (hi: number, lo: number) => isBlockedIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96): judged by the address inside.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return embedded(g6, g7);
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return embedded(g6, g7);
  if (g0 === 0x2002) return embedded(g1, g2); // 6to4: judged by the address inside
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo: refused whole
  return false;
}

/** Whether `address` (either family) must never be reached: see {@link isBlockedIpv4} and {@link isBlockedIpv6}. An address that can't be read as either is treated as blocked. */
export function isBlockedJiraAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

export interface CheckedJiraUrl {
  /** The cleaned URL, scheme and host lower-cased, no trailing slash on the path. */
  url: string;
  host: string;
  /** Every address the host resolved to, each already checked against {@link isBlockedJiraAddress}. */
  addresses: readonly ResolvedAddress[];
}

/**
 * Resolves and checks a Jira site URL: `https:` only, no embedded
 * credentials, no query or fragment, and every resolved address must be a
 * public one (not loopback, link-local, private-range, or a known cloud
 * metadata address). Rejects with {@link JiraUrlRejectedError}. Call this
 * again before every scheduled or Refresh-triggered poll (AD-27), not only
 * once at link time: a DNS answer can change after linking.
 */
export async function checkJiraSiteUrl(input: string, lookup: JiraHostLookup): Promise<CheckedJiraUrl> {
  const text = input.trim();
  if (text === '') throw new JiraUrlRejectedError('empty');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new JiraUrlRejectedError('invalid');
  }
  if (url.protocol !== 'https:') throw new JiraUrlRejectedError('scheme');
  if (url.username !== '' || url.password !== '') throw new JiraUrlRejectedError('credentials');
  if (url.search !== '' || url.hash !== '') throw new JiraUrlRejectedError('extras');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: ResolvedAddress[];
  try {
    addresses = isIP(host) === 0 ? await lookup(host) : [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
  } catch {
    throw new JiraUrlRejectedError('network');
  }
  if (addresses.length === 0) throw new JiraUrlRejectedError('no_address');
  // Every address it has: a name with one good and one blocked address is refused, never half trusted.
  if (addresses.some((entry) => isBlockedJiraAddress(entry.address))) throw new JiraUrlRejectedError('blocked_address');
  const path = url.pathname.replace(/\/+$/, '');
  return { url: `https://${url.host.toLowerCase()}${path}`, host: url.host.toLowerCase(), addresses };
}
