/**
 * Codex's descriptor, pins, stub slot and fake personality (epic 12 entry 4):
 * the descriptor is sound and matches the adapter, the pins lock the adapter
 * and the Codex CLI, the stub refuses a chat as not set up, and the fake
 * ACP agent's Codex personality answers `initialize` as spike 12.1 recorded.
 * No test runs the real adapter, reads `~/.codex` or reaches the network.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentDescriptorProblems, agentEnvKeys, AgentError, createAgentRegistry, declaredModes, protectedPathsWith } from '@ogden-agents/core';
import { describe, expect, it } from 'vitest';
import {
  CODEX_DESCRIPTOR,
  CODEX_MODE_IDS,
  CODEX_PINS,
  CODEX_SHIPPED,
  createCodexAgent,
  createCodexSetup,
  installedCodex,
  pinnedCodexVersion,
} from '../src/index.js';

const FAKE_CODEX = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-codex.mjs');

describe("Codex's descriptor (epic 12 entry 4)", () => {
  it('has no problem and describes the adapter as it is', () => {
    expect(agentDescriptorProblems(CODEX_DESCRIPTOR)).toEqual([]);
    const agent = createCodexAgent({ dataDir: '/nowhere' });
    expect(CODEX_DESCRIPTOR.displayName).toBe(agent.displayName);
    expect(declaredModes(CODEX_DESCRIPTOR)).toEqual(agent.permissionModes);
    // Ask is `read-only`, Skip all `agent-full-access`; Auto waits for entry 5, `workspace-write` is never offered.
    expect(CODEX_DESCRIPTOR.permissionModes).toEqual({ ask: CODEX_MODE_IDS.ask, skip_all: CODEX_MODE_IDS.skipAll });
    expect(CODEX_DESCRIPTOR.install).toEqual({ kind: 'npm', package: '@agentclientprotocol/codex-acp', version: '2.1.1' });
    expect(CODEX_DESCRIPTOR.homeEnv).toBe('CODEX_HOME');
    expect(CODEX_DESCRIPTOR.needsProjectTrust).toBe(false);
    expect(CODEX_DESCRIPTOR.skillsFolder).toBe('.agents/skills');
    expect(() => createAgentRegistry([{ descriptor: CODEX_DESCRIPTOR, agent }])).not.toThrow();
  });

  it('is API key only, and keeps both OpenAI key names out of every other process', () => {
    expect(CODEX_DESCRIPTOR.signInMethods.map((method) => method.kind)).toEqual(['api_key']);
    expect(agentEnvKeys([CODEX_DESCRIPTOR])).toEqual(['CODEX_API_KEY', 'OPENAI_API_KEY']);
  });

  it('adds .codex to the protected paths, beside the already protected .agents', () => {
    const paths = protectedPathsWith(CODEX_DESCRIPTOR.configFolders);
    expect(paths.folders).toContain('.codex');
    expect(paths.folders).toContain('.agents');
  });

  it('pins the adapter and the Codex CLI, each with its integrity, and every platform binary', () => {
    expect(pinnedCodexVersion()).toBe('2.1.1');
    const packages = CODEX_PINS.lock.packages;
    expect(packages['node_modules/@openai/codex']?.version).toBe('0.159.3');
    for (const platform of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']) {
      expect(packages[`node_modules/@openai/codex-${platform}`]?.optional).toBe(true);
    }
    for (const [path, entry] of Object.entries(packages)) if (path !== '') expect(entry.integrity, path).toMatch(/^sha512-/);
  });

  it('finds the installed adapter by its version folder, the pinned version first', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ogden-agents-codexdir-'));
    try {
      expect(installedCodex(dataDir)).toBeUndefined();
      for (const version of ['2.0.0', '2.1.1', '2.2.0']) {
        const entry = join(dataDir, 'agents', 'codex', `adapter-${version}`, 'node_modules', '@agentclientprotocol', 'codex-acp', 'dist');
        mkdirSync(entry, { recursive: true });
        writeFileSync(join(entry, 'index.js'), '');
      }
      expect(installedCodex(dataDir)?.version).toBe('2.1.1');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('is shipped, and refuses a chat as not set up until installed', async () => {
    expect(CODEX_SHIPPED).toBe(true);
    expect(installedCodex('/nowhere')).toBeUndefined();
    const agent = createCodexAgent({ dataDir: '/nowhere' });
    await expect(agent.startSession({ cwd: process.cwd(), env: {}, permissionMode: 'ask' } as never)).rejects.toBeInstanceOf(AgentError);
    expect(createCodexSetup({ dataDir: '/nowhere' }).agentId).toBe('codex');
  });
});

/** Sends `initialize` to the fake Codex personality and returns its answer. */
function initialize(): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FAKE_CODEX], { stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: process.env.PATH ?? '' } });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const line = out.split('\n').find((candidate) => candidate.includes('"id":1'));
      if (line === undefined) return;
      child.kill();
      resolve(JSON.parse(line).result);
    });
    child.on('error', reject);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } })}\n`);
  });
}

describe("the fake agent's Codex personality", () => {
  it('answers initialize as spike 12.1 recorded', async () => {
    const result = await initialize();
    expect(result.agentInfo).toMatchObject({ name: '@agentclientprotocol/codex-acp', version: '2.1.1' });
    expect(result.agentCapabilities.loadSession).toBe(true);
    expect(result.agentCapabilities.sessionCapabilities).toMatchObject({ list: {}, resume: {} });
    expect(result.authMethods.map((method: { id: string }) => method.id)).toEqual(['chat-gpt', 'api-key']);
  });
});
