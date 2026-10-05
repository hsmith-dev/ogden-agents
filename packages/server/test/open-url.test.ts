/**
 * The browser opener (AD-16, epic 6 entry 10): `open` runs in a Node child
 * whose environment is the helper allowlist and the desktop's variables, so
 * neither the opener nor the browser it starts gets an agent key. A stand-in
 * `open` module records what it was given; no browser is opened.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openerEnvironment, openUrl } from '../src/open-url.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A stand-in for the `open` package that writes the URL and its environment to `out`. */
function fakeOpen(): { module: string; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-open-'));
  dirs.push(dir);
  const out = join(dir, 'opened.json');
  const module = join(dir, 'open.mjs');
  writeFileSync(module, `import { writeFileSync } from 'node:fs';\nexport default async (url) => writeFileSync(${JSON.stringify(out)}, JSON.stringify({ url, env: process.env }));\n`);
  return { module: pathToFileURL(module).href, out };
}

describe('openUrl (AD-16)', () => {
  it('hands the URL to open in a child that has the allowlist and the desktop, never an agent key', async () => {
    const fake = fakeOpen();
    const source = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DISPLAY: ':0', ANTHROPIC_API_KEY: 'sk-ant-planted', GEMINI_API_KEY: 'AIza-planted', OGDEN_AGENTS_TEST_CLAUDE_INSTALL: '/x', NODE_OPTIONS: '--no-warnings' };
    await openUrl('http://127.0.0.1:1/launch?code=abc&x=1', { openModule: fake.module, source });
    const opened = JSON.parse(readFileSync(fake.out, 'utf8')) as { url: string; env: Record<string, string> };
    expect(opened.url).toBe('http://127.0.0.1:1/launch?code=abc&x=1');
    expect(opened.env.DISPLAY).toBe(':0');
    for (const name of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OGDEN_AGENTS_TEST_CLAUDE_INSTALL', 'NODE_OPTIONS']) expect(opened.env, name).not.toHaveProperty(name);
  });

  it('rejects when the opener fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-open-'));
    dirs.push(dir);
    const module = join(dir, 'open.mjs');
    writeFileSync(module, "export default async () => { throw new Error('no browser'); };\n");
    await expect(openUrl('http://127.0.0.1:1/', { openModule: pathToFileURL(module).href, source: { PATH: process.env.PATH } })).rejects.toThrow(/exited with code 1/);
  });

  it("the opener's environment is the helper allowlist and the desktop's variables", () => {
    expect(openerEnvironment({ PATH: '/bin', WAYLAND_DISPLAY: 'w', XAUTHORITY: '/x', GITHUB_TOKEN: 't' })).toEqual({ PATH: '/bin', WAYLAND_DISPLAY: 'w', XAUTHORITY: '/x' });
  });
});
