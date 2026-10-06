/**
 * The one-click presets (epic 14 story 14.4; E14-R2): data the server serves
 * to the page, so core, shared and the web name no server product. A preset
 * is a label, the address a default install listens on, and the official page
 * to get it from. Ogden Agents never installs these servers, starts them or
 * pulls a model for the user (AD-21): it only links to the page.
 */
export interface EndpointPreset {
  id: string;
  label: string;
  baseUrl: string;
  downloadUrl: string;
}

export const ENDPOINT_PRESETS: readonly EndpointPreset[] = Object.freeze([
  { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', downloadUrl: 'https://lmstudio.ai/download' },
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', downloadUrl: 'https://ollama.com/download' },
]);

/** How long Detect waits for each address: a server on this computer answers at once. */
export const DETECT_PROBE_TIMEOUT_MS = 1_200;
