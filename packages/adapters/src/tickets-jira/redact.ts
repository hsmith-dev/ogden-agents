/**
 * Whole-value redaction of a Jira credential (epic 18 story 4; AD-16,
 * AD-29; the architecture security review's finding 1).
 *
 * `packages/shared/src/secret-patterns.ts`'s `redactSecrets` is a
 * *pattern* match: it knows the shapes of Anthropic/OpenAI/GitHub/etc.
 * tokens and masks anything that looks like one. A Jira API token has no
 * such shape — it's an opaque string Atlassian hands out — so a
 * pattern-based redactor would never catch it, and would never catch the
 * account email or site URL at all (they are PII and a low-sensitivity
 * identifier, not token-shaped text).
 *
 * This redactor is the opposite kind: given the *known* values in scope at
 * one call (the token, email, and site URL this specific credential
 * holds), it removes every verbatim occurrence of each of them from a
 * string before it is logged or put in an event payload — a whole-value
 * match, not a shape match. `tickets-jira` calls this on every string it
 * is about to log or emit that could have come from a failed Jira call
 * (an error message, a response body, a URL it attempted), never only on
 * values it expects to be safe.
 */

export const JIRA_REDACTED = '[redacted]';

/** `text` with every verbatim occurrence of each of `values` (skipping empty or very short ones, which would redact too much) replaced by {@link JIRA_REDACTED}. */
export function redactJiraValues(text: string, values: readonly (string | undefined)[]): string {
  let out = text;
  for (const value of values) {
    if (value === undefined || value.length < 3) continue;
    out = out.split(value).join(JIRA_REDACTED);
  }
  return out;
}

/** The three values one linked board's credential ever holds, for {@link redactJiraValues}. */
export interface JiraCredentialValues {
  token: string;
  email: string;
  siteUrl: string;
}

/** Redacts `text` against every value `credential` holds (AD-29: token, email, and site URL are all in scope, together, not the token alone). */
export function redactJiraCredential(text: string, credential: JiraCredentialValues): string {
  return redactJiraValues(text, [credential.token, credential.email, credential.siteUrl]);
}

/**
 * Wraps `fn`: if it throws or rejects with an `Error`, its `message` (and,
 * when present, a plain string `cause`) are redacted against `credential`
 * before the error reaches the caller, so a log statement or an emitted
 * event built from a caught error's `message` can never carry the
 * credential, whatever library produced the error.
 */
export async function withJiraRedaction<T>(credential: JiraCredentialValues, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error) {
      error.message = redactJiraCredential(error.message, credential);
      if (typeof (error as { cause?: unknown }).cause === 'string') {
        (error as { cause?: unknown }).cause = redactJiraCredential((error as { cause: string }).cause, credential);
      }
    }
    throw error;
  }
}
