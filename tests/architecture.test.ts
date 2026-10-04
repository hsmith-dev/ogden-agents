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
export const AGENT_IDS = ['claude-code', 'antigravity', 'codex', 'grok', 'gemini-cli', 'copilot', 'fake-agent'] as const;

/** The packages that must name no agent id. */
const AGENT_NEUTRAL = new Set(['@ogden-agents/core', '@ogden-agents/shared']);

/** `source` without its comments (block and line), so doc comments may still name an agent as an example. */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** One message per string literal in core or shared code that names an agent id. */
export function findAgentIdViolations(files: readonly SourceFile[], ids: readonly string[] = AGENT_IDS): string[] {
  const named = new RegExp(`(['"\`])[^'"\`\\n]*?(?<![a-z0-9-])(${ids.join('|')})(?![a-z0-9-])[^'"\`\\n]*?\\1`, 'g');
  const violations: string[] = [];
  for (const { pkg, path, source } of files) {
    if (!AGENT_NEUTRAL.has(pkg)) continue;
    for (const match of withoutComments(source).matchAll(named)) violations.push(`${path}: ${pkg} names the agent id ${match[2]} (AD-1: only server wiring does)`);
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
