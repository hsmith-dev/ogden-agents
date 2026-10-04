/**
 * AD-1 enforcement: every internal dependency edge declared in a workspace
 * `package.json` must appear in the architecture's dependency diagram.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

/** The root package is the `bin/ogden-agents` launcher. */
const ROOT_NAME = 'ogden-agents';

/** AD-1: package -> internal packages it may depend on. */
export const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  [ROOT_NAME]: ['@ogden-agents/server'],
  '@ogden-agents/server': ['@ogden-agents/core', '@ogden-agents/adapters', '@ogden-agents/shared'],
  '@ogden-agents/adapters': ['@ogden-agents/core', '@ogden-agents/shared'],
  '@ogden-agents/core': ['@ogden-agents/shared'],
  '@ogden-agents/web': ['@ogden-agents/shared'],
  '@ogden-agents/shared': [],
};

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

interface Manifest {
  name?: string;
  [field: string]: unknown;
}

interface LoadedManifest {
  path: string;
  manifest: Manifest;
}

export function loadWorkspaceManifests(root: string = ROOT): LoadedManifest[] {
  const read = (path: string): LoadedManifest => ({
    path,
    manifest: JSON.parse(readFileSync(path, 'utf8')) as Manifest,
  });
  const packagesDir = join(root, 'packages');
  const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name, 'package.json'));
  return [read(join(root, 'package.json')), ...packageDirs.map(read)];
}

/** Returns one message per dependency edge that AD-1 does not allow. */
export function findViolations(manifests: readonly LoadedManifest[]): string[] {
  const internal = new Set(manifests.map((m) => m.manifest.name).filter((n): n is string => !!n));
  const violations: string[] = [];

  for (const { path, manifest } of manifests) {
    const name = manifest.name;
    if (name === undefined || !(name in ALLOWED)) {
      violations.push(`${path}: package "${name ?? '<unnamed>'}" is not part of the AD-1 diagram`);
      continue;
    }
    const allowed = new Set(ALLOWED[name]);
    for (const field of DEPENDENCY_FIELDS) {
      const deps = (manifest[field] ?? {}) as Record<string, string>;
      for (const [dep, spec] of Object.entries(deps)) {
        const isInternal = internal.has(dep) || dep.startsWith('@ogden-agents/') || dep === ROOT_NAME || spec.startsWith('workspace:');
        if (isInternal && !allowed.has(dep)) {
          violations.push(`${name} -> ${dep} (${field}) is not allowed by AD-1`);
        }
      }
    }
  }
  return violations;
}

interface SourceFile {
  /** Owning package name. */
  pkg: string;
  path: string;
  source: string;
}

/** `from '…'`, `import '…'`, `import('…')`, `export … from '…'`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g;

/** Loads `src/**\/*.{ts,tsx}` of every workspace package. */
export function loadWorkspaceSources(root: string = ROOT): SourceFile[] {
  const files: SourceFile[] = [];
  for (const { path, manifest } of loadWorkspaceManifests(root)) {
    if (manifest.name === undefined || manifest.name === ROOT_NAME) continue;
    const srcDir = join(path, '..', 'src');
    let entries: string[];
    try {
      entries = readdirSync(srcDir, { recursive: true, encoding: 'utf8' });
    } catch {
      continue;
    }
    for (const entry of entries.filter((e) => /\.tsx?$/.test(e))) {
      const file = join(srcDir, entry);
      files.push({ pkg: manifest.name, path: relative(root, file), source: readFileSync(file, 'utf8') });
    }
  }
  return files;
}

/** Returns one message per `@ogden-agents/*` import that AD-1 does not allow. */
export function findImportViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { pkg, path, source } of files) {
    const allowed = new Set(ALLOWED[pkg] ?? []);
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[2]!;
      if (!specifier.startsWith('@ogden-agents/')) continue;
      const target = specifier.split('/').slice(0, 2).join('/');
      if (target !== pkg && !allowed.has(target)) {
        violations.push(`${path}: ${pkg} imports ${specifier}, which AD-1 does not allow`);
      }
    }
  }
  return violations;
}

/**
 * Every agent id Ogden Agents registers, or has planned (epic 6, v1.1, v2),
 * and the tests' second agent. AD-1 (epic 6 note): `packages/core` and
 * `packages/shared` name none of them outside tests; server wiring does.
 */
export const AGENT_IDS = ['claude-code', 'antigravity', 'codex', 'grok', 'gemini', 'gemini-cli', 'copilot', 'fake-agent'] as const;

/**
 * The environment variables one agent reads (its API key, its home folder),
 * for the agents above (spikes 6.1, 12.1, 12.2). AD-1 (6.3): they come from
 * each agent's descriptor, so core and shared name none outside comments;
 * `AGENT_ENV_KEYS` and home folders are derived, never listed in core.
 */
export const AGENT_ENV_NAMES = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_EXECUTABLE',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CODEX_HOME',
  'XAI_API_KEY',
  'GROK_CODE_XAI_API_KEY',
  'GROK_HOME',
  'GEMINI_API_KEY',
  'GEMINI_HOME',
] as const;

/** The packages that must name no agent id. */
const AGENT_NEUTRAL = new Set(['@ogden-agents/core', '@ogden-agents/shared']);

/** `source` without its comments (block and line), so doc comments may still name an agent as an example. */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** One message per string literal in core or shared code that names an agent id, and (6.3) per mention of an agent's own environment variable. */
export function findAgentIdViolations(files: readonly SourceFile[], ids: readonly string[] = AGENT_IDS, envNames: readonly string[] = AGENT_ENV_NAMES): string[] {
  const named = new RegExp(`(['"\`])[^'"\`\\n]*?(?<![a-z0-9-])(${ids.join('|')})(?![a-z0-9-])[^'"\`\\n]*?\\1`, 'g');
  // Anywhere in the code, not only in strings: `process.env.X` or `{ X: … }` names it too.
  const env = new RegExp(`(?<![A-Za-z0-9_])(${envNames.join('|')})(?![A-Za-z0-9_])`, 'g');
  const violations: string[] = [];
  for (const { pkg, path, source } of files) {
    if (!AGENT_NEUTRAL.has(pkg)) continue;
    const code = withoutComments(source);
    for (const match of code.matchAll(named)) violations.push(`${path}: ${pkg} names the agent id ${match[2]} (AD-1: only server wiring does)`);
    for (const match of code.matchAll(env)) violations.push(`${path}: ${pkg} names the agent variable ${match[1]} (AD-1: it comes from the agent's descriptor)`);
  }
  return violations;
}

describe('AD-1: core and shared name no agent (epic 6)', () => {
  it('no core or shared source names an agent id outside tests', () => {
    const files = loadWorkspaceSources();
    expect(files.some((file) => file.pkg === '@ogden-agents/core')).toBe(true);
    expect(findAgentIdViolations(files)).toEqual([]);
  });

  it('flags an agent id in core or shared code, but not in a comment, another package, or a longer id', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/core', path: 'core/a.ts', source: "const id = 'claude-code';\n// the default is 'codex'\n/** e.g. `grok` */" },
      { pkg: '@ogden-agents/shared', path: 'shared/b.ts', source: 'const label = `use antigravity here`;\nconst other = "claude-code-x";' },
      { pkg: '@ogden-agents/server', path: 'server/c.ts', source: "const id = 'claude-code';" },
    ];
    expect(findAgentIdViolations(files)).toEqual([
      'core/a.ts: @ogden-agents/core names the agent id claude-code (AD-1: only server wiring does)',
      'shared/b.ts: @ogden-agents/shared names the agent id antigravity (AD-1: only server wiring does)',
    ]);
  });

  it("flags an agent's own environment variable in core or shared code (6.3), but not in a comment or another package", () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/core', path: 'core/a.ts', source: "const home = { CODEX_HOME: dir };\nconst keys = ['ANTHROPIC_API_KEY'];\n// GROK_HOME is set by wiring" },
      { pkg: '@ogden-agents/shared', path: 'shared/b.ts', source: 'const hint = `set XAI_API_KEY first`;\nconst other = "MY_GEMINI_HOME_X";' },
      { pkg: '@ogden-agents/adapters', path: 'adapters/c.ts', source: "const name = 'GEMINI_API_KEY';" },
    ];
    expect(findAgentIdViolations(files)).toEqual([
      'core/a.ts: @ogden-agents/core names the agent variable CODEX_HOME (AD-1: it comes from the agent\'s descriptor)',
      'core/a.ts: @ogden-agents/core names the agent variable ANTHROPIC_API_KEY (AD-1: it comes from the agent\'s descriptor)',
      'shared/b.ts: @ogden-agents/shared names the agent variable XAI_API_KEY (AD-1: it comes from the agent\'s descriptor)',
    ]);
  });
});

/** Where the shared ACP client lives (6.4): it names no agent and imports no agent's adapter. */
const ACP_BASE = /(^|[\\/])packages[\\/]adapters[\\/]src[\\/]acp-base[\\/]/;

/** Agent products and makers the shared ACP client must not name (any case). */
const AGENT_WORDS = /claude|anthropic|antigravity|gemini|google|codex|openai|grok|xai|copilot/gi;

/** One message per agent name, agent variable or agent-adapter import in `acp-base` code (comments aside). */
export function findAcpBaseViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!ACP_BASE.test(path)) continue;
    const code = withoutComments(source);
    for (const match of code.matchAll(AGENT_WORDS)) violations.push(`${path}: the shared ACP client names ${match[0]} (E6-R3: agents supply a descriptor and quirks)`);
    for (const name of AGENT_ENV_NAMES) if (new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(code)) violations.push(`${path}: the shared ACP client names the agent variable ${name}`);
    for (const match of source.matchAll(SPECIFIER)) {
      if (/^\.\.\/(?:acp-(?!base\/)|setup-)/.test(match[2]!)) violations.push(`${path}: the shared ACP client imports ${match[2]} (an agent's own adapter)`);
    }
  }
  return violations;
}

describe('E6-R3: the shared ACP client names no agent (6.4)', () => {
  it('no acp-base source names an agent, an agent variable, or imports an agent adapter', () => {
    const files = loadWorkspaceSources();
    expect(files.some((file) => ACP_BASE.test(file.path))).toBe(true);
    expect(findAcpBaseViolations(files)).toEqual([]);
  });

  it('flags a planted agent name, variable or adapter import in acp-base, but not in a comment or another folder', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/acp-base/a.ts', source: "const name = 'Claude Code';\n// like Antigravity\nconst key = env.GEMINI_API_KEY;" },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/acp-base/b.ts', source: "import { x } from '../acp-claude-code/x.js';\nimport { y } from './mask.js';" },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/acp-claude-code/c.ts', source: "const name = 'Claude Code';" },
    ];
    expect(findAcpBaseViolations(files)).toEqual([
      'packages/adapters/src/acp-base/a.ts: the shared ACP client names Claude (E6-R3: agents supply a descriptor and quirks)',
      'packages/adapters/src/acp-base/a.ts: the shared ACP client names GEMINI (E6-R3: agents supply a descriptor and quirks)',
      'packages/adapters/src/acp-base/a.ts: the shared ACP client names the agent variable GEMINI_API_KEY',
      'packages/adapters/src/acp-base/b.ts: the shared ACP client names claude (E6-R3: agents supply a descriptor and quirks)',
      'packages/adapters/src/acp-base/b.ts: the shared ACP client imports ../acp-claude-code/x.js (an agent\'s own adapter)',
    ]);
  });
});

describe('AD-1 package dependency rules', () => {
  it('every workspace package follows the diagram', () => {
    const manifests = loadWorkspaceManifests();
    expect(manifests.map((m) => m.manifest.name).sort()).toEqual(Object.keys(ALLOWED).sort());
    expect(findViolations(manifests)).toEqual([]);
  });

  it('flags a forbidden edge', () => {
    const manifests: LoadedManifest[] = [
      { path: 'web', manifest: { name: '@ogden-agents/web', dependencies: { '@ogden-agents/core': 'workspace:*' } } },
      { path: 'core', manifest: { name: '@ogden-agents/core', devDependencies: { '@ogden-agents/server': 'workspace:*' } } },
      { path: 'root', manifest: { name: ROOT_NAME, dependencies: { '@ogden-agents/shared': 'workspace:*' } } },
    ];
    expect(findViolations(manifests)).toEqual([
      '@ogden-agents/web -> @ogden-agents/core (dependencies) is not allowed by AD-1',
      '@ogden-agents/core -> @ogden-agents/server (devDependencies) is not allowed by AD-1',
      'ogden-agents -> @ogden-agents/shared (dependencies) is not allowed by AD-1',
    ]);
  });

  it('every source import follows the diagram', () => {
    const files = loadWorkspaceSources();
    expect(files.length).toBeGreaterThan(0);
    expect(findImportViolations(files)).toEqual([]);
  });

  it('flags a forbidden source import even when package.json does not declare it', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/web', path: 'web/a.tsx', source: "import { start } from '@ogden-agents/server';" },
      { pkg: '@ogden-agents/core', path: 'core/b.ts', source: "export * from '@ogden-agents/adapters/sub';\nconst x = import(\"@ogden-agents/server\");" },
      { pkg: '@ogden-agents/core', path: 'core/c.ts', source: "import type { CoreEvent } from '@ogden-agents/shared';" },
    ];
    expect(findImportViolations(files)).toEqual([
      'web/a.tsx: @ogden-agents/web imports @ogden-agents/server, which AD-1 does not allow',
      'core/b.ts: @ogden-agents/core imports @ogden-agents/adapters/sub, which AD-1 does not allow',
      'core/b.ts: @ogden-agents/core imports @ogden-agents/server, which AD-1 does not allow',
    ]);
  });

  it('flags a package that is not in the diagram', () => {
    expect(findViolations([{ path: 'x', manifest: { name: '@ogden-agents/extra' } }])).toEqual([
      'x: package "@ogden-agents/extra" is not part of the AD-1 diagram',
    ]);
  });
});
