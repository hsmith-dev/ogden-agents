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
  // The desktop shell and its build scripts (epic 13): Rust and Node scripts that build and run the packed server; no source imports.
  '@ogden-agents/desktop': [],
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
  'OPENCODE_CONFIG',
  'OGDEN_ENDPOINT_KEY',
] as const;

/** The packages that must name no agent id. */
const AGENT_NEUTRAL = new Set(['@ogden-agents/core', '@ogden-agents/shared']);

/** `source` without its comments (block and line), so doc comments may still name an agent as an example. */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** One message per string literal in core or shared code that names an agent id, and (6.3) per mention of an agent's own environment variable. */
export function findAgentIdViolations(files: readonly SourceFile[], ids: readonly string[] = AGENT_IDS, envNames: readonly string[] = AGENT_ENV_NAMES): string[] {
  // A dot-folder name (`.gemini` at a literal's start or after `/`) is a config folder, not an agent id (the protected names, epic 6 entry 5).
  const named = new RegExp(`(['"\`])[^'"\`\\n]*?(?<![a-z0-9-])(?<!['"\`/]\\.)(${ids.join('|')})(?![a-z0-9-])[^'"\`\\n]*?\\1`, 'g');
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
  it("core, shared and the web never use the string 'local' as an agent id (epic 14; a longer name such as local_endpoints is not one)", () => {
    const violations = loadWorkspaceSources().filter((file) => (AGENT_NEUTRAL.has(file.pkg) || WEB_SOURCE.test(file.path)) && /(['"`])local\1/.test(withoutComments(file.source))).map((file) => file.path);
    expect(violations).toEqual([]);
  });


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
      { pkg: '@ogden-agents/core', path: 'core/d.ts', source: "const folders = ['.gemini', '.agents', 'x/.gemini/y'];\nconst id = 'gemini';\nconst other = 'x.antigravity';" },
    ];
    expect(findAgentIdViolations(files)).toEqual([
      'core/a.ts: @ogden-agents/core names the agent id claude-code (AD-1: only server wiring does)',
      'shared/b.ts: @ogden-agents/shared names the agent id antigravity (AD-1: only server wiring does)',
      'core/d.ts: @ogden-agents/core names the agent id gemini (AD-1: only server wiring does)',
      'core/d.ts: @ogden-agents/core names the agent id antigravity (AD-1: only server wiring does)',
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

/** The web's own code (epic 6, entry 6): it names each agent from the agent list, never from a constant. */
const WEB_SOURCE = /(^|[\\/])packages[\\/]web[\\/]src[\\/]/;

/** One message per `AGENT_NAME`/`AGENT_ID` constant, agent id literal or agent product name in web code (comments aside). */
export function findWebAgentConstants(files: readonly SourceFile[], ids: readonly string[] = AGENT_IDS): string[] {
  const named = new RegExp(`(['"\`])[^'"\`\\n]*?(?<![a-z0-9-])(${ids.join('|')})(?![a-z0-9-])[^'"\`\\n]*?\\1`, 'g');
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!WEB_SOURCE.test(path)) continue;
    const code = withoutComments(source);
    for (const match of code.matchAll(/(?<![A-Za-z0-9_])AGENT_(NAME|ID)(?![A-Za-z0-9_])/g)) violations.push(`${path}: the web names the agent through the constant ${match[0]} (entry 6: use the agent list)`);
    for (const match of code.matchAll(named)) violations.push(`${path}: the web names the agent id ${match[2]} (entry 6: use the agent list)`);
    for (const match of code.matchAll(/Claude Code|Anthropic/g)) violations.push(`${path}: the web names ${match[0]} in code (entry 6: use the agent list)`);
  }
  return violations;
}

describe('E6-R2: the web names agents from the agent list (entry 6)', () => {
  it('no web source keeps an AGENT_NAME or AGENT_ID constant, an agent id, or an agent product name', () => {
    const files = loadWorkspaceSources();
    expect(files.some((file) => WEB_SOURCE.test(file.path))).toBe(true);
    expect(findWebAgentConstants(files)).toEqual([]);
  });

  it('flags a planted constant, id or name in web code, but not in a comment, a longer name, or another package', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/web', path: 'packages/web/src/a.ts', source: "export const AGENT_NAME = 'Claude Code';\n// AGENT_ID was here\nconst x = UNKNOWN_AGENT_NAME;" },
      { pkg: '@ogden-agents/web', path: 'packages/web/src/b.tsx', source: "const id = 'claude-code';" },
      { pkg: '@ogden-agents/server', path: 'packages/server/src/c.ts', source: "const AGENT_ID = 'claude-code';" },
    ];
    expect(findWebAgentConstants(files)).toEqual([
      'packages/web/src/a.ts: the web names the agent through the constant AGENT_NAME (entry 6: use the agent list)',
      'packages/web/src/a.ts: the web names Claude Code in code (entry 6: use the agent list)',
      'packages/web/src/b.tsx: the web names the agent id claude-code (entry 6: use the agent list)',
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
      if (/^(?:\.\.\/)+(?:acp-(?!base\/)|setup-|index\.js$)|^(?:\.\.\/)+src\/|^@ogden-agents\/adapters(?:\/|$)/.test(match[2]!)) violations.push(`${path}: the shared ACP client imports ${match[2]} (an agent's own adapter)`);
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
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/acp-base/d.ts', source: "import { a } from '../index.js';\nimport { b } from '@ogden-agents/adapters';" },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/acp-claude-code/c.ts', source: "const name = 'Claude Code';" },
    ];
    expect(findAcpBaseViolations(files)).toEqual([
      'packages/adapters/src/acp-base/a.ts: the shared ACP client names Claude (E6-R3: agents supply a descriptor and quirks)',
      'packages/adapters/src/acp-base/a.ts: the shared ACP client names GEMINI (E6-R3: agents supply a descriptor and quirks)',
      'packages/adapters/src/acp-base/a.ts: the shared ACP client names the agent variable GEMINI_API_KEY',
      'packages/adapters/src/acp-base/b.ts: the shared ACP client names claude (E6-R3: agents supply a descriptor and quirks)',
      'packages/adapters/src/acp-base/b.ts: the shared ACP client imports ../acp-claude-code/x.js (an agent\'s own adapter)',
      'packages/adapters/src/acp-base/d.ts: the shared ACP client imports ../index.js (an agent\'s own adapter)',
      'packages/adapters/src/acp-base/d.ts: the shared ACP client imports @ogden-agents/adapters (an agent\'s own adapter)',
    ]);
  });
});

/**
 * E14-R1 (epic 14): core, shared, the shared ACP client and the web name neither
 * Ollama, LM Studio nor the route's harness. They come from the Local model's own
 * adapter and descriptor (the presets are data the server serves).
 */
const LOCAL_MODEL_WORDS = /ollama|lm[ -]?studio|opencode/gi;
const LOCAL_MODEL_NEUTRAL = /(^|[\\/])packages[\\/](?:core|shared|web)[\\/]src[\\/]|(^|[\\/])packages[\\/]adapters[\\/]src[\\/]acp-base[\\/]/;

/** One message per local server or harness name in neutral code (comments aside). */
export function findLocalModelNameViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!LOCAL_MODEL_NEUTRAL.test(path)) continue;
    for (const match of withoutComments(source).matchAll(LOCAL_MODEL_WORDS)) violations.push(`${path}: neutral code names ${match[0]} (E14-R1: it comes from the Local model's adapter and descriptor)`);
  }
  return violations;
}

describe('E14-R1: core, shared, the shared ACP client and the web name no local server or harness (epic 14)', () => {
  it('no neutral source names Ollama, LM Studio or the route\'s harness', () => {
    const files = loadWorkspaceSources();
    for (const area of ['core', 'shared', 'web', 'acp-base']) expect(files.some((file) => (area === 'acp-base' ? ACP_BASE.test(file.path) : file.path.split('\\').join('/').includes(`packages/${area}/src/`))), area).toBe(true);
    expect(findLocalModelNameViolations(files)).toEqual([]);
  });

  it('flags a planted name, but not in a comment, in adapters, or in the server', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/core', path: 'packages/core/src/a.ts', source: "const url = 'http://localhost:11434'; // Ollama\nconst label = 'LM Studio';" },
      { pkg: '@ogden-agents/shared', path: 'packages/shared/src/b.ts', source: 'const kind = `lmstudio`;' },
      { pkg: '@ogden-agents/web', path: 'packages/web/src/c.tsx', source: "const harness = 'OpenCode';" },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/acp-base/d.ts', source: "const x = 'opencode';" },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/acp-opencode/e.ts', source: "const x = 'OpenCode';" },
      { pkg: '@ogden-agents/server', path: 'packages/server/src/f.ts', source: "const x = 'Ollama';" },
    ];
    expect(findLocalModelNameViolations(files)).toEqual([
      "packages/core/src/a.ts: neutral code names LM Studio (E14-R1: it comes from the Local model's adapter and descriptor)",
      "packages/shared/src/b.ts: neutral code names lmstudio (E14-R1: it comes from the Local model's adapter and descriptor)",
      "packages/web/src/c.tsx: neutral code names OpenCode (E14-R1: it comes from the Local model's adapter and descriptor)",
      "packages/adapters/src/acp-base/d.ts: neutral code names opencode (E14-R1: it comes from the Local model's adapter and descriptor)",
    ]);
  });
});

/**
 * AD-16 (epic 6 entry 10): every child process Ogden Agents starts gets an
 * explicit environment built from the allowlist (`adapters/src/child-env.ts`;
 * an agent's own from its descriptor). A call to a `node:child_process`
 * function, or to a loaded `node-pty`'s `spawn`, must pass `env`, and must not
 * pass `process.env` (wholesale or spread). The `open` package starts its
 * opener with the whole `process.env`, so only `open-url.ts` loads it, in a
 * child of its own with the allowlist.
 */
const SPAWN_EXEMPT: Readonly<Record<string, { marker: string; why: string }>> = {
  // The launcher starts the server itself: Ogden, not a helper. A key exported in the user's
  // shell is the server's documented "key in this server's environment" (story 9.2), which
  // core's precedence rule hands only to that agent's own process. Only the call that sets
  // the server's data folder is exempt; any other spawn there is checked.
  'packages/server/src/launcher.ts:spawn': { marker: '[DATA_DIR_ENV]: dataDir', why: 'the background server is Ogden itself' },
};
const CHILD_PROCESS_FUNCTIONS = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']);

/** The text of the call whose `(` is at `open` in `code`, to its matching `)`. */
function callText(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')' && (depth -= 1) === 0) return code.slice(open, i + 1);
  }
  return code.slice(open);
}

/** One message per spawn without its own environment, or with `process.env`, and per `open` import outside `open-url.ts`. */
export function findSpawnEnvViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    const file = path.split('\\').join('/');
    const code = withoutComments(source);
    const names = new Set<string>();
    for (const match of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g)) {
      for (const part of match[1]!.split(',')) {
        const [imported, local] = part.replace(/\btype\s+/, '').trim().split(/\s+as\s+/);
        if (imported !== undefined && CHILD_PROCESS_FUNCTIONS.has(imported)) names.add((local ?? imported).trim());
      }
    }
    // Every load of child_process must be a plain named import, so the check below sees each call:
    // no namespace, default, mixed, dynamic or require() load.
    const loads = [...code.matchAll(/['"](?:node:)?child_process['"]/g)].length;
    const named = [...code.matchAll(/import\s*\{[^}]*\}\s*from\s*['"](?:node:)?child_process['"]/g)].length;
    if (loads > named) violations.push(`${file}: loads node:child_process other than by named import; import its functions by name so the AD-16 check sees each spawn`);
    const calls: { callee: string; at: number }[] = [];
    for (const name of names) for (const match of code.matchAll(new RegExp(`(?<![\\w.])${name}\\s*\\(`, 'g'))) calls.push({ callee: name, at: match.index! + match[0].length - 1 });
    // A loaded node-pty: `pty.spawn(` (terminal-pty).
    for (const match of code.matchAll(/\bpty\.spawn\s*\(/g)) calls.push({ callee: 'pty.spawn', at: match.index! + match[0].length - 1 });
    for (const { callee, at } of calls) {
      const text = callText(code, at);
      const exempt = SPAWN_EXEMPT[`${file}:${callee}`];
      if (exempt !== undefined && text.includes(exempt.marker)) continue;
      if (/process\.env\b/.test(text)) violations.push(`${file}: ${callee}(…) passes process.env (AD-16: build its environment from the allowlist)`);
      else if (!/\benv\s*[:,}]/.test(text)) violations.push(`${file}: ${callee}(…) passes no env, so it inherits the whole process.env (AD-16)`);
    }
    if (!file.endsWith('packages/server/src/open-url.ts') && /(?:from\s*|import\s*\(\s*)['"]open['"]/.test(code)) {
      violations.push(`${file}: loads the open package, which starts its opener with the whole process.env (AD-16: use openUrl)`);
    }
  }
  return violations;
}

describe('AD-16: no child process inherits the whole server environment (epic 6 entry 10)', () => {
  it('every spawn in packages/ passes its own env, never process.env', () => {
    const files = loadWorkspaceSources();
    expect(files.some((file) => file.path.split('\\').join('/').endsWith('adapters/src/process-tree.ts'))).toBe(true);
    expect(findSpawnEnvViolations(files)).toEqual([]);
  });

  it('flags a spawn with process.env (wholesale or spread), with no env, a load other than a named import, open outside open-url.ts, and a second launcher spawn; not a comment or the server\'s own start', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/a.ts', source: "import { spawn } from 'node:child_process';\nspawn('x', [], { env: process.env });" },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/b.ts', source: "import { execFile as run, type ExecFileOptions } from 'child_process';\nrun('x', [], { env: { ...process.env, A: '1' } }, () => {});" },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/c.ts', source: "import { spawnSync } from 'node:child_process';\nspawnSync('taskkill', ['/T'], { stdio: 'ignore' });" },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/d.ts', source: "import * as cp from 'node:child_process';\ncp.spawn('x');" },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/e.ts', source: "const t = pty.spawn(file, args, { cols: 80 });" },
      { pkg: '@ogden-agents/server', path: 'packages/server/src/f.ts', source: "import open from 'open';\nawait open(url);" },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/ok.ts', source: "import { spawn } from 'node:child_process';\n// spawn('x', [], { env: process.env })\nspawn('x', [], { env: helperEnvironment() });\nconst env = {};\nspawn('y', [], { env, cwd });" },
      { pkg: '@ogden-agents/server', path: 'packages/server/src/launcher.ts', source: "import { spawn } from 'node:child_process';\nspawn(process.execPath, [], { env: { ...process.env, [DATA_DIR_ENV]: dataDir } });\nspawn('helper', [], { env: process.env });" },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/g.ts', source: "import cp, { spawn } from 'node:child_process';\nconst m = await import('node:child_process');" },
    ];
    expect(findSpawnEnvViolations(files)).toEqual([
      'packages/adapters/src/a.ts: spawn(…) passes process.env (AD-16: build its environment from the allowlist)',
      'packages/adapters/src/b.ts: run(…) passes process.env (AD-16: build its environment from the allowlist)',
      'packages/adapters/src/c.ts: spawnSync(…) passes no env, so it inherits the whole process.env (AD-16)',
      'packages/adapters/src/d.ts: loads node:child_process other than by named import; import its functions by name so the AD-16 check sees each spawn',
      'packages/adapters/src/e.ts: pty.spawn(…) passes no env, so it inherits the whole process.env (AD-16)',
      'packages/server/src/f.ts: loads the open package, which starts its opener with the whole process.env (AD-16: use openUrl)',
      'packages/server/src/launcher.ts: spawn(…) passes process.env (AD-16: build its environment from the allowlist)',
      'packages/adapters/src/g.ts: loads node:child_process other than by named import; import its functions by name so the AD-16 check sees each spawn',
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

describe('AD-10: only an approved merge marks a ticket done (story 5.9)', () => {
  /** Every source file under each package's src folder that passes `approve: true` to a ticket mark, as `package/relative path`. */
  const approvers = (): string[] => {
    const out: string[] = [];
    for (const pkg of readdirSync(join(ROOT, 'packages'), { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const src = join(ROOT, 'packages', pkg.name, 'src');
      let entries: string[];
      try {
        entries = readdirSync(src, { recursive: true, encoding: 'utf8' });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const text = readFileSync(join(src, entry), 'utf8')
          .split('\n')
          .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
          .join('\n');
        if (/\bapprove:\s*true\b/.test(text)) out.push(`${pkg.name}/${entry.split('\\').join('/')}`);
      }
    }
    return out.sort();
  };

  it("only core's builds use-case marks done with approve: true (the store's own refusal aside)", () => {
    expect(approvers()).toEqual(['core/builds.ts']);
  });
});

/** The programs a terminal pane may launch (epic 16): launchers are data in the adapters, so the neutral packages name none, not even by executable name. */
const PANE_PROGRAM_NAMES = ['claude', 'codex', 'grok', 'gemini', 'agy', 'copilot', 'antigravity'] as const;

/** One message per mention of a program name in code (comments allowed to give examples) of a neutral pane file, or of `acp-base`. */
export function findPaneProgramViolations(files: readonly SourceFile[]): string[] {
  const named = new RegExp(`(?<![A-Za-z0-9])(${PANE_PROGRAM_NAMES.join('|')})(?![A-Za-z0-9])`, 'gi');
  const violations: string[] = [];
  for (const { pkg, path, source } of files) {
    const neutral = ((pkg === '@ogden-agents/core' || pkg === '@ogden-agents/shared') && /(^|[\\/])(panes?|events-panes|terminal-port)\.ts$/.test(path)) || /[\\/]acp-base[\\/]/.test(path);
    if (!neutral) continue;
    for (const match of withoutComments(source).matchAll(named)) violations.push(`${path}: names the program ${match[1]} (epic 16: launchers are data in the adapters)`);
  }
  return violations;
}

describe('epic 16: core, shared and acp-base name no pane program', () => {
  it('the pane contracts and use-cases name none', () => {
    const files = loadWorkspaceSources();
    expect(files.some((file) => /panes\.ts$/.test(file.path))).toBe(true);
    expect(findPaneProgramViolations(files)).toEqual([]);
  });

  it('flags a program name in code, but not in a comment or a longer word', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/core', path: 'core/src/panes.ts', source: "const file = 'claude';\n// codex is only an example\nconst x = 'codexes';" },
      { pkg: '@ogden-agents/shared', path: 'shared/src/panes.ts', source: 'const a = `run grok`;' },
      { pkg: '@ogden-agents/adapters', path: 'adapters/src/pane-launchers/index.ts', source: "const id = 'claude';" },
    ];
    expect(findPaneProgramViolations(files)).toEqual([
      'core/src/panes.ts: names the program claude (epic 16: launchers are data in the adapters)',
      'shared/src/panes.ts: names the program grok (epic 16: launchers are data in the adapters)',
    ]);
  });
});

/**
 * E15 (epic 15, story 15.2): the manager is a tool-free model call. The
 * orchestration and manager code in core, shared and the fake manager names no
 * model product (the model is whatever endpoint the user configured), and
 * imports no shell, file, agent or credential port and no Node module, so it
 * cannot run a command, touch a file or read a key. The real adapter, 15.4,
 * calls only `LocalModelPort`. Story 15.4 adds the real manager to core (`manager-input`,
 * `manager-source`, `model-manager`) and 15.5 the roster (`team-roster` in core, `roster` in shared), held to the same rules: it reaches the model only through
 * `LocalModelPort` and the endpoint only through `LocalEndpoints.target`.
 */
const MODEL_PRODUCT_WORDS = /(?<![A-Za-z0-9])(gpt|llama|qwen|mistral|mixtral|gemma|deepseek|claude|anthropic|openai|ollama|lm[ -]?studio|gemini|grok|codex|copilot|antigravity|opencode)(?![A-Za-z0-9])/gi;
/** The ports and modules that give a shell, files, a terminal, a credential or an agent. */
const FORBIDDEN_ORCHESTRATION_IMPORTS =
  /^(?:node:|child_process$|fs$|fs\/promises$|os$|net$|http$|https$|(?:\.{1,2}\/)+(?:[\w-]+\/)*(?:terminal-port|terminal-reasons|sandbox-port|secret-store-port|vcs-port|build-runner-port|build-object-store|build-worktrees|ticket-store-port|bmad-source-port|bmad-catalog-port|agent-port|agent-setup-port|app-shortcut-port|panes|pane-launchers|notifier-port|fs-safe|process-tree|child-env)(?:\.js)?$)/;
/** Core, shared and fake-manager files that are the orchestration contracts. */
const ORCHESTRATION_FILE = /(^|[\\/])packages[\\/](?:core|shared)[\\/]src[\\/](?:orchestration[\w-]*|events-orchestration|manager-[\w-]+|model-manager|team-roster|roster)\.ts$|(^|[\\/])packages[\\/]adapters[\\/]src[\\/]manager-memory[\\/]/;

/** One message per model product named, and per forbidden import, in the orchestration files (comments aside for the names). */
export function findOrchestrationViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!ORCHESTRATION_FILE.test(path)) continue;
    const code = withoutComments(source);
    for (const match of code.matchAll(MODEL_PRODUCT_WORDS)) violations.push(`${path}: names the model product ${match[1]} (E15: the manager is whatever endpoint the user configured)`);
    for (const match of source.matchAll(SPECIFIER)) {
      if (FORBIDDEN_ORCHESTRATION_IMPORTS.test(match[2]!)) violations.push(`${path}: imports ${match[2]} (E15: the manager has no shell, file, agent or credential)`);
    }
  }
  return violations;
}

/**
 * E15 (story 15.6): approval comes only from a user action. The five use-cases
 * that are the user's alone (approve, edit, skip, reorder, Stop) are called by
 * the server's orchestration routes and by nothing else: not the manager code
 * (the port, its input, the real and the fake managers, the source), and not
 * the use-case's own manager and dispatch paths (`startRun`, the read-back and
 * `dispatchStep`). A manager's answer is data; there is no function it can
 * reach that approves, edits, skips, reorders or stops.
 */
const USER_ACTIONS = /\b(approveStep|editStep|skipStep|reorderSteps|stopRun|answerQuestion)\b/;
/** The manager's own code: core's manager files and the fake manager. */
const MANAGER_CODE = /(^|[\\/])packages[\\/]core[\\/]src[\\/](?:manager-[\w-]+|model-manager)\.ts$|(^|[\\/])packages[\\/]adapters[\\/]src[\\/](?:manager-memory|local-model[\w-]*)[\\/]/;
/**
 * The orchestration use-case: `orchestration.ts` (the public shape and the assembly) and every module the 15.13 sweep cut it into
 * (`orchestration-rows`, `-transcript`, `-loop-state`, `-build-read`, `-manager-io`, `-review`, `-run`, `-readback`, `-activity`, `-dispatch`,
 * `-engine`, `-actions`, `-kernel`) and the files beside them (`-feature`, `-builds`, `-routing`). A new `orchestration-*.ts` file in core is
 * held to every rule here by name, with no list to forget. Only the install's defaults (the user's own settings use-case) are left out.
 */
const ORCHESTRATION_USE_CASE = /(^|[\\/])packages[\\/]core[\\/]src[\\/]orchestration(?!-defaults\b)(?:-[\w-]+)?\.ts$/;
/** The only use-case files that may name the user's own actions: the module that implements them and the assembly that lists them. */
const USER_ACTION_MODULES = /(^|[\\/])packages[\\/]core[\\/]src[\\/]orchestration(?:-actions)?\.ts$/;
/** One use-case file's source by its short name (`engine` is `orchestration-engine.ts`; `''` is `orchestration.ts`). */
function useCaseFile(files: readonly SourceFile[], name: string): string {
  const wanted = new RegExp(`packages[\\\\/]core[\\\\/]src[\\\\/]orchestration${name === '' ? '' : `-${name}`}\\.ts$`);
  const found = files.find((file) => wanted.test(file.path));
  if (found === undefined) throw new Error(`no orchestration${name === '' ? '' : `-${name}`}.ts in core`);
  return found.source;
}
/** Every use-case file's source, one after the other (for a rule that holds across the whole use-case). */
const wholeUseCase = (files: readonly SourceFile[]): string => files.filter((file) => ORCHESTRATION_USE_CASE.test(file.path)).map((file) => file.source).join('\n');
/** Where the user's actions are called from outside core: the server's orchestration routes, and the web client that sends them. */
const USER_ACTION_CALLERS = /(^|[\\/])packages[\\/]server[\\/]src[\\/]orchestration-routes\.ts$/;

export function findUserActionReaches(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    const code = withoutComments(source);
    if (MANAGER_CODE.test(path)) {
      for (const match of code.matchAll(new RegExp(USER_ACTIONS.source, 'g'))) violations.push(`${path}: names ${match[1]} (E15: the manager's code cannot approve, edit, skip, reorder or stop)`);
    }
    // Every use-case module but the user's actions (and the assembly that lists them): start, read-back, dispatch, the engine and the rest.
    if (ORCHESTRATION_USE_CASE.test(path) && !USER_ACTION_MODULES.test(path)) {
      for (const match of code.matchAll(new RegExp(USER_ACTIONS.source, 'g'))) violations.push(`${path}: names ${match[1]} (E15: only the user's routes may call it)`);
    }
    // Outside core and its tests, only the server's orchestration routes call the use-cases.
    if (/(^|[\\/])packages[\\/]server[\\/]src[\\/]/.test(path) && !USER_ACTION_CALLERS.test(path)) {
      for (const match of code.matchAll(/\.(approveStep|editStep|skipStep|reorderSteps|stopRun|answerQuestion)\(/g)) violations.push(`${path}: calls ${match[1]} (E15: only orchestration-routes.ts, a user's route, may)`);
    }
  }
  return violations;
}

describe('E15: approval comes only from a user action (story 15.6)', () => {
  it('the manager code and the manager and dispatch paths never reach approve, edit, skip, reorder or stop', () => {
    const files = loadWorkspaceSources();
    const manager = files.filter((file) => MANAGER_CODE.test(file.path)).map((file) => file.path.split('\\').join('/'));
    expect(manager).toEqual(expect.arrayContaining(['packages/core/src/manager-port.ts', 'packages/core/src/model-manager.ts', 'packages/core/src/manager-source.ts', 'packages/adapters/src/manager-memory/index.ts']));
    expect(files.some((file) => ORCHESTRATION_USE_CASE.test(file.path))).toBe(true);
    expect(files.some((file) => USER_ACTION_CALLERS.test(file.path))).toBe(true);
    expect(findUserActionReaches(files)).toEqual([]);
  });

  it('flags a planted call from a manager file, from any use-case module but the actions, and from another server file', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/core', path: 'packages/core/src/model-manager.ts', source: "// approveStep is only a word here\nawait use.approveStep(ws, run, step);" },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/manager-memory/index.ts', source: 'orchestration.skipStep(a, b, c);' },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration-run.ts', source: 'const startRun = () => { approveStep(); };' },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration-dispatch.ts', source: 'const dispatchStep = () => { editStep(); };' },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration-readback.ts', source: 'const readBack = () => { stopRun(); };' },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration-engine.ts', source: 'const advancePass = () => { answerQuestion(); reorderSteps(); };' },
      // The user's actions and the assembly that lists them are the places that name them.
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration-actions.ts', source: 'const approveStep = () => {}; const stopRun = () => {};' },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration.ts', source: 'approveStep(workspaceId: string): void;' },
      { pkg: '@ogden-agents/server', path: 'packages/server/src/chat-routes.ts', source: 'runs.reorderSteps(a, b);' },
      { pkg: '@ogden-agents/server', path: 'packages/server/src/orchestration-routes.ts', source: 'use.approveStep(a, b, c);' },
    ];
    expect(findUserActionReaches(files)).toEqual([
      "packages/core/src/model-manager.ts: names approveStep (E15: the manager's code cannot approve, edit, skip, reorder or stop)",
      "packages/adapters/src/manager-memory/index.ts: names skipStep (E15: the manager's code cannot approve, edit, skip, reorder or stop)",
      "packages/core/src/orchestration-run.ts: names approveStep (E15: only the user's routes may call it)",
      "packages/core/src/orchestration-dispatch.ts: names editStep (E15: only the user's routes may call it)",
      "packages/core/src/orchestration-readback.ts: names stopRun (E15: only the user's routes may call it)",
      "packages/core/src/orchestration-engine.ts: names answerQuestion (E15: only the user's routes may call it)",
      "packages/core/src/orchestration-engine.ts: names reorderSteps (E15: only the user's routes may call it)",
      "packages/server/src/chat-routes.ts: calls reorderSteps (E15: only orchestration-routes.ts, a user's route, may)",
    ]);
  });

  it('the use-case is cut into the modules the guards name, and the user\'s actions are the one module that names them', () => {
    const files = loadWorkspaceSources();
    const modules = files.filter((file) => ORCHESTRATION_USE_CASE.test(file.path)).map((file) => file.path.split('\\').join('/').replace('packages/core/src/', ''));
    expect(modules).toEqual(
      expect.arrayContaining(['orchestration.ts', 'orchestration-kernel.ts', 'orchestration-rows.ts', 'orchestration-transcript.ts', 'orchestration-loop-state.ts', 'orchestration-build-read.ts', 'orchestration-manager-io.ts', 'orchestration-review.ts', 'orchestration-run.ts', 'orchestration-readback.ts', 'orchestration-activity.ts', 'orchestration-dispatch.ts', 'orchestration-engine.ts', 'orchestration-actions.ts', 'orchestration-routing.ts', 'orchestration-builds.ts', 'orchestration-feature.ts']),
    );
    // The install's defaults are the user's own settings use-case: not part of the use-case these rules guard.
    expect(modules).not.toContain('orchestration-defaults.ts');
    const naming = files.filter((file) => ORCHESTRATION_USE_CASE.test(file.path) && new RegExp(USER_ACTIONS.source).test(withoutComments(file.source))).map((file) => file.path.split('\\').join('/').replace('packages/core/src/', ''));
    expect(naming.sort()).toEqual(['orchestration-actions.ts', 'orchestration.ts']);
    // No orchestration module is large again: a module over 450 lines is a cue to cut it (15.13).
    for (const file of files.filter((candidate) => ORCHESTRATION_USE_CASE.test(candidate.path))) {
      expect(file.source.split('\n').length, file.path).toBeLessThanOrEqual(450);
    }
  });
});

/**
 * E15 (story 15.7): a worker keeps its own permission mode. The orchestration use-case sends an instruction into a chat and reads
 * it back; it never sets a mode, a model or a driver, and never hands a chat to another agent (a step names `new` or the
 * worker's own chat, so no chat ever changes agent).
 */
const MODE_CHANGES = /\b(setPermissionMode|setSessionPermissionMode|handOff|handoffPreview|switchDriver|setModel|setSessionDriver)\b/;
export function findModeChanges(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!ORCHESTRATION_USE_CASE.test(path) && !MANAGER_CODE.test(path)) continue;
    for (const match of withoutComments(source).matchAll(new RegExp(MODE_CHANGES.source, 'g'))) violations.push(`${path}: names ${match[1]} (E15: the manager never changes a worker's mode, model, driver or agent)`);
  }
  return violations;
}

describe("E15: a worker keeps its own mode (story 15.7)", () => {
  it('the orchestration use-case and the manager code never set a mode, model or driver or hand a chat to another agent', () => {
    const files = loadWorkspaceSources();
    expect(files.some((file) => ORCHESTRATION_USE_CASE.test(file.path))).toBe(true);
    expect(findModeChanges(files)).toEqual([]);
  });

  it('flags a planted mode change', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration.ts', source: "// setPermissionMode is only a word here\nchat.setPermissionMode(ws, id, 'auto');" },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/model-manager.ts', source: 'chat.handOff(a, b, c);' },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/chat/turns.ts', source: 'setPermissionMode();' },
    ];
    expect(findModeChanges(files)).toEqual([
      "packages/core/src/orchestration.ts: names setPermissionMode (E15: the manager never changes a worker's mode, model, driver or agent)",
      "packages/core/src/model-manager.ts: names handOff (E15: the manager never changes a worker's mode, model, driver or agent)",
    ]);
  });
});

/**
 * E15 (story 15.8): the manager can never change the mode or the confirmation. The manager's own code (the port, its input, the
 * real and the fake managers, the source) and the orchestration use-case (start, read-back, dispatch, the automatic engine, Stop)
 * only read the project's mode; none of them names a settings mutator, the user's confirmation, the install's defaults or the
 * roster's setters. Changing the mode is the workspace settings route and the defaults route, which the user calls.
 */
const SETTINGS_MUTATORS = /\b(updateSettings|setOrchestration|setRoster|setDefault|setDefaults|orchestrationAutomaticConfirmed|automaticConfirmed|createOrchestrationDefaults|OrchestrationDefaultsUseCase|UpdateOrchestrationDefaultsRequest)\b/;
export function findSettingsMutatorReaches(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!ORCHESTRATION_USE_CASE.test(path) && !MANAGER_CODE.test(path)) continue;
    for (const match of withoutComments(source).matchAll(new RegExp(SETTINGS_MUTATORS.source, 'g'))) violations.push(`${path}: names ${match[1]} (E15: the manager never changes the mode or the confirmation)`);
  }
  return violations;
}

describe('E15: the manager never changes the mode or the confirmation (story 15.8)', () => {
  it('the manager code and the orchestration use-case name no settings mutator', () => {
    const files = loadWorkspaceSources();
    expect(files.some((file) => ORCHESTRATION_USE_CASE.test(file.path))).toBe(true);
    expect(files.filter((file) => MANAGER_CODE.test(file.path)).length).toBeGreaterThan(3);
    expect(findSettingsMutatorReaches(files)).toEqual([]);
  });

  it('the automatic engine is a guarded module of the use-case', () => {
    const engine = useCaseFile(loadWorkspaceSources(), 'engine');
    expect(engine).toContain('const chains = new Map');
    expect(engine).toContain('const advancePass =');
    expect(ORCHESTRATION_USE_CASE.test('packages/core/src/orchestration-engine.ts')).toBe(true);
  });

  it('flags a planted mutator in the use-case or the manager code', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration.ts', source: "// updateSettings is only a word here\npermissions.updateSettings(ws, { orchestrationMode: 'automatic', confirm: true });" },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration-engine.ts', source: 'permissions.updateSettings(ws, { orchestrationMode: "automatic" });' },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/model-manager.ts', source: 'defaults.setOrchestration(next);' },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/manager-memory/index.ts', source: "const mark = { orchestrationAutomaticConfirmed: true };" },
      { pkg: '@ogden-agents/server', path: 'packages/server/src/workspace-routes.ts', source: 'permissions.updateSettings(a, b);' },
      // The install's defaults are the user's own settings use-case.
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration-defaults.ts', source: 'setDefaults(next);' },
    ];
    expect(findSettingsMutatorReaches(files)).toEqual([
      'packages/core/src/orchestration.ts: names updateSettings (E15: the manager never changes the mode or the confirmation)',
      'packages/core/src/orchestration-engine.ts: names updateSettings (E15: the manager never changes the mode or the confirmation)',
      'packages/core/src/model-manager.ts: names setOrchestration (E15: the manager never changes the mode or the confirmation)',
      'packages/adapters/src/manager-memory/index.ts: names orchestrationAutomaticConfirmed (E15: the manager never changes the mode or the confirmation)',
    ]);
  });
});

describe('E15: routing rules only suggest (story 15.12)', () => {
  it('the rules store and the use-case that saves them touch no roster, mode, approval, dispatch or build code', () => {
    const files = loadWorkspaceSources();
    const store = files.find((file) => /packages[\\/]core[\\/]src[\\/]orchestration-routing\.ts$/.test(file.path))!.source;
    const forbidden = /team-roster|orchestrationRoster|orchestrationMode|setOrchestration|approveStep|dispatchStep|createBuilds|builds\.start|sendMessage|createChatSession/;
    // Words in comments say what the file does not do, so only code is checked.
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code(store)).not.toMatch(forbidden);
    // The use-case that saves them (createRouting) lives in the same file, so the check above covers it; it is not an inline slice any more.
    expect(code(store)).toContain('setRouting(workspaceId: WorkspaceId, request: unknown)');
    const setRouting = store.slice(store.indexOf('setRouting(workspaceId: WorkspaceId, request: unknown)'));
    expect(setRouting.length).toBeGreaterThan(200);
    expect(code(setRouting)).not.toMatch(forbidden);
    // Nothing else of the use-case writes the rules.
    const writers = files.filter((file) => ORCHESTRATION_USE_CASE.test(file.path) && /writeRoutingRules/.test(withoutComments(file.source))).map((file) => file.path.split('\\').join('/').replace('packages/core/src/', ''));
    expect(writers).toEqual(['orchestration-routing.ts']);
  });

  it('a step\'s rule is checked only after the roster, so no rule can make a worker allowed', () => {
    const shared = loadWorkspaceSources().find((file) => /packages[\\/]shared[\\/]src[\\/]orchestration\.ts$/.test(file.path))!.source;
    const check = shared.slice(shared.indexOf('export function checkManagerPlan('), shared.indexOf('function buildStepProblem('));
    expect(check.indexOf("'off_roster_worker'")).toBeGreaterThan(-1);
    expect(check.indexOf("'off_roster_worker'")).toBeLessThan(check.indexOf("'unknown_rule'"));
    // Nothing in a rule's path reads the roster to widen it: the rule list is only compared by id.
    expect(check).toMatch(/context\.rules \?\? \[\]\)\.includes\(step\.rule\)/);
  });
});

describe('E15: orchestration code is tool-free and names no model product (story 15.2)', () => {
  it('core, shared and the fake manager keep to the rules', () => {
    const files = loadWorkspaceSources();
    const matched = files.filter((file) => ORCHESTRATION_FILE.test(file.path)).map((file) => file.path.split('\\').join('/'));
    expect(matched).toEqual(
      expect.arrayContaining([
        'packages/core/src/manager-port.ts',
        'packages/core/src/manager-input.ts',
        'packages/core/src/manager-source.ts',
        'packages/core/src/model-manager.ts',
        'packages/core/src/orchestration-feature.ts',
        'packages/core/src/orchestration.ts',
        'packages/core/src/orchestration-routing.ts',
        // The modules the 15.13 sweep cut the use-case into: all held to the same rules by the pattern.
        'packages/core/src/orchestration-kernel.ts',
        'packages/core/src/orchestration-rows.ts',
        'packages/core/src/orchestration-transcript.ts',
        'packages/core/src/orchestration-loop-state.ts',
        'packages/core/src/orchestration-build-read.ts',
        'packages/core/src/orchestration-manager-io.ts',
        'packages/core/src/orchestration-review.ts',
        'packages/core/src/orchestration-run.ts',
        'packages/core/src/orchestration-readback.ts',
        'packages/core/src/orchestration-activity.ts',
        'packages/core/src/orchestration-dispatch.ts',
        'packages/core/src/orchestration-engine.ts',
        'packages/core/src/orchestration-actions.ts',
        'packages/core/src/team-roster.ts',
        'packages/shared/src/roster.ts',
        'packages/shared/src/events-orchestration.ts',
        'packages/shared/src/orchestration.ts',
        'packages/adapters/src/manager-memory/index.ts',
      ]),
    );
    expect(findOrchestrationViolations(files)).toEqual([]);
  });

  it('flags a planted product name, shell, file, credential and agent import, but not in a comment or another file', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/core', path: 'packages/core/src/manager-port.ts', source: "// llama is only an example\nconst model = 'qwen';\nimport { x } from './terminal-port.js';\nimport { y } from './secret-store-port.js';" },
      { pkg: '@ogden-agents/shared', path: 'packages/shared/src/orchestration.ts', source: "import { readFileSync } from 'node:fs';\nimport { spawn } from 'child_process';\nimport { z } from 'zod';" },
      { pkg: '@ogden-agents/adapters', path: 'packages/adapters/src/manager-memory/index.ts', source: "import type { AgentPort } from '../../../core/src/agent-port.js';\nconst a = 'GPT';" },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/chat.ts', source: "import { x } from './terminal-port.js'; const m = 'llama';" },
    ];
    expect(findOrchestrationViolations(files)).toEqual([
      'packages/core/src/manager-port.ts: names the model product qwen (E15: the manager is whatever endpoint the user configured)',
      'packages/core/src/manager-port.ts: imports ./terminal-port.js (E15: the manager has no shell, file, agent or credential)',
      'packages/core/src/manager-port.ts: imports ./secret-store-port.js (E15: the manager has no shell, file, agent or credential)',
      'packages/shared/src/orchestration.ts: imports node:fs (E15: the manager has no shell, file, agent or credential)',
      'packages/shared/src/orchestration.ts: imports child_process (E15: the manager has no shell, file, agent or credential)',
      'packages/adapters/src/manager-memory/index.ts: names the model product GPT (E15: the manager is whatever endpoint the user configured)',
      'packages/adapters/src/manager-memory/index.ts: imports ../../../core/src/agent-port.js (E15: the manager has no shell, file, agent or credential)',
    ]);
  });
});

/**
 * E15 (story 15.9): the loop and the manager can never answer a permission card. A worker's card is the user's to answer on the worker's own
 * card; the orchestration use-case (the loop, the pause, the Deny reading, the resume) only reads the worker session's events and state, and the
 * manager's code never reaches the permission use-case. None of them names the permission answer (`decide`), a rule change (`removeRule`), the
 * decision input, or a session event writer, so a card cannot be allowed or denied from there. The server's orchestration routes take only the
 * settings read of the permissions use-case.
 */
const CARD_ANSWERS = /\b(decide(?=\s*\()|removeRule|PermissionDecisionInput|createPermissions|appendSessionEvent|completeMessage)\b/;
const ORCHESTRATION_ROUTES = /(^|[\\/])packages[\\/]server[\\/]src[\\/]orchestration-routes\.ts$/;
export function findCardAnswerReaches(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!ORCHESTRATION_USE_CASE.test(path) && !MANAGER_CODE.test(path) && !ORCHESTRATION_ROUTES.test(path)) continue;
    for (const match of withoutComments(source).matchAll(new RegExp(CARD_ANSWERS.source, 'g'))) violations.push(`${path}: names ${match[1]} (E15: the manager and the loop never answer a permission card)`);
  }
  return violations;
}

describe('E15: the manager and the loop never answer a permission card (story 15.9)', () => {
  it('the orchestration use-case, the manager code and the orchestration routes name no way to answer a card or write a session event', () => {
    const files = loadWorkspaceSources();
    expect(files.some((file) => ORCHESTRATION_USE_CASE.test(file.path))).toBe(true);
    expect(files.some((file) => ORCHESTRATION_ROUTES.test(file.path))).toBe(true);
    expect(files.filter((file) => MANAGER_CODE.test(file.path)).length).toBeGreaterThan(3);
    expect(findCardAnswerReaches(files)).toEqual([]);
  });

  it('the orchestration use-case reads a Deny from the session events (it only reads them)', () => {
    const source = wholeUseCase(loadWorkspaceSources());
    expect(source).toContain("'permission.resolved'");
    expect(source).not.toMatch(/\.append\(\{\s*type:\s*'permission\./);
  });

  it('flags a planted card answer in the use-case, the manager code or the routes', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration.ts', source: "// decide is only a word here\npermissions.decide(ws, session, request, { decision: 'allow_once' });" },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/model-manager.ts', source: 'permissions.removeRule(ws, rule);' },
      { pkg: '@ogden-agents/server', path: 'packages/server/src/orchestration-routes.ts', source: 'sessionEvents.appendSessionEvent(id, event);' },
      { pkg: '@ogden-agents/server', path: 'packages/server/src/permission-routes.ts', source: 'permissions.decide(a, b, c, d);' },
    ];
    expect(findCardAnswerReaches(files)).toEqual([
      'packages/core/src/orchestration.ts: names decide (E15: the manager and the loop never answer a permission card)',
      'packages/core/src/model-manager.ts: names removeRule (E15: the manager and the loop never answer a permission card)',
      'packages/server/src/orchestration-routes.ts: names appendSessionEvent (E15: the manager and the loop never answer a permission card)',
    ]);
  });
});

/**
 * E15 (story 15.10): the manager and the reviewer have no route to approve, reject, merge or mark a ticket done. Epic 5 keeps that for the person
 * on the review page (AD-10: only approve writes `done`). The orchestration use-case, the manager's code, the server's orchestration routes and the
 * Orchestrate page's code name none of the build or ticket use-cases that decide (approve, reject, merge, mark, commit plan files), their request
 * types, the ticket store, or the routes that reach them. The review step links to the review page; it never calls it.
 */
const ORCHESTRATE_PAGE = /(^|[\\/])packages[\\/]web[\\/]src[\\/](?:orchestrate[\\/]|routes[\\/]workspace-orchestrate-page\.tsx$)/;
const DECIDING_CALLS = /\.(approve|reject|merge|mark|markDone|commitPlanFiles|isMerged)\s*\(/;
const DECIDING_NAMES = /\b(markDone|commitPlanFiles|isMerged|BuildsUseCases|createBuilds|ApproveBuildRequest|RejectBuildRequest|MarkTicketRequest|StatusNotAllowedError|TicketStorePort|workspaceBuildApprove|workspaceBuildReject|workspaceBuildCommitPlan|workspaceTicketStatus)\b/;
export function findDecidingReaches(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!ORCHESTRATION_USE_CASE.test(path) && !MANAGER_CODE.test(path) && !ORCHESTRATION_ROUTES.test(path) && !ORCHESTRATE_PAGE.test(path)) continue;
    const code = withoutComments(source);
    for (const match of code.matchAll(new RegExp(DECIDING_CALLS.source, 'g'))) violations.push(`${path}: calls ${match[1]} (E15: only a person approves, merges or marks a ticket done)`);
    for (const match of code.matchAll(new RegExp(DECIDING_NAMES.source, 'g'))) violations.push(`${path}: names ${match[1]} (E15: only a person approves, merges or marks a ticket done)`);
  }
  return violations;
}

describe('E15: the manager and the reviewer have no path to approve, merge or mark done (story 15.10)', () => {
  it('the orchestration use-case, the manager code, the routes and the page name no deciding use-case of builds or tickets', () => {
    const files = loadWorkspaceSources();
    expect(files.some((file) => ORCHESTRATION_USE_CASE.test(file.path))).toBe(true);
    expect(files.some((file) => ORCHESTRATION_ROUTES.test(file.path))).toBe(true);
    expect(files.filter((file) => ORCHESTRATE_PAGE.test(file.path)).length).toBeGreaterThan(3);
    expect(files.filter((file) => MANAGER_CODE.test(file.path)).length).toBeGreaterThan(3);
    expect(findDecidingReaches(files)).toEqual([]);
  });

  it('the review step only links to the review page: the page file names the route and calls nothing', () => {
    const view = loadWorkspaceSources().find((file) => /orchestrate-view\.tsx$/.test(file.path))!.source;
    expect(view).toContain('/w/$wsId/review/$ref');
    expect(view).not.toMatch(/fetch\(|apiPath\(|API_ROUTES/);
  });

  it('flags a planted approve, merge, mark or route in the use-case, the manager code, the routes or the page', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration.ts', source: "// approve( is only a word here\nawait builds.approve(ws, ref, { revision });" },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/model-manager.ts', source: 'await board.mark(ws, ref, { status: "done" });' },
      { pkg: '@ogden-agents/server', path: 'packages/server/src/orchestration-routes.ts', source: 'const use: BuildsUseCases = builds; use.merge(a);' },
      { pkg: '@ogden-agents/web', path: 'packages/web/src/orchestrate/orchestrate-api.ts', source: 'post(apiPath(API_ROUTES.workspaceBuildApprove, { wsId }));' },
      { pkg: '@ogden-agents/server', path: 'packages/server/src/build-routes.ts', source: 'builds.approve(a, b, c);' },
    ];
    expect(findDecidingReaches(files)).toEqual([
      'packages/core/src/orchestration.ts: calls approve (E15: only a person approves, merges or marks a ticket done)',
      'packages/core/src/model-manager.ts: calls mark (E15: only a person approves, merges or marks a ticket done)',
      'packages/server/src/orchestration-routes.ts: calls merge (E15: only a person approves, merges or marks a ticket done)',
      'packages/server/src/orchestration-routes.ts: names BuildsUseCases (E15: only a person approves, merges or marks a ticket done)',
      'packages/web/src/orchestrate/orchestrate-api.ts: names workspaceBuildApprove (E15: only a person approves, merges or marks a ticket done)',
    ]);
  });
});

/**
 * E15 (story 15.11): a build is started only by the person, in epic 5's Build dialog, and by no orchestration code. The orchestration
 * use-case, the manager's code, the read of the board's ready tickets, the server's orchestration routes and the Orchestrate page's code name
 * none of the builds' start use-cases (`start`, `startAll`), their request and response types, the builds route or the web client's start
 * calls. The page opens the dialog (`BuildDialog`), whose own start path is the board's `POST /builds`; the plan is only told which run the
 * dialog started, by a route that records a run and starts none.
 */
const ORCHESTRATION_BUILD_READ = /(^|[\\/])packages[\\/]core[\\/]src[\\/]orchestration-builds\.ts$/;
const BUILD_STARTS = /\b(startBuild|startBuildAll|workspaceBuilds|createBuilds|StartBuildRequest|AllReadyBuildsResponse|BuildResponse|startAll|buildsStart|builds\.start|\.startLocked)\b/;
export function findBuildStartReaches(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!ORCHESTRATION_USE_CASE.test(path) && !MANAGER_CODE.test(path) && !ORCHESTRATION_ROUTES.test(path) && !ORCHESTRATE_PAGE.test(path) && !ORCHESTRATION_BUILD_READ.test(path)) continue;
    for (const match of withoutComments(source).matchAll(new RegExp(BUILD_STARTS.source, 'g'))) violations.push(`${path}: names ${match[1]} (E15: a build is started only in the Build dialog, never by orchestration)`);
  }
  return violations;
}

describe('E15: a build is started only in the Build dialog (story 15.11)', () => {
  it('no orchestration code, route or page names a way to start a build', () => {
    const files = loadWorkspaceSources();
    expect(files.some((file) => ORCHESTRATION_BUILD_READ.test(file.path))).toBe(true);
    expect(files.some((file) => ORCHESTRATION_USE_CASE.test(file.path))).toBe(true);
    expect(files.some((file) => ORCHESTRATION_ROUTES.test(file.path))).toBe(true);
    expect(files.filter((file) => ORCHESTRATE_PAGE.test(file.path)).length).toBeGreaterThan(3);
    expect(findBuildStartReaches(files)).toEqual([]);
  });

  it('the page opens the Build dialog and calls no start of its own, and the dialog is the one place a plan\'s build starts', () => {
    const files = loadWorkspaceSources();
    const page = files.find((file) => /workspace-orchestrate-page\.tsx$/.test(file.path))!.source;
    expect(page).toMatch(/import \{ BuildDialog \} from '@\/planning\/build-dialog'/);
    expect(page).toContain('confirm');
    expect(page).not.toMatch(/builds-api|startBuild/);
    // Only the dialog and the board's own Build button call the web client's start.
    const callers = files.filter((file) => /packages[\\/]web[\\/]src[\\/]/.test(file.path) && /\bstartBuild(All)?\(/.test(withoutComments(file.source)) && !/builds-api\.ts$/.test(file.path)).map((file) => file.path.replace(/\\/g, '/'));
    expect(callers.sort()).toEqual(['packages/web/src/planning/board-tickets.tsx', 'packages/web/src/planning/build-dialog.tsx']);
  });

  it('the one plan route about a build only records a run: it takes a run id, names no ticket, agent or mode, and the use-case never reads a builds start', () => {
    const files = loadWorkspaceSources();
    const actions = useCaseFile(files, 'actions');
    expect(actions).toContain('LinkOrchestrationBuildRequest');
    const link = actions.slice(actions.indexOf('const linkBuild'), actions.indexOf('const answerQuestion'));
    expect(link.length).toBeGreaterThan(200);
    // It reads the run table and writes the step; it makes no run, session or chat.
    expect(link).not.toMatch(/createRun|createSession|createChatSession|sendMessage|insert\(runsTable\)|update\(runsTable\)/);
    // No module of the use-case makes a run row either: the builds' own use-case does.
    expect(wholeUseCase(files)).not.toMatch(/insert\(runsTable\)|update\(runsTable\)/);
    const routes = files.find((file) => ORCHESTRATION_ROUTES.test(file.path))!.source;
    expect(routes).toContain('workspaceOrchestrationStepLink');
    expect(routes).not.toMatch(/API_ROUTES\.workspaceBuild/);
  });

  it('the plan\'s build steps are never approved, edited or sent: the use-case refuses each before anything else', () => {
    const files = loadWorkspaceSources();
    for (const [name, module, marker] of [
      ['dispatchStep', 'dispatch', 'const dispatchStep ='],
      ['approveStep', 'actions', 'const approveStep:'],
      ['editStep', 'actions', 'const editStep:'],
      ['approveByMode', 'engine', 'const approveByMode ='],
    ] as const) {
      const useCase = useCaseFile(files, module);
      const body = useCase.slice(useCase.indexOf(marker), useCase.indexOf(marker) + 1800);
      expect(body, name).toMatch(/buildRef !== null/);
    }
    // The automatic engine waits for the person at a build, whatever the mode.
    expect(useCaseFile(files, 'engine')).toMatch(/if \(next\.buildRef !== null\) return waitForUser/);
  });

  it('flags a planted start of a build in the use-case, the manager code, the routes or the page', () => {
    const files: SourceFile[] = [
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration.ts', source: "// builds.start( is only words here\nawait builds.start(ws, { ref });" },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/model-manager.ts', source: 'await builds.startAll(ws, { all: true });' },
      { pkg: '@ogden-agents/core', path: 'packages/core/src/orchestration-builds.ts', source: 'const made = createBuilds(deps);' },
      { pkg: '@ogden-agents/server', path: 'packages/server/src/orchestration-routes.ts', source: 'app.post(API_ROUTES.workspaceBuilds, handler);' },
      { pkg: '@ogden-agents/web', path: 'packages/web/src/orchestrate/orchestrate-api.ts', source: "import { startBuild } from '@/planning/builds-api';" },
      { pkg: '@ogden-agents/web', path: 'packages/web/src/planning/build-dialog.tsx', source: 'startBuild(wsId, ticketRef);' },
      { pkg: '@ogden-agents/server', path: 'packages/server/src/build-routes.ts', source: 'builds.startAll(a, b);' },
    ];
    expect(findBuildStartReaches(files)).toEqual([
      'packages/core/src/orchestration.ts: names builds.start (E15: a build is started only in the Build dialog, never by orchestration)',
      'packages/core/src/model-manager.ts: names startAll (E15: a build is started only in the Build dialog, never by orchestration)',
      'packages/core/src/orchestration-builds.ts: names createBuilds (E15: a build is started only in the Build dialog, never by orchestration)',
      'packages/server/src/orchestration-routes.ts: names workspaceBuilds (E15: a build is started only in the Build dialog, never by orchestration)',
      'packages/web/src/orchestrate/orchestrate-api.ts: names startBuild (E15: a build is started only in the Build dialog, never by orchestration)',
    ]);
  });
});
