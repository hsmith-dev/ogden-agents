/**
 * A failure's code for the log or a response's details (story 9.6: the one
 * reader the keychain, the API key check and the install share): its `code`
 * when that is a short identifier (`ENOENT`, `GenericFailure`), otherwise
 * `fallback`. Never the message, which can hold paths, keys or anything else.
 */
export function errorCode(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : fallback;
}
