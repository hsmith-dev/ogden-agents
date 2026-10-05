/**
 * Using the Local model's endpoints (epic 14 story 14.4): Test connection and
 * Detect, over `LocalEndpoints` and `LocalModelPort`. The one place an
 * endpoint id becomes a call, so the confirmation rule holds: an endpoint on
 * a host nobody confirmed is refused before anything is called
 * (`EndpointConfirmationRequiredError`). Detect only ever probes loopback
 * candidates and only when called: never another host, never a scan.
 */
import { endpointStateWords, readEndpointAddress, type DetectedEndpoint, type LocalEndpointId, type LocalEndpointState, type LocalEndpointTestResponse } from '@ogden-agents/shared';
import type { LocalEndpoints } from './local-endpoints.js';
import type { LocalModelPort } from './local-model-port.js';

/** A place Detect may look: a preset's label and its address (which must be loopback to be probed). */
export interface DetectCandidate {
  id: string;
  label: string;
  baseUrl: string;
}

export interface LocalModels {
  /** Test connection for `id`: its state in plain words, and the models it serves. Never throws for an endpoint's own failure. */
  test(id: LocalEndpointId): Promise<LocalEndpointTestResponse>;
  /**
   * Probes each loopback candidate on `127.0.0.1` and on `localhost` (the same port and path), once. The first of
   * the two that answers counts. A candidate that is not loopback is skipped.
   */
  detect(candidates: readonly DetectCandidate[]): Promise<DetectedEndpoint[]>;
}

/** How long Detect waits for each probe: a server on this computer answers at once. */
export const DETECT_TIMEOUT_MS = 1_200;

/** `detectPort` is the port Detect uses, with a short timeout of its own (default: `port`). */
export function createLocalModels({ endpoints, port, detectPort = port }: { endpoints: LocalEndpoints; port: LocalModelPort; detectPort?: LocalModelPort }): LocalModels {
  return {
    async test(id) {
      const target = await endpoints.target(id);
      if (target === undefined) throw new Error('unreachable: target() answered nothing for a named endpoint');
      const probed = await port.probe({ baseUrl: target.baseUrl, key: target.key });
      let state: LocalEndpointState;
      let models: string[] = [];
      if (probed.ok) {
        models = probed.models.slice(0, 500);
        state = probed.models.length > 0 ? 'ready' : 'no_models';
      } else if (probed.kind === 'unreachable' || probed.kind === 'timeout') state = 'not_running';
      else if (probed.kind === 'key_refused') state = 'key_refused';
      else state = 'other';
      // `other` carries the adapter's own plain reason (it names the host, never a key or path).
      const message = state === 'other' && !probed.ok ? probed.reason : endpointStateWords(state, models.length);
      return { state, models, message };
    },

    async detect(candidates) {
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
