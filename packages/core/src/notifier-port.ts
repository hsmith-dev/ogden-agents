/**
 * The notifier port (AD-1, AD-16; story 5.3 defines it, 11.4 completes it
 * with `notify-webhook`): sends one webhook payload to one URL and says what
 * came back. Core decides what to send and to whom (blocked runs and runs
 * ready for review, only from workspaces with builds on); the URL comes from
 * `SecretStorePort` and is never logged or put in an event.
 */
import type { WebhookPayload, WebhookTestResult } from '@ogden-agents/shared';

export interface NotifierSendOptions {
  /** How long the send may take. Default `WEBHOOK_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export interface NotifierPort {
  /**
   * POSTs `payload` as JSON to `url`. Never throws: a timeout, a network
   * failure or a non-2xx status is a result with `ok: false`, in plain words
   * that never contain the URL. A redirect is never followed (it is a
   * failure): the URL the user saved is the only one ever sent to.
   */
  send(url: string, payload: WebhookPayload, options?: NotifierSendOptions): Promise<WebhookTestResult>;
}
