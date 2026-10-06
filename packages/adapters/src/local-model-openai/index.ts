/**
 * `local-model-openai` (epic 14): the server's own calls to an
 * OpenAI-compatible endpoint. Names no vendor outside presets.ts and native.ts; story 14.3 builds core's
 * `LocalModelPort` on it, story 14.8 adds `structuredComplete`.
 */
export { DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS, EndpointError, callEndpoint, endpointUrl, type EndpointCall, type EndpointFailureKind } from './http.js';
export { modelIdsOf, probeEndpoint, type EndpointProbe } from './probe.js';
export { endpointFailureWords, failureOf, hostOf } from './reasons.js';
export { createOpenAiLocalModel, type OpenAiLocalModelOptions } from './port.js';
export { DETECT_PROBE_TIMEOUT_MS, ENDPOINT_PRESETS, type EndpointPreset } from './presets.js';
export { MAX_PROBLEMS, parseModelJson, schemaProblems, unsupportedRule } from './json-schema.js';
export { structuredComplete, MAX_SCHEMA_CHARS, STRUCTURED_DEFAULT_TIMEOUT_MS, STRUCTURED_MAX_BYTES, STRUCTURED_MAX_TIMEOUT_MS } from './structured.js';
