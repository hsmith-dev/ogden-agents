/**
 * Packaging guard: the root `ogden-agents` package is the only publishable
 * artifact. After `pnpm build` (which `pnpm test` runs first), every bare
 * import in the bundled server must be a Node builtin or a root `dependencies`
 * entry, and the packed tarball must hold only the built files and the
 * vendored forks (AD-13).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');

interface RootManifest {
  dependencies?: Record<string, string>;
}

/** `from '…'`, `import '…'`, `import('…')`, `export … from '…'`, `require('…')`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g;

/** The package a bare specifier belongs to: `@scope/name` or `name`. */
export function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

function isBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || builtinModules.includes(packageOf(specifier));
}

/** Returns one message per bare import whose package is not a root dependency. */
export function findUndeclaredImports(
  files: ReadonlyArray<{ path: string; source: string }>,
  dependencies: Readonly<Record<string, string>>,
): string[] {
  const problems = new Set<string>();
  for (const { path, source } of files) {
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[2]!;
      if (specifier.startsWith('.') || specifier.startsWith('/') || isBuiltin(specifier)) continue;
      const pkg = packageOf(specifier);
      if (!(pkg in dependencies)) {
        problems.add(`${path} imports "${specifier}", but "${pkg}" is not in the root package's dependencies`);
      }
    }
  }
  return [...problems];
}

/** Workspace packages whose code is bundled into `dist/server.js`. */
const BUNDLED_PACKAGES = ['server', 'core', 'adapters', 'shared'] as const;

interface WorkspaceManifest {
  name: string;
  dependencies?: Record<string, string>;
}

/**
 * Returns one message per third-party runtime dependency of a bundled
 * workspace package whose range is not declared identically in the root
 * `dependencies`, since the root range is what an installed package resolves.
 */
export function findRangeMismatches(
  manifests: readonly WorkspaceManifest[],
  rootDeps: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  for (const { name, dependencies = {} } of manifests) {
    for (const [dep, range] of Object.entries(dependencies)) {
      if (dep.startsWith('@ogden-agents/') || range.startsWith('workspace:')) continue;
      if (rootDeps[dep] !== range) {
        problems.push(
          `${name} depends on ${dep}@${range}, but the root package declares ${dep}@${rootDeps[dep] ?? '(nothing)'}`,
        );
      }
    }
  }
  return problems;
}

function loadBundledManifests(): WorkspaceManifest[] {
  return BUNDLED_PACKAGES.map(
    (dir) => JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8')) as WorkspaceManifest,
  );
}

/** The server bundle and any chunks next to it (the UI in `dist/web` is browser code). */
function loadServerBundle() {
  return readdirSync(DIST)
    .filter((name) => /\.m?js$/.test(name))
    .map((name) => ({ path: `dist/${name}`, source: readFileSync(join(DIST, name), 'utf8') }));
}

function rootDependencies(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as RootManifest;
  return manifest.dependencies ?? {};
}

/** The bmad-loop wheel `forks.lock` pins, such as `vendor/bmad-loop/bmad_loop-0.13.0-py3-none-any.whl`. */
function lockedWheel(): string {
  const lock = JSON.parse(readFileSync(join(ROOT, 'forks.lock'), 'utf8')) as { forks: Record<string, { vendored: string }> };
  const wheel = lock.forks['bmad-loop']!.vendored;
  expect(wheel).toMatch(/^vendor\/bmad-loop\/bmad_loop-.+\.whl$/);
  return wheel;
}

/**
 * Files git tracks (or would track) under `vendor/`, as repo-relative POSIX
 * paths. Ignored files such as `.DS_Store` are left out.
 */
function vendoredFiles(): string[] {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'vendor'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`git ls-files failed (${result.status}): ${result.stderr}`);
  return [...new Set(result.stdout.split('\0').filter(Boolean))].sort();
}

/** Paths `pnpm pack` would put in the tarball. */
function packedFiles(): string[] {
  const result = spawnSync('pnpm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    // `pnpm` is a `.cmd` shim on Windows, which only runs through a shell.
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`pnpm pack --dry-run failed (${result.status}): ${result.stderr}${result.stdout}`);
  }
  const json = result.stdout.slice(result.stdout.indexOf('{'));
  const report = JSON.parse(json) as { files: Array<{ path: string }> };
  return report.files.map((f) => f.path.replaceAll('\\', '/'));
}

describe('packaging', () => {
  it('the server bundle imports only Node builtins and declared root dependencies', () => {
    const files = loadServerBundle();
    expect(files.map((f) => f.path)).toContain('dist/server.js');
    expect(findUndeclaredImports(files, rootDependencies())).toEqual([]);
  });

  it('the server bundle contains no workspace package imports', () => {
    for (const { source } of loadServerBundle()) expect(source).not.toMatch(/['"]@ogden-agents\//);
  });

  it('flags an undeclared import by package name', () => {
    const files = [
      {
        path: 'dist/server.js',
        source: [
          "import { Hono } from 'hono';",
          "import { readFileSync } from 'node:fs';",
          "import path from 'path';",
          "import { x } from './chunk.js';",
          "import Database from 'better-sqlite3';",
          "export { y } from '@scope/pkg/sub';",
          "const lazy = await import('left-pad');",
        ].join('\n'),
      },
    ];
    expect(findUndeclaredImports(files, { hono: '^4' })).toEqual([
      'dist/server.js imports "better-sqlite3", but "better-sqlite3" is not in the root package\'s dependencies',
      'dist/server.js imports "@scope/pkg/sub", but "@scope/pkg" is not in the root package\'s dependencies',
      'dist/server.js imports "left-pad", but "left-pad" is not in the root package\'s dependencies',
    ]);
  });

  it('every third-party dependency of a bundled package is declared by the root with the same range', () => {
    expect(findRangeMismatches(loadBundledManifests(), rootDependencies())).toEqual([]);
  });

  it('flags a range that differs from the root, or a dependency the root lacks', () => {
    const manifests: WorkspaceManifest[] = [
      { name: '@ogden-agents/server', dependencies: { '@ogden-agents/core': 'workspace:*', hono: '^4.14.0', ws: '^8.22.0' } },
      { name: '@ogden-agents/shared', dependencies: { zod: '^4.6.5' } },
    ];
    expect(findRangeMismatches(manifests, { hono: '^4.13.11', ws: '^8.22.0' })).toEqual([
      '@ogden-agents/server depends on hono@^4.14.0, but the root package declares hono@^4.13.11',
      '@ogden-agents/shared depends on zod@^4.6.5, but the root package declares zod@(nothing)',
    ]);
  });

  it('the root, server and web packages share one version (the launcher, server and UI compare it; AD-20)', () => {
    const versionOf = (path: string) => (JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as { version: string }).version;
    const root = versionOf('package.json');
    expect(versionOf('packages/server/package.json')).toBe(root);
    expect(versionOf('packages/web/package.json')).toBe(root);
  });

  it('the tarball holds the launcher, the bundle, the UI and the vendored forks, and no workspace sources', () => {
    const files = packedFiles();
    expect(files).toEqual(
      expect.arrayContaining([
        'bin/ogden.js',
        'dist/server.js',
        'dist/serve.js',
        'dist/launcher.js',
        'dist/web/index.html',
        'package.json',
        'README.md',
        'LICENSE',
        'vendor/bmad-method/skills/bmod-method/bmod.toml',
        lockedWheel(),
      ]),
    );
    // Exactly the vendored files ship: every one git lists, and nothing else under vendor/.
    expect(files.filter((f) => f.startsWith('vendor/')).sort()).toEqual(vendoredFiles());
    expect(files.filter((f) => f.startsWith('packages/'))).toEqual([]);
    expect(files.filter((f) => !/^(bin|dist|vendor)\//.test(f) && !['package.json', 'README.md', 'LICENSE'].includes(f))).toEqual([]);
  });
});
