/**
 * The failures a model server has, in plain words (epic 14 story 14.6; E14-R4),
 * read from the text the harness passes through (spike 14.1: `-32603 Internal
 * error: <text>`; the server's own message for most). Each says what to do.
 * Anything not recognised keeps the generic reason: the harness's text is
 * never shown (it may quote the conversation).
 */
export const FAILURE_WORDS = {
  /** The server stopped, or never was reachable. */
  notRunning: "The server stopped answering. Start it again, then send your message again.",
  /** The conversation no longer fits the model's context. */
  contextFull: "This conversation no longer fits in the model's context. Start a new chat, or load the model with a larger context in the server.",
  /** The server has no such model now (unloaded, deleted). */
  modelGone: "The server doesn't have that model right now. Load it in the server, or choose another model, then send your message again.",
  /** No answer in time. */
  timedOut: 'The model took too long to answer. One that is still loading can take a minute, so try again.',
  /** The server refused the key. */
  keyRefused: "The server didn't accept the key. Check it in Settings, Agents.",
} as const;

/** The plain reason for the harness's error `text`, or `undefined` when it isn't one of these. */
export function localFailureWords(text: string): string | undefined {
  if (/Session too large to compact|context (?:length|window|size)|maximum context|context_length_exceeded|too many tokens/i.test(text)) return FAILURE_WORDS.contextFull;
  if (/Cannot connect to API|Unable to connect|ECONNREFUSED|ECONNRESET|fetch failed|socket hang up|EPIPE/i.test(text)) return FAILURE_WORDS.notRunning;
  // A refused key comes before the rest: the other words never describe an error that says the key is wrong.
  if (/\b(?:status|http|code)\b[ :=]{0,3}40[13]\b|invalid api key|incorrect api key|unauthorized|bad key/i.test(text)) return FAILURE_WORDS.keyRefused;
  if (/model[^\n]{0,80}not found|model_not_found|no such model|not loaded|unknown model/i.test(text)) return FAILURE_WORDS.modelGone;
  if (/timed out|ETIMEDOUT|timeout (?:error|exceeded|reached)|took too long/i.test(text)) return FAILURE_WORDS.timedOut;
  return undefined;
}
