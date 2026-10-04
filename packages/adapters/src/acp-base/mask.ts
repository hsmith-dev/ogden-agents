/**
 * Masking the agent's secrets in what it prints (AD-16): the values of the
 * secret-looking variables Ogden Agents gave the agent's process never reach
 * an event, a log line or the UI, even when the agent echoes them.
 */

/** Environment variable names whose values are secrets. */
export const SECRET_ENV_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;

/** What a masked secret becomes. */
export const MASKED = '[redacted]';

/** Values shorter than this are not masked: they would mask ordinary text. */
const MIN_SECRET_LENGTH = 4;

/** The secret values in `env`, longest first. */
export function secretValues(env: Readonly<Record<string, string | undefined>>): string[] {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && value.length >= MIN_SECRET_LENGTH && SECRET_ENV_NAME.test(name)) values.add(value);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

/** `text` with every occurrence of every secret replaced by {@link MASKED}. */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join(MASKED);
  return out;
}

/**
 * Masks a stream of chunks, where a secret may be split across chunks: the
 * end of a chunk that could be the start of a secret is held back until the
 * next chunk (or {@link flush}) shows whether it is.
 */
export function createStreamMasker(secrets: readonly string[]) {
  let pending = '';
  return {
    push(chunk: string): string {
      const buffer = pending + chunk;
      let hold = 0;
      for (const secret of secrets) {
        for (let k = Math.min(secret.length - 1, buffer.length); k > hold; k--) {
          if (buffer.endsWith(secret.slice(0, k))) {
            hold = k;
            break;
          }
        }
      }
      // Never cut through a whole secret either: hold it back with the rest.
      let cut = buffer.length - hold;
      for (let moved = true; moved; ) {
        moved = false;
        for (const secret of secrets) {
          for (let at = buffer.indexOf(secret); at !== -1 && at < cut; at = buffer.indexOf(secret, at + 1)) {
            if (at + secret.length > cut) {
              cut = at;
              moved = true;
            }
          }
        }
      }
      pending = buffer.slice(cut);
      return maskSecrets(buffer.slice(0, cut), secrets);
    },
    flush(): string {
      const rest = maskSecrets(pending, secrets);
      pending = '';
      return rest;
    },
  };
}
