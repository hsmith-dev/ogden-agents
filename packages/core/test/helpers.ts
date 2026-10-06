import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import {
  createAgentRegistry,
  openCore,
  type AgentDescriptor,
  type AgentPort,
  type AgentRegistry,
  type BmadCatalogPort,
  type Core,
  type OpenCoreOptions,
  type RegisteredAgent,
} from '../src/index.js';

/** The id the core tests register their one agent under. */
export const TEST_AGENT_ID = 'test-agent';

/**
 * A test agent's descriptor (6.3): sound, named and moded as `agent` is, with
 * a subscription sign-in and an API key in `TEST_AGENT_KEY`; `overrides` change any field.
 */
export function testDescriptor(agentId: string, agent: Pick<AgentPort, 'displayName' | 'permissionModes'>, overrides: Partial<AgentDescriptor> = {}): AgentDescriptor {
  const declared = agent.permissionModes ?? ['ask'];
  return {
    agentId,
    displayName: agent.displayName,
    provider: 'Test Provider',
    install: { kind: 'npm', package: '@test/agent', version: '1.0.0' },
    signInMethods: [
      { id: 'account', kind: 'subscription', label: 'Sign in with your account' },
      { id: 'key', kind: 'api_key', label: 'Use an API key', apiKey: { envNames: ['TEST_AGENT_KEY'], format: 'Starts with test-' } },
    ],
    permissionModes: {
      ask: 'asking',
      ...(declared.includes('auto') ? { auto: 'auto-mode' } : {}),
      ...(declared.includes('skip_all') ? { skip_all: 'yolo' } : {}),
    },
    needsProjectTrust: false,
    skillsFolder: '.test/skills',
    ...overrides,
  };
}

/** `agent` registered as `agentId`, with {@link testDescriptor}. */
export function registered(agentId: string, agent: AgentPort, overrides: Partial<AgentDescriptor> = {}): RegisteredAgent {
  return { descriptor: testDescriptor(agentId, agent, overrides), agent };
}

/** A registry holding only `agent`, as {@link TEST_AGENT_ID} (default and legacy agent alike). */
export function soleAgent(agent: AgentPort): AgentRegistry {
  return createAgentRegistry([registered(TEST_AGENT_ID, agent)]);
}

const dirs: string[] = [];
const opened: Core[] = [];

afterEach(() => {
  for (const core of opened.splice(0)) core.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Removes `dir` after the test, once every core opened here is closed. Returns it. */
export function removeAfterTest(dir: string): string {
  dirs.push(dir);
  return dir;
}

/** A fresh temp directory, removed after the test. */
export function tempDir(prefix = 'ogden-agents-core-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Opens core on `dataDir` (a fresh temp data folder by default), with `options` (such as available BMad pieces); closed after the test. */
export function openTestCore(dataDir: string = tempDir(), onListenerError?: (error: unknown) => void, options: OpenCoreOptions = {}): Core {
  const core = openCore(dataDir, { ...options, ...(onListenerError === undefined ? {} : { onListenerError }) });
  opened.push(core);
  return core;
}

/**
 * The parts of `BmadCatalogPort` a test that only detects (or only lists
 * skills) never reaches (story 4.2): each rejects, so a test that did reach
 * one fails loudly; `scriptsFingerprint` answers no scripts.
 */
export const unusedCatalogParts: Pick<BmadCatalogPort, 'catalog' | 'setupStatus' | 'setup' | 'readDocument' | 'readRetrospective' | 'missingCapabilities' | 'scriptsFingerprint'> = {
  catalog: () => Promise.reject(new Error('catalog is not used in this test')),
  setupStatus: () => Promise.reject(new Error('setupStatus is not used in this test')),
  setup: () => Promise.reject(new Error('setup is not used in this test')),
  readDocument: () => Promise.reject(new Error('readDocument is not used in this test')),
  readRetrospective: () => Promise.reject(new Error('readRetrospective is not used in this test')),
  missingCapabilities: () => Promise.reject(new Error('missingCapabilities is not used in this test')),
  // The script trust reads it (story 4.13): a repo with no scripts of its own, unless a test says otherwise.
  scriptsFingerprint: async () => 'none',
};
