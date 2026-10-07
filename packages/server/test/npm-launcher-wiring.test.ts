/**
 * Regression test for a real bug (not caught by `findNpmCli`'s own pure-logic
 * tests, or by the installed-suite journeys, which plant Codex's and Grok's
 * adapters directly or give a fixture `npmCli` that bypasses discovery
 * entirely): `wireAgents` (`start-agents.ts`) threads `npm_execpath` into
 * Claude Code's install as `launcherNpm` (the npm that launched `npx
 * ogden-agents`, or — in the desktop app — the shell's own bundled npm,
 * `server.rs`'s `npm_execpath`), but never did the same for Codex's or
 * Grok's. On a machine with no system Node (the desktop app's bundled Node
 * has no npm installed beside it), `findNpmCli` then has nothing left to try
 * but `PATH`, which is empty, and Install fails: "Ogden Agents couldn't find
 * npm, so Codex wasn't installed." This is exactly what shipped (the GitHub
 * Actions Desktop workflow's own staged-npm check, `verify-stage.mjs`, never
 * exercises Codex's or Grok's wiring; it only proves npm itself runs).
 */
import { describe, expect, it, vi } from 'vitest';
import type { CodexSetupOptions } from '@ogden-agents/adapters';
import type { GrokSetupOptions } from '@ogden-agents/adapters';
import { startTestServer } from './helpers.js';

const captured: { codex?: CodexSetupOptions['install']; grok?: GrokSetupOptions['install'] } = {};

vi.mock('../src/codex-wiring.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/codex-wiring.js')>();
  return {
    ...actual,
    codexWiring: (input: Parameters<typeof actual.codexWiring>[0]) => {
      captured.codex = input.install;
      return actual.codexWiring(input);
    },
  };
});

vi.mock('../src/grok-wiring.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/grok-wiring.js')>();
  return {
    ...actual,
    grokWiring: (input: Parameters<typeof actual.grokWiring>[0]) => {
      captured.grok = input.install;
      return actual.grokWiring(input);
    },
  };
});

describe('wireAgents wires the launcher npm into Codex and Grok installs, not only Claude Code', () => {
  it("gives Codex's and Grok's install the same npm_execpath Claude Code's gets, with no test fixture involved", async () => {
    const original = process.env.npm_execpath;
    process.env.npm_execpath = '/fixture/path/to/npm-cli.js';
    try {
      // Neither hook nor `given` names an install: this is exactly the shipped path (`CODEX_SHIPPED` and
      // `GROK_SHIPPED` are both `true`), the one that broke. `codex: undefined` / `grok: undefined` (rather
      // than the test helper's own default of `false`) is what reaches `wireAgents` as the shipped app does.
      await startTestServer({ codex: undefined, grok: undefined });

      expect(captured.codex).toBeDefined();
      expect(captured.codex?.launcherNpm).toBe('/fixture/path/to/npm-cli.js');
      expect(captured.grok).toBeDefined();
      expect(captured.grok?.launcherNpm).toBe('/fixture/path/to/npm-cli.js');
    } finally {
      if (original === undefined) delete process.env.npm_execpath;
      else process.env.npm_execpath = original;
    }
  });
});
