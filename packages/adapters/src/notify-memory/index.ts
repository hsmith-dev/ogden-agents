/**
 * `notify-memory` (story 5.3): an in-memory `NotifierPort` for tests and
 * epic 11's lanes (11.4 adds `notify-webhook`). It sends nothing: it records
 * each payload with its URL and answers what the test set for that URL
 * (default a 204). Never on the network.
 */
import type { NotifierPort, NotifierSendOptions } from '@ogden-agents/core';
import { WEBHOOK_TEST_SENT, type WebhookPayload, type WebhookTestResult } from '@ogden-agents/shared';

export interface MemoryNotifier extends NotifierPort {
  /** Every send, in order. */
  readonly sent: Array<{ url: string; payload: WebhookPayload; options: NotifierSendOptions }>;
  /** What a send to a URL answers. */
  answers: Map<string, WebhookTestResult>;
}

export const MEMORY_NOTIFIER_OK: WebhookTestResult = { ok: true, status: 204, failure: null, message: WEBHOOK_TEST_SENT };

export function createMemoryNotifier(): MemoryNotifier {
  const sent: Array<{ url: string; payload: WebhookPayload; options: NotifierSendOptions }> = [];
  const answers = new Map<string, WebhookTestResult>();
  return {
    sent,
    answers,
    async send(url, payload, options = {}) {
      sent.push({ url, payload, options });
      return answers.get(url) ?? MEMORY_NOTIFIER_OK;
    },
  };
}
