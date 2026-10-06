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
