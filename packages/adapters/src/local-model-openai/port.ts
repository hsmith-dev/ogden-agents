/**
 * `LocalModelPort` over an OpenAI-compatible endpoint (epic 14 story 14.3):
 * probe and list models with `GET {base}/models`. Names no vendor. The server
 * is the only caller (AD-15); the key is only sent as a bearer token (AD-16).
 * `structuredComplete` is story 14.8: until then it answers `unsupported`.
 */
import type { LocalFailure, LocalModelPort, LocalModelsResult, LocalModelTarget, LocalProbeResult, StructuredResult } from '@ogden-agents/core';
import { EndpointError, callEndpoint, type EndpointFailureKind } from './http.js';
import { modelIdsOf } from './probe.js';
import { endpointFailureWords } from './reasons.js';

export interface OpenAiLocalModelOptions {
  /** Default: the global `fetch`. Tests pass a fake: nothing here ever reaches a real server in a test. */
  fetch?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

/** A failure as the port reports it. */
export function failureOf(kind: EndpointFailureKind, baseUrl: string, status?: number): LocalFailure {
  return { ok: false, kind, ...(status === undefined ? {} : { status }), reason: endpointFailureWords(kind, baseUrl, status) };
}

export function createOpenAiLocalModel(options: OpenAiLocalModelOptions = {}): LocalModelPort {
  const call = (target: LocalModelTarget, signal?: AbortSignal) => ({ baseUrl: target.baseUrl, key: target.key, fetch: options.fetch, timeoutMs: options.timeoutMs, signal });
  const listIds = async (target: LocalModelTarget, signal?: AbortSignal): Promise<{ ok: true; ids: string[] } | LocalFailure> => {
    try {
      const ids = modelIdsOf(await callEndpoint(call(target, signal), 'models'));
      return ids === undefined ? failureOf('not_openai', target.baseUrl) : { ok: true, ids };
    } catch (error) {
      if (error instanceof EndpointError) return failureOf(error.kind, target.baseUrl, error.details.status);
      return failureOf('unreachable', target.baseUrl);
    }
  };
  return {
    async probe(target, signal): Promise<LocalProbeResult> {
      const listed = await listIds(target, signal);
      return listed.ok ? { ok: true, models: listed.ids } : listed;
    },
    async listModels(target, signal): Promise<LocalModelsResult> {
      const listed = await listIds(target, signal);
      return listed.ok ? { ok: true, models: listed.ids.map((id) => ({ id })) } : listed;
    },
    async structuredComplete(): Promise<StructuredResult> {
      return { ok: false, kind: 'unsupported', reason: 'Asking this model for a structured answer is not available yet.' };
    },
  };
}
