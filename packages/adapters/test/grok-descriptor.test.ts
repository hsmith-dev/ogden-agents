/**
 * Grok's descriptor, pins, stub slot, checked-binary install and fake
 * personality (epic 12 entry 4): the descriptor is sound and matches the
 * adapter, the pins lock the package and its six platform packages and the
 * binary hashes cover every platform, the install unpacks and hash-checks the
 * binary itself (a changed hash refuses it), the stub refuses a chat as not set
 * up, and the fake ACP agent's Grok personality answers `initialize` as spike
 * 12.2 recorded. No test runs the real Grok, reads `~/.grok` or reaches the network.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { agentDescriptorProblems, agentEnvKeys, AgentError, AgentSetupError, AGENT_PLATFORMS, createAgentRegistry, declaredModes, protectedPathsWith } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decompressBinary,
  GROK_BINARY_SHA256,
  GROK_DESCRIPTOR,
  GROK_MODE_IDS,
  GROK_PINS,
  GROK_PROJECT_FILES,
  GROK_SHIPPED,
  createGrokAgent,
  createGrokSetup,
  installedGrok,
  installGrok,
  pinnedGrokVersion,
  type NpmRunner,
} from '../src/index.js';

const FAKE_GROK = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-grok.mjs');
const PLATFORM = `${process.platform}-${process.arch}`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

describe("Grok's descriptor (epic 12 entry 4)", () => {
  it('has no problem and describes the adapter as it is', () => {
    expect(agentDescriptorProblems(GROK_DESCRIPTOR)).toEqual([]);
    const agent = createGrokAgent({ dataDir: '/nowhere' });
    expect(GROK_DESCRIPTOR.displayName).toBe(agent.displayName);
    expect(declaredModes(GROK_DESCRIPTOR)).toEqual(agent.permissionModes);
    // Ask is the default and Skip all is `yoloMode`; Auto (`autoMode`) is not offered.
    expect(GROK_DESCRIPTOR.permissionModes).toEqual({ ask: GROK_MODE_IDS.ask, skip_all: GROK_MODE_IDS.skipAll });
    expect(GROK_DESCRIPTOR.install).toMatchObject({ kind: 'npm', package: '@xai-official/grok', version: '1.0.49' });
    expect(GROK_DESCRIPTOR.homeEnv).toBe('GROK_HOME');
    expect(GROK_DESCRIPTOR.modeFixedAtStart).toBe(true);
    expect(agent.modeFixedAtStart).toBe(true);
    expect(GROK_DESCRIPTOR.needsProjectTrust).toBe(true);
    expect(GROK_DESCRIPTOR.projectFiles).toEqual(GROK_PROJECT_FILES);
    expect(GROK_DESCRIPTOR.skillsFolder).toBe('.claude/skills');
    expect(() => createAgentRegistry([{ descriptor: GROK_DESCRIPTOR, agent }])).not.toThrow();
  });

  it('is an xAI API access token only, and keeps both xAI key names out of every other process', () => {
    expect(GROK_DESCRIPTOR.signInMethods.map((method) => [method.id, method.kind])).toEqual([['xai.api_key', 'api_key']]);
    expect(agentEnvKeys([GROK_DESCRIPTOR])).toEqual(['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY']);
  });

  it('adds .grok to the protected paths, beside the already protected .agents', () => {
    const paths = protectedPathsWith(GROK_DESCRIPTOR.configFolders);
    expect(paths.folders).toContain('.grok');
    expect(paths.folders).toContain('.agents');
  });

  it('pins the package and its six platform packages, each with its integrity, and every platform binary hash', () => {
    expect(pinnedGrokVersion()).toBe('1.0.49');
    const packages = GROK_PINS.lock.packages;
    for (const platform of AGENT_PLATFORMS) {
      expect(packages[`node_modules/@xai-official/grok-${platform}`]?.optional, platform).toBe(true);
      expect(GROK_BINARY_SHA256[platform], platform).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const [path, entry] of Object.entries(packages)) if (path !== '') expect(entry.integrity, path).toMatch(/^sha512-/);
    expect(GROK_DESCRIPTOR.install).toMatchObject({ binarySha256: GROK_BINARY_SHA256 });
  });

  it('is not registered by a shipped install yet, and its stub is not set up', async () => {
    expect(GROK_SHIPPED).toBe(false);
    expect(installedGrok('/nowhere')).toBeUndefined();
    const agent = createGrokAgent({ dataDir: '/nowhere' });
    await expect(agent.startSession({ cwd: process.cwd(), env: {}, permissionMode: 'ask' } as never)).rejects.toBeInstanceOf(AgentError);
    expect(createGrokSetup().agentId).toBe('grok');
  });
});

/** Packs `content` the way a platform package does: brotli compressed. */
const compressed = (content: string) => brotliCompressSync(Buffer.from(content));
const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');

const FIXTURE_PINS = {
  packageJson: { name: 'fixture', dependencies: { '@xai-official/grok': '1.0.49' } },
  lock: {
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/@xai-official/grok': { version: '1.0.49', integrity: 'sha512-fixture' },
      [`node_modules/@xai-official/grok-${PLATFORM}`]: { version: '1.0.49', integrity: 'sha512-fixture', optional: true },
    },
  },
};

/** An npm that "installs" the fixture package and this platform's compressed binary, as `npm ci` would. */
const fakeNpm = (binary: string): NpmRunner => (input) => {
  const root = join(input.cwd, 'node_modules', '@xai-official', 'grok');
  mkdirSync(join(root, 'bin'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@xai-official/grok', version: '1.0.49' }));
  writeFileSync(join(root, 'bin', 'grok'), '// npm launcher, never run');
  const platformPackage = join(input.cwd, 'node_modules', '@xai-official', `grok-${PLATFORM}`, 'bin');
  mkdirSync(platformPackage, { recursive: true });
  writeFileSync(join(platformPackage, process.platform === 'win32' ? 'grok.exe.br' : 'grok.br'), compressed(binary));
  return { exited: Promise.resolve({ exitCode: 0 }), kill: () => {} };
};

describe("Grok's checked binary install (epic 12 entry 4)", () => {
  it("unpacks this platform's binary itself, checks its SHA-256 and finds only that file", async () => {
    const dataDir = tempDir('ogden-agents-grokdir-');
    const binary = '#!/bin/sh\necho fake grok\n';
    const installed = await installGrok({
      dataDir,
      pins: FIXTURE_PINS,
      runNpm: fakeNpm(binary),
      npmCli: FAKE_GROK,
      onProgress: () => {},
      binarySha256: { [PLATFORM]: sha256(binary) },
    });
    expect(installed.version).toBe('1.0.49');
    expect(installed.path).toContain(join('agents', 'grok', 'grok-1.0.49', 'bin-checked'));
    expect(readFileSync(installed.path, 'utf8')).toBe(binary);
    expect(installedGrok(dataDir, FIXTURE_PINS)?.path).toBe(installed.path);
    // npm's launcher is in the folder but is never the file found.
    expect(existsSync(join(dataDir, 'agents', 'grok', 'grok-1.0.49', 'node_modules', '@xai-official', 'grok', 'bin', 'grok'))).toBe(true);
    // Nothing half installed is left.
    expect(existsSync(join(dataDir, 'agents', 'grok', 'grok-1.0.49', 'bin-checked', 'grok.part'))).toBe(false);
  });

  it('refuses a binary whose SHA-256 does not match, and leaves nothing installed', async () => {
    const dataDir = tempDir('ogden-agents-grokdir-');
    const result = installGrok({
      dataDir,
      pins: FIXTURE_PINS,
      runNpm: fakeNpm('tampered'),
      npmCli: FAKE_GROK,
      onProgress: () => {},
      binarySha256: { [PLATFORM]: sha256('the real one') },
    });
    await expect(result).rejects.toBeInstanceOf(AgentSetupError);
    await expect(result).rejects.toMatchObject({ message: "The download didn't match the expected files, so nothing was installed. Try again." });
    expect(installedGrok(dataDir, FIXTURE_PINS)).toBeUndefined();
    const leftover = existsSync(join(dataDir, 'agents', 'grok')) ? (await import('node:fs')).readdirSync(join(dataDir, 'agents', 'grok')) : [];
    expect(leftover).toEqual([]);
  });

  it('refuses a computer with no pinned binary', async () => {
    const dataDir = tempDir('ogden-agents-grokdir-');
    await expect(
      installGrok({ dataDir, pins: FIXTURE_PINS, runNpm: fakeNpm('x'), npmCli: FAKE_GROK, onProgress: () => {}, binarySha256: {} }),
    ).rejects.toMatchObject({ message: expect.stringContaining('has no build for this computer') });
  });

  it('refuses a binary that decompresses past the bound', async () => {
    const dir = tempDir('ogden-agents-grokbomb-');
    const source = join(dir, 'big.br');
    writeFileSync(source, compressed('x'.repeat(10_000)));
    await expect(decompressBinary(source, join(dir, 'out'), 1_000)).rejects.toThrow('too_large');
    expect(existsSync(join(dir, 'out'))).toBe(false);
    expect(await decompressBinary(source, join(dir, 'ok'), 20_000)).toBe(sha256('x'.repeat(10_000)));
  });
});

/** Sends `initialize` to the fake Grok personality and returns its answer. */
function initialize(): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FAKE_GROK], { stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: process.env.PATH ?? '' } });
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

describe("the fake agent's Grok personality", () => {
  it('answers initialize as spike 12.2 recorded: only grok.com advertised, list, resume, load and close', async () => {
    const result = await initialize();
    expect(result.agentInfo).toMatchObject({ name: 'grok', version: '1.0.49' });
    expect(result.agentCapabilities.loadSession).toBe(true);
    expect(result.agentCapabilities.sessionCapabilities).toMatchObject({ list: {}, resume: {}, close: {} });
    expect(result.authMethods.map((method: { id: string }) => method.id)).toEqual(['grok.com']);
    expect(result._meta).toBeUndefined();
  });
});
