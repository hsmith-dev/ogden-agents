/**
 * What two kinds of local server report beyond the OpenAI-compatible model
 * list (epic 14 story 14.5; E14-R3): a model's size, its context length and
 * whether it can call tools. Read only from the server's own native API, only
 * for an endpoint made from that server's preset, and only what the server
 * says: a field it doesn't give stays unknown, never guessed. A failure here
 * never fails the list (the ids stand).
 *
 * The shapes are from the servers' documentation (Ollama's `/api/tags` and
 * `/api/show`, LM Studio's `/api/v0/models`) and are read tolerantly; the
 * user's live checks confirm them against real servers.
 */
import type { LocalModelInfo, LocalModelTarget } from '@ogden-agents/core';
import { callEndpoint, type EndpointCall } from './http.js';

/** The most models asked about one by one. */
const MAX_SHOW = 40;
/** How many of those are asked at once. */
const SHOW_CONCURRENCY = 6;

/** `http://host:11434/v1` -> `http://host:11434`: where a server's native API lives. */
export function nativeRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' && value.length <= 40 ? value : undefined);
const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

/** Whether a capability list says tools: `true`, `false` when it lists capabilities without it, `undefined` when it lists none. */
function toolSupport(capabilities: unknown): boolean | undefined {
  if (!Array.isArray(capabilities) || capabilities.length === 0) return undefined;
  return capabilities.some((each) => each === 'tools' || each === 'tool_use');
}

/** Ollama: sizes from `/api/tags`, then each model's context length and capabilities from `/api/show`. */
export async function ollamaInfo(call: EndpointCall, ids: readonly string[]): Promise<Map<string, Partial<LocalModelInfo>>> {
  const out = new Map<string, Partial<LocalModelInfo>>();
  const root = { ...call, baseUrl: nativeRoot(call.baseUrl) };
  try {
    const tags = record(await callEndpoint(root, 'api/tags')).models;
    for (const entry of Array.isArray(tags) ? tags : []) {
      const each = record(entry);
      const name = str(each.name) ?? str(each.model);
      if (name === undefined) continue;
      out.set(name, { sizeBytes: num(each.size), parameterSize: str(record(each.details).parameter_size) });
    }
  } catch {
    // Sizes are only nice to have.
  }
  const wanted = ids.slice(0, MAX_SHOW);
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const id = wanted[next++]!;
      try {
        const shown = record(await callEndpoint(root, 'api/show', { method: 'POST', body: { model: id } }));
        const info = record(shown.model_info);
        const key = Object.keys(info).find((name) => name.endsWith('.context_length'));
        out.set(id, { ...out.get(id), contextTokens: key === undefined ? undefined : num(info[key]), toolCall: toolSupport(shown.capabilities) });
      } catch {
        // Unknown stays unknown.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SHOW_CONCURRENCY, wanted.length) }, worker));
  return out;
}

/** LM Studio: context length and tool use from `/api/v0/models`. */
export async function lmStudioInfo(call: EndpointCall): Promise<Map<string, Partial<LocalModelInfo>>> {
  const out = new Map<string, Partial<LocalModelInfo>>();
  try {
    const data = record(await callEndpoint({ ...call, baseUrl: nativeRoot(call.baseUrl) }, 'api/v0/models')).data;
    for (const entry of Array.isArray(data) ? data : []) {
      const each = record(entry);
      const id = str(each.id) ?? (typeof each.id === 'string' && each.id.length <= 300 ? each.id : undefined);
      if (id === undefined) continue;
      out.set(id, { contextTokens: num(each.loaded_context_length) ?? num(each.max_context_length), toolCall: toolSupport(each.capabilities) });
    }
  } catch {
    // Unknown stays unknown.
  }
  return out;
}

/** The ids with whatever the preset's own server reports of them. */
export async function enrich(target: LocalModelTarget, call: EndpointCall, ids: readonly string[]): Promise<LocalModelInfo[]> {
  let extra = new Map<string, Partial<LocalModelInfo>>();
  if (target.preset === 'ollama') extra = await ollamaInfo(call, ids);
  else if (target.preset === 'lmstudio') extra = await lmStudioInfo(call);
  return ids.map((id) => {
    const more = extra.get(id) ?? {};
    const known = Object.fromEntries(Object.entries(more).filter(([, value]) => value !== undefined));
    return { id, ...known };
  });
}
