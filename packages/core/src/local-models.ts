/**
 * Using the Local model's endpoints (epic 14 story 14.4): Test connection and
 * Detect, over `LocalEndpoints` and `LocalModelPort`. The one place an
 * endpoint id becomes a call, so the confirmation rule holds: an endpoint on
 * a host nobody confirmed is refused before anything is called
 * (`EndpointConfirmationRequiredError`). Detect only ever probes loopback
 * candidates and only when called: never another host, never a scan.
 */
import { endpointStateWords, MAX_TEST_MODELS, readEndpointAddress, type DetectedEndpoint, type LocalEndpointId, type LocalEndpointState, type LocalEndpointTestResponse } from '@ogden-agents/shared';
import type { LocalEndpoints } from './local-endpoints.js';
import type { LocalModelInfo, LocalModelPort } from './local-model-port.js';

/** A place Detect may look: a preset's label and its address (which must be loopback to be probed). */
export interface DetectCandidate {
  id: string;
  label: string;
  baseUrl: string;
}

export interface LocalModelsAnswer {
  state: LocalEndpointState;
  message: string;
  models: LocalModelInfo[];
  /** The chosen model, or `null` when none is chosen. */
  model: string | null;
  /** The chosen model when the server no longer lists it. */
  missing: string | null;
}

export interface LocalModels {
  /** Test connection for `id`: its state in plain words, and the models it serves. Never throws for an endpoint's own failure. */
  test(id: LocalEndpointId): Promise<LocalEndpointTestResponse>;
  /**
   * Probes each loopback candidate on `127.0.0.1` and on `localhost` (the same port and path), once. The first of
   * the two that answers counts. A candidate that is not loopback is skipped.
   */
  detect(candidates: readonly DetectCandidate[]): Promise<DetectedEndpoint[]>;
  /**
   * The models endpoint `id` serves, with what the server reports of each, its state in plain words, the model
   * chosen for its chats and, when the server no longer lists that one, which it is (`missing`): shown as missing,
   * never swapped for another. Refuses an unconfirmed host before anything is called.
   */
  models(id: LocalEndpointId): Promise<LocalModelsAnswer>;
  /** `models` itself, without the one-at-a-time sharing. */
  readModels(id: LocalEndpointId): Promise<LocalModelsAnswer>;
  /** Detect itself, without the one-at-a-time guard. */
  detectNow(candidates: readonly DetectCandidate[]): Promise<DetectedEndpoint[]>;
}

/** `detectPort` is the port Detect uses, with a short timeout of its own (default: `port`). */
export function createLocalModels({
  endpoints,
  port,
  detectPort = port,
  onModels,
}: {
  endpoints: LocalEndpoints;
  port: LocalModelPort;
  detectPort?: LocalModelPort;
  /** Told each time an endpoint's models were read (the server keeps them for the chat model picker). */
  onModels?: ((endpointId: LocalEndpointId, models: readonly LocalModelInfo[]) => void) | undefined;
}): LocalModels {
  let running: Promise<DetectedEndpoint[]> | undefined;
  const reading = new Map<LocalEndpointId, Promise<LocalModelsAnswer>>();
  return {
    async test(id) {
      const target = await endpoints.target(id);
      if (target === undefined) throw new Error('unreachable: target() answered nothing for a named endpoint');
      const probed = await port.probe({ baseUrl: target.baseUrl, key: target.key });
      let state: LocalEndpointState;
      let models: string[] = [];
      let count = 0;
      if (probed.ok) {
        models = probed.models.slice(0, MAX_TEST_MODELS);
        count = probed.models.length;
        state = probed.models.length > 0 ? 'ready' : 'no_models';
      } else if (probed.kind === 'unreachable' || probed.kind === 'timeout') state = 'not_running';
      else if (probed.kind === 'key_refused') state = 'key_refused';
      else state = 'other';
      // `other` carries the adapter's own plain reason (it names the host, never a key or path).
      const message = state === 'other' && !probed.ok ? probed.reason : endpointStateWords(state, count);
      return { state, models, message };
    },

    models(id) {
      // One read per endpoint at a time: a repeated press shares it (a read can make dozens of calls).
      let pending = reading.get(id);
      if (pending === undefined) {
        pending = this.readModels(id).finally(() => reading.delete(id));
        reading.set(id, pending);
      }
      return pending;
    },

    async readModels(id) {
      const target = await endpoints.target(id);
      if (target === undefined) throw new Error('unreachable: target() answered nothing for a named endpoint');
      const listed = await port.listModels({ baseUrl: target.baseUrl, key: target.key, preset: target.preset });
      const chosen = target.model ?? null;
      if (!listed.ok) {
        const state: LocalEndpointState = listed.kind === 'unreachable' || listed.kind === 'timeout' ? 'not_running' : listed.kind === 'key_refused' ? 'key_refused' : 'other';
        return { state, message: state === 'other' ? listed.reason : endpointStateWords(state, 0), models: [], model: chosen, missing: null };
      }
      const infos = listed.models.slice(0, MAX_TEST_MODELS);
      try {
        onModels?.(id, infos);
      } catch {
        // Keeping the list for the picker never fails the answer.
      }
      const state: LocalEndpointState = listed.models.length > 0 ? 'ready' : 'no_models';
      return {
        state,
        message: endpointStateWords(state, listed.models.length),
        models: infos,
        model: chosen,
        // A chosen model the server doesn't list is missing, whatever else it lists.
        missing: chosen !== null && !listed.models.some((each) => each.id === chosen) ? chosen : null,
      };
    },

    detect(candidates) {
      // One Detect at a time: a second press while one runs gets the same answer, so it can't pile up probes.
      running ??= this.detectNow(candidates).finally(() => {
        running = undefined;
      });
      return running;
    },

    async detectNow(candidates) {
      const found: DetectedEndpoint[] = [];
      for (const candidate of candidates) {
        const read = readEndpointAddress(candidate.baseUrl);
        if (!read.ok || !read.loopback) continue;
        const url = new URL(read.url);
        for (const hostname of ['127.0.0.1', 'localhost']) {
          url.hostname = hostname;
          const baseUrl = url.toString().replace(/\/+$/, '');
          const probed = await detectPort.probe({ baseUrl });
          if (probed.ok) {
            found.push({ presetId: candidate.id, label: candidate.label, baseUrl, models: probed.models.length });
            break;
          }
        }
      }
      return found;
    },
  };
}
