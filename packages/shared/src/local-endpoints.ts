import { z } from 'zod';
import { LocalEndpointId } from './ids.js';

/**
 * OpenAI-compatible endpoints the Local model talks to (epic 14, story 14.3;
 * E14-R2, E14-R6). An endpoint is a base URL (and an optional key) the user
 * set up in Settings, Agents: a server on this computer, or any other. Only
 * Ogden's server calls it, never the browser (AD-15, the CSP is unchanged).
 *
 * - The key is held through `SecretStorePort` as `agent-endpoint-key/<id>`
 *   and is never in these contracts, the database, an event or a log
 *   (AD-16): the page only learns whether one is saved.
 * - A loopback host (this computer) needs no confirmation. Any other host
 *   needs the user's plain-words confirmation, recorded per endpoint and
 *   bound to the host (name and port): changing the host asks again. Plain
 *   `http` to another host shows a warning that traffic is readable on the
 *   network.
 * - Names no server product: a preset is only an opaque id (`preset`) that
 *   the server's preset list gives a label and an address to.
 */

/** The longest label an endpoint may have. */
export const MAX_ENDPOINT_LABEL = 60;
/** The longest base URL accepted. */
export const MAX_ENDPOINT_URL = 2048;
/** The most endpoints one install keeps. */
export const MAX_LOCAL_ENDPOINTS = 20;
/** The most an endpoint's key may be, in characters. */
export const MAX_ENDPOINT_KEY = 1000;

/** The keychain name an endpoint's key is stored under (AD-16). */
export const endpointKeyName = (id: string): string => `agent-endpoint-key/${id}`;

/** Why an address can't be used, in words for the user (never echoing the address). */
export const ENDPOINT_URL_WORDS = {
  empty: 'Enter the server address, for example http://localhost:1234/v1.',
  invalid: "That doesn't look like a web address. It starts with http:// or https://.",
  scheme: 'The address must start with http:// or https://.',
  credentials: 'Leave a name or password out of the address. Put a key in the key box instead.',
  extras: 'Leave anything after a ? or # out of the address.',
  tooLong: 'That address is too long.',
} as const;

export type EndpointUrlProblem = keyof typeof ENDPOINT_URL_WORDS;

/** What reading a base URL tells (a pure check, the same in the page and the server). */
export type EndpointAddress =
  | {
      ok: true;
      /** The address cleaned up: lower-case host, no trailing slash. */
      url: string;
      scheme: 'http' | 'https';
      /**
       * The scheme, host and port (`http://localhost:1234`, `https://api.example.com`), what a confirmation is bound
       * to: a changed scheme or port is another service and asks again (default ports are kept out of the URL's own
       * host, so the scheme is part of this).
       */
      host: string;
      /** This computer: `localhost`, `127.x.x.x` or `::1`. Anything else, even a name that points here, is not. */
      loopback: boolean;
      /** Plain `http` to a host that is not this computer: readable on the network (warned about). */
      insecureRemote: boolean;
    }
  | { ok: false; problem: EndpointUrlProblem; reason: string };

/** `127.0.0.0/8` in the form `new URL` normalizes every IPv4 spelling to. */
const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/;

/**
 * Reads `input` as an endpoint's base URL. Loopback is only `localhost` (and
 * `localhost.`), `127.0.0.0/8` and `[::1]` as the URL parser spells them: a
 * name that merely resolves here, a `.localhost` subdomain, `0.0.0.0` and an
 * IPv4-mapped IPv6 address all count as another host, which asks for the
 * user's confirmation (the safe side).
 */
export function readEndpointAddress(input: string): EndpointAddress {
  const text = input.trim();
  const fail = (problem: EndpointUrlProblem): EndpointAddress => ({ ok: false, problem, reason: ENDPOINT_URL_WORDS[problem] });
  if (text === '') return fail('empty');
  if (text.length > MAX_ENDPOINT_URL) return fail('tooLong');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return fail('invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail('scheme');
  if (url.hostname === '') return fail('invalid');
  if (url.username !== '' || url.password !== '') return fail('credentials');
  if (url.search !== '' || url.hash !== '' || text.includes('?') || text.includes('#')) return fail('extras');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  // `localhost.` (a trailing dot) is not trusted to be pinned by every resolver, so it asks like any other name.
  const loopback = url.hostname.toLowerCase() === 'localhost' || IPV4_LOOPBACK.test(hostname) || hostname === '[::1]';
  const scheme = url.protocol === 'https:' ? 'https' : 'http';
  const path = url.pathname.replace(/\/+$/, '');
  const clean = `${scheme}://${url.host.toLowerCase()}${path}`;
  return { ok: true, url: clean, scheme, host: `${scheme}://${url.host.toLowerCase()}`, loopback, insecureRemote: scheme === 'http' && !loopback };
}

/** A label for an endpoint, trimmed. */
const Label = z.string().trim().min(1, 'Give the server a name.').max(MAX_ENDPOINT_LABEL, `Use ${MAX_ENDPOINT_LABEL} characters or fewer.`);

/** A base URL that reads as a usable address; the problem is the plain words of {@link ENDPOINT_URL_WORDS}. */
const BaseUrl = z
  .string()
  .max(MAX_ENDPOINT_URL, ENDPOINT_URL_WORDS.tooLong)
  .superRefine((value, context) => {
    const read = readEndpointAddress(value);
    if (!read.ok) context.addIssue({ code: 'custom', message: read.reason });
  });

/** An opaque preset id from the server's preset list, or none. */
const Preset = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Unknown preset.')
  .nullable();

/** A key as typed: never trimmed away to nothing, never echoed back. */
const EndpointKey = z
  .string()
  .trim()
  .min(1, 'Enter the key.')
  .max(MAX_ENDPOINT_KEY, 'That is too long to be a key.')
  // A pasted line break or other control character can never be part of a key (it would break the request).
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'That key has a line break or a hidden character in it. Paste it again.');

/** One endpoint as stored: no key, only whether one is saved (`auth`). */
export const LocalEndpoint = z.object({
  id: LocalEndpointId,
  label: Label,
  /** The preset it was made from, if any (the server's list names it); only a label for the card. */
  preset: Preset,
  /** The cleaned base URL. */
  baseUrl: z.string().min(1).max(MAX_ENDPOINT_URL),
  /** `key`: a key is saved for it in the keychain. */
  auth: z.enum(['none', 'key']),
  /** The model its chats start on, as the server's own id, or none chosen yet. */
  model: z.string().min(1).max(300).nullable(),
  /** The host (name and port) the user confirmed prompts and project text may go to; `null` until confirmed. */
  remoteConfirmedFor: z.string().min(1).max(300).nullable(),
  createdAt: z.string().min(1),
});
export type LocalEndpoint = z.infer<typeof LocalEndpoint>;

/** An endpoint as the page shows it: what is stored, and what the address means. Never a key. */
export const LocalEndpointView = LocalEndpoint.extend({
  /** The host and port, for the confirmation's words. */
  host: z.string().min(1),
  /** This computer: no confirmation needed. */
  loopback: z.boolean(),
  /** Another host that the user has not confirmed (or whose address changed since): chats and tests are refused until they do. */
  needsConfirmation: z.boolean(),
  /** Plain `http` to another host: the card warns that traffic is readable on the network. */
  insecureRemote: z.boolean(),
  /** Whether a key is saved. */
  keySaved: z.boolean(),
});
export type LocalEndpointView = z.infer<typeof LocalEndpointView>;

/** `GET /api/v1/local-endpoints`. */
export const LocalEndpointsResponse = z.object({
  endpoints: z.array(LocalEndpointView),
  /** The endpoint new chats use unless a project or chat says otherwise; `null` when none is set up. */
  defaultEndpointId: LocalEndpointId.nullable(),
});
export type LocalEndpointsResponse = z.infer<typeof LocalEndpointsResponse>;

/** `{ endpoint }`, the answer to adding or changing one. */
export const LocalEndpointResponse = z.object({ endpoint: LocalEndpointView });
export type LocalEndpointResponse = z.infer<typeof LocalEndpointResponse>;

/**
 * `POST /api/v1/local-endpoints`: adds one. The key goes to the keychain at
 * once and is never answered. `confirmHost` is the host the user was shown
 * and confirmed (for another host than this computer); it must equal the
 * address's own host.
 */
export const AddLocalEndpointRequest = z
  .object({
    label: Label,
    baseUrl: BaseUrl,
    preset: Preset.optional(),
    key: EndpointKey.optional(),
    model: z.string().min(1).max(300).nullable().optional(),
    confirmHost: z.string().min(1).max(300).optional(),
  })
  .strict();
export type AddLocalEndpointRequest = z.infer<typeof AddLocalEndpointRequest>;

/** `PATCH /api/v1/local-endpoints/:endpointId`: changes the name, address or chosen model; a changed host asks for confirmation again. */
export const UpdateLocalEndpointRequest = z
  .object({
    label: Label.optional(),
    baseUrl: BaseUrl.optional(),
    model: z.string().min(1).max(300).nullable().optional(),
    confirmHost: z.string().min(1).max(300).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Choose something to change.');
export type UpdateLocalEndpointRequest = z.infer<typeof UpdateLocalEndpointRequest>;

/** `PUT /api/v1/local-endpoints/:endpointId/key`: saves the key (no-store; never echoed, logged or evented). */
export const SetEndpointKeyRequest = z.object({ key: EndpointKey }).strict();
export type SetEndpointKeyRequest = z.infer<typeof SetEndpointKeyRequest>;

/** `POST /api/v1/local-endpoints/:endpointId/confirm`: the user confirmed that prompts and project text go to `host`. */
export const ConfirmRemoteRequest = z.object({ host: z.string().min(1).max(300) }).strict();
export type ConfirmRemoteRequest = z.infer<typeof ConfirmRemoteRequest>;

/** `PUT /api/v1/local-endpoints-default`: which endpoint new chats use (`null`: the first). */
export const SetDefaultEndpointRequest = z.object({ endpointId: LocalEndpointId.nullable() }).strict();
export type SetDefaultEndpointRequest = z.infer<typeof SetDefaultEndpointRequest>;

/**
 * The plain-words confirmation the page shows for another host, with the
 * host in it. The privacy statement for that endpoint (E14-R6): prompts and
 * project text go there; `https` is preferred.
 */
export function remoteConfirmationWords(host: string, insecure: boolean): string {
  const base = `Your messages, the files the model reads and your project's text will be sent to ${host}, which is not this computer.`;
  return insecure
    ? `${base} This address uses plain http, so anyone on the network between here and there can read what is sent. Use https if the server offers it.`
    : `${base} Only continue if you trust that server.`;
}

/** The statement for a server on this computer (E14-R6). */
export const LOOPBACK_PRIVACY_WORDS = 'This server runs on this computer. Nothing leaves it except to this server.';

/** A one-click preset the server offers (epic 14 story 14.4): a label, an address and where to get the server. Data from the server, never named in shared. */
export const LocalEndpointPreset = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  label: z.string().min(1).max(MAX_ENDPOINT_LABEL),
  baseUrl: z.string().min(1).max(MAX_ENDPOINT_URL),
  /** The official page to get it from, linked when none is found. */
  downloadUrl: z.url().regex(/^https:\/\//, 'A download page must be an https address.'),
});
export type LocalEndpointPreset = z.infer<typeof LocalEndpointPreset>;

/** `GET /api/v1/local-endpoint-presets`. */
export const LocalEndpointPresetsResponse = z.object({ presets: z.array(LocalEndpointPreset) });
export type LocalEndpointPresetsResponse = z.infer<typeof LocalEndpointPresetsResponse>;

/** How an endpoint is, in the card's plain words. */
export const LOCAL_ENDPOINT_STATES = ['ready', 'no_models', 'not_running', 'key_refused', 'other'] as const;
export const LocalEndpointState = z.enum(LOCAL_ENDPOINT_STATES);
export type LocalEndpointState = z.infer<typeof LocalEndpointState>;

/** The most model ids a test answers (the full list is story 14.5's). */
export const MAX_TEST_MODELS = 500;

/** `POST /api/v1/local-endpoints/:endpointId/test`: Test connection. The server (never the page) calls the endpoint. */
export const LocalEndpointTestResponse = z.object({
  state: LocalEndpointState,
  /** The model ids the endpoint serves, when ready. */
  models: z.array(z.string().min(1).max(300)).max(MAX_TEST_MODELS),
  /** Plain words for the state. Never the address or a key. */
  message: z.string().min(1),
});
export type LocalEndpointTestResponse = z.infer<typeof LocalEndpointTestResponse>;

/** One server Detect found on this computer. */
export const DetectedEndpoint = z.object({
  presetId: z.string(),
  label: z.string().min(1),
  baseUrl: z.string().min(1),
  /** How many models it serves now (0: running with none loaded). */
  models: z.number().int().nonnegative(),
});
export type DetectedEndpoint = z.infer<typeof DetectedEndpoint>;

/** `POST /api/v1/local-endpoints-detect`: probes only 127.0.0.1 and localhost on the presets' ports, once, on a button press; never a scan. */
export const LocalEndpointDetectResponse = z.object({ found: z.array(DetectedEndpoint) });
export type LocalEndpointDetectResponse = z.infer<typeof LocalEndpointDetectResponse>;

/** The card's words for an endpoint's state. */
export function endpointStateWords(state: LocalEndpointState, models: number): string {
  switch (state) {
    case 'ready':
      return models === 1 ? 'Ready. 1 model is available.' : `Ready. ${models} models are available.`;
    case 'no_models':
      return 'Running, but no model is loaded yet. Load one in the server, then test again.';
    case 'not_running':
      return 'Not running. Start the server, then test again.';
    case 'key_refused':
      return "The server didn't accept the key. Add the right key, or check the one saved, then test again.";
    case 'other':
      return "The server answered, but not in a way Ogden Agents can use. Check its address.";
  }
}

/** The context length below which the card cautions (epic 14 story 14.5; spike 14.1 and the epic's floor): tool use needs 16k to 32k or more. */
export const LOCAL_CONTEXT_FLOOR_TOKENS = 16_384;

/** The most a model family's size may be (in billions of parameters) to be called small. */
const SMALL_MODEL_BILLIONS = 14;

/** What a server reports of one model; every field is only what it said (nothing is guessed). */
export const EndpointModel = z.object({
  id: z.string().min(1).max(300),
  sizeBytes: z.number().int().nonnegative().optional(),
  /** E.g. `7B`, as the server writes it. */
  parameterSize: z.string().min(1).max(40).optional(),
  contextTokens: z.number().int().positive().optional(),
  /** `false` only when the server says it can't call tools. */
  toolCall: z.boolean().optional(),
  /** Plain-words cautions for this model (small context, small model, no tools). */
  cautions: z.array(z.string().min(1)).max(6),
});
export type EndpointModel = z.infer<typeof EndpointModel>;

/** `GET /api/v1/local-endpoints/:endpointId/models`. The server (never the page) asks the endpoint. */
export const LocalEndpointModelsResponse = z.object({
  state: LocalEndpointState,
  message: z.string().min(1),
  models: z.array(EndpointModel).max(MAX_TEST_MODELS),
  /** The model its chats start on, as chosen; `null` when none is chosen (the first one is used). */
  model: z.string().nullable(),
  /** The chosen model when the server no longer lists it: shown as missing, never swapped for another. */
  missing: z.string().nullable(),
});
export type LocalEndpointModelsResponse = z.infer<typeof LocalEndpointModelsResponse>;

/** `4.1 GB`, `820 MB`: a size in plain words. */
export function sizeWords(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1).replace(/\.0$/, '')} GB`;
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

/** `32k`, `128k`: a context length in plain words. */
export function contextWords(tokens: number): string {
  // Rounded down, so a context just under 16k never reads as 16k.
  return tokens >= 1024 ? `${Math.floor(tokens / 1024)}k` : String(tokens);
}

/** The billions of parameters in a size such as `7B`, `8.0B` or `70B`; `undefined` when it isn't one. */
function billions(parameterSize: string | undefined): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([BbMm])\s*$/.exec(parameterSize ?? '');
  if (match === null) return undefined;
  const value = Number(match[1]);
  return match[2]!.toLowerCase() === 'b' ? value : value / 1000;
}

/**
 * The cautions for a model, from what the server reported (E14-R7): never a guarantee
 * and never a recommendation. Nothing is said for what the server did not report.
 */
export function modelCautions(model: { parameterSize?: string | undefined; contextTokens?: number | undefined; toolCall?: boolean | undefined }): string[] {
  const out: string[] = [];
  if (model.contextTokens !== undefined && model.contextTokens < LOCAL_CONTEXT_FLOOR_TOKENS) {
    out.push(`Its context is small (${contextWords(model.contextTokens)}). Editing files and running commands needs 16k to 32k or more, and long skills need more.`);
  }
  if (model.toolCall === false) out.push("The server says it can't call tools, so it can chat but not edit files or run commands.");
  const size = billions(model.parameterSize);
  if (size !== undefined && size < SMALL_MODEL_BILLIONS) out.push('Small models follow tool instructions less reliably. Models of about 30B or more are more dependable for coding.');
  return out;
}

/** One line on a model for a picker: its size and context, where the server reported them. */
export function modelDescription(model: { sizeBytes?: number | undefined; parameterSize?: string | undefined; contextTokens?: number | undefined }): string | undefined {
  const parts = [model.parameterSize, model.sizeBytes === undefined ? undefined : sizeWords(model.sizeBytes), model.contextTokens === undefined ? undefined : `${contextWords(model.contextTokens)} context`].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(', ');
}

/** `POST /api/v1/local-endpoints/:endpointId/manager-test`: Test as a manager, on one of the endpoint's models (epic 14 story 14.8). */
export const ManagerTestRequest = z.object({ model: z.string().min(1).max(300) }).strict();
export type ManagerTestRequest = z.infer<typeof ManagerTestRequest>;

export const MANAGER_TEST_MODES = ['json_schema', 'json_object', 'prompt'] as const;

/** What the manager test found, in plain words. */
export const ManagerTestResponse = z.object({
  pass: z.boolean(),
  /** How the model was asked when it passed: the strictest ask that worked tells epic 15 what the model can do. */
  mode: z.enum(MANAGER_TEST_MODES).nullable(),
  /** How long the answer took, in milliseconds. */
  ms: z.number().int().nonnegative(),
  message: z.string().min(1),
});
export type ManagerTestResponse = z.infer<typeof ManagerTestResponse>;
