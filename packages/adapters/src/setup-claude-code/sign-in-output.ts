/**
 * Reading the sign-in URL from what the login prints into its hidden
 * terminal (story 9.1). The output is colored and its link is an OSC 8
 * hyperlink, so escape sequences are stripped first. Only an `https:` URL on
 * an allowed host is taken. The output itself is never logged (AD-16).
 */

/** Hosts (and their subdomains) a sign-in URL may be on. */
export const DEFAULT_SIGN_IN_HOSTS: readonly string[] = Object.freeze(['claude.ai', 'claude.com', 'anthropic.com']);

const ESC = '\u001b';
/** OSC (`ESC ]` … BEL or ST), including OSC 8 hyperlinks: the whole sequence, parameters and all. */
const OSC = new RegExp(`${ESC}\\][^\\u0007\\u001b]*(?:\\u0007|${ESC}\\\\)`, 'g');
/** OSC 8 hyperlink openings: the URL they point at. */
const OSC8_TARGET = new RegExp(`${ESC}\\]8;[^;\\u0007\\u001b]*;([^\\u0007\\u001b]*)(?:\\u0007|${ESC}\\\\)`, 'g');
/** CSI (`ESC [` … final byte), such as colors and cursor moves. */
const CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
/** Any other two-byte escape, then a lone ESC left by a split sequence. */
const OTHER_ESCAPE = new RegExp(`${ESC}[@-Z\\\\-_]|${ESC}`, 'g');
/** C0 controls other than tab, line feed and carriage return, and DEL. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** `text` without terminal escape sequences or control characters. */
export function stripTerminalEscapes(text: string): string {
  return text.replace(OSC, '').replace(CSI, '').replace(OTHER_ESCAPE, '').replace(CONTROL, '');
}

const URL_IN_TEXT = /https:\/\/[^\s"'<>`]+/g;

/** Whether `candidate` is an `https:` URL with no credentials on one of `hosts` or a subdomain of one. */
export function isAllowedSignInUrl(candidate: string, hosts: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  // No credentials and no explicit port: only the hosts' standard https service.
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return false;
  const host = url.hostname.toLowerCase();
  return hosts.some((allowed) => {
    const want = allowed.toLowerCase();
    return host === want || host.endsWith(`.${want}`);
  });
}

/**
 * The first allowed sign-in URL in `output`: an OSC 8 link target first,
 * then a URL in the visible text that something follows (so a URL split
 * across two reads is never taken half-way). `undefined` when there is none yet.
 */
export function findSignInUrl(output: string, hosts: readonly string[] = DEFAULT_SIGN_IN_HOSTS): string | undefined {
  const candidates: string[] = [];
  for (const match of output.matchAll(OSC8_TARGET)) if (match[1] !== undefined && match[1] !== '') candidates.push(match[1]);
  const visible = stripTerminalEscapes(output);
  for (const match of visible.matchAll(URL_IN_TEXT)) {
    // A URL running to the end of the output so far may still be arriving.
    if (match.index + match[0].length >= visible.length) continue;
    candidates.push(match[0].replace(/[.,;:)\]}]+$/, ''));
  }
  const found = candidates.find((candidate) => isAllowedSignInUrl(candidate, hosts));
  return found === undefined ? undefined : new URL(found).href;
}
