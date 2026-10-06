/**
 * The terminal pane contract (epic 16, story 16.3): launchers as data,
 * statuses, the layout tree, the Terminals settings and the pane events.
 * Core and shared name no CLI (the architecture test); no pane event carries
 * text (AD-6, AD-16).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  MAX_PANES_PER_PROJECT,
  NewCoreEvent,
  PaneLauncher,
  PaneLayout,
  PaneStatus,
  TerminalsSettings,
  TerminalLayoutChangedEvent,
  TerminalPaneClosedEvent,
  TerminalPaneExitedEvent,
  TerminalPaneOpenedEvent,
  TerminalPaneRenamedEvent,
  TerminalPaneStatusChangedEvent,
} from '../src/index.js';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const PAN = 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const PAN2 = 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W4';

describe('launchers are data', () => {
  it('a launcher parses with its defaults, and says interactive only in its terms note', () => {
    const launcher = PaneLauncher.parse({ id: 'example', label: 'Example', kind: 'cli', executables: { darwin: ['example'] }, termsNote: 'interactive_only' });
    expect(launcher).toMatchObject({ defaultArgs: [], promptPatterns: [], executables: { darwin: ['example'], linux: [], win32: [] }, termsNote: 'interactive_only' });
  });

  it('refuses a malformed id, an empty label, a prompt pattern with no depth and an unknown terms note', () => {
    const ok = { id: 'example', label: 'Example', kind: 'cli', executables: {} };
    expect(PaneLauncher.safeParse({ ...ok, id: 'Bad Id' }).success).toBe(false);
    expect(PaneLauncher.safeParse({ ...ok, label: '' }).success).toBe(false);
    expect(PaneLauncher.safeParse({ ...ok, promptPatterns: [{ name: 'q', pattern: 'x' }] }).success).toBe(false);
    expect(PaneLauncher.safeParse({ ...ok, termsNote: 'automate' }).success).toBe(false);
  });

  it('has four statuses', () => {
    expect(PaneStatus.options).toEqual(['working', 'needs_attention', 'idle', 'exited']);
  });
});

describe('launcher data is checked (security review of 16.3)', () => {
  const ok = { id: 'example', label: 'Example', kind: 'cli', executables: {} };
  it('refuses flags that are not plain, relative or odd executables, a bad link and a pattern that does not compile or runs away', () => {
    expect(PaneLauncher.safeParse({ ...ok, defaultArgs: ['--model=big', '-p'] }).success).toBe(true);
    expect(PaneLauncher.safeParse({ ...ok, defaultArgs: ['--x; rm -rf /'] }).success).toBe(false);
    expect(PaneLauncher.safeParse({ ...ok, executables: { darwin: ['example', '~/.local/bin/example', '/usr/local/bin/example'], win32: ['%LOCALAPPDATA%\\x\\x.exe', 'C:\\x\\x.exe'] } }).success).toBe(true);
    for (const bad of ['./example', '../example', 'a/b', '%EVIL%\\x', 'x\u0000y']) expect(PaneLauncher.safeParse({ ...ok, executables: { linux: [bad] } }).success, bad).toBe(false);
    expect(PaneLauncher.safeParse({ ...ok, installUrl: 'https://example.com/install' }).success).toBe(true);
    expect(PaneLauncher.safeParse({ ...ok, installUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(PaneLauncher.safeParse({ ...ok, installUrl: 'http://example.com' }).success).toBe(false);
    expect(PaneLauncher.safeParse({ ...ok, promptPatterns: [{ name: 'q', pattern: '(', depth: 1 }] }).success).toBe(false);
    for (const runaway of ['(a+)+$', '(a|aa)+$', '(a{1,5}){1,5}$', '(\\w+\\s?)*$']) expect(PaneLauncher.safeParse({ ...ok, promptPatterns: [{ name: 'q', pattern: runaway, depth: 1 }] }).success, runaway).toBe(false);
    expect(PaneLauncher.safeParse({ ...ok, promptPatterns: [{ name: 'q', pattern: 'do you want to (proceed|continue)', depth: 5 }] }).success).toBe(true);
  });

  it('a pane title has no control characters, and a layout has at most a project\'s panes and a bounded depth', () => {
    expect(PaneLayout.safeParse({ tabs: [{ id: 't', title: 'Bell\u0007', root: { type: 'pane', paneId: PAN } }], activeTabId: null }).success).toBe(false);
    const leaf = (n: number) => ({ type: 'pane' as const, paneId: `pan_01J9Z3K4M5N6P7Q8R9S0T1V2W${n}` });
    let tree: unknown = leaf(1);
    for (let i = 0; i < MAX_PANES_PER_PROJECT; i += 1) tree = { type: 'split', direction: 'row', ratio: 0.5, first: tree, second: leaf(2) };
    expect(PaneLayout.safeParse({ tabs: [{ id: 't', title: 'x', root: tree }], activeTabId: null }).success).toBe(false);
  });
});

describe('the layout tree', () => {
  const split = { type: 'split', direction: 'row', ratio: 0.5, first: { type: 'pane', paneId: PAN }, second: { type: 'pane', paneId: PAN2 } };

  it('is tabs of nested splits of panes, ids only', () => {
    const layout = PaneLayout.parse({ tabs: [{ id: 't1', title: 'Main', root: { type: 'split', direction: 'column', ratio: 0.3, first: split, second: { type: 'pane', paneId: PAN } } }], activeTabId: 't1' });
    expect(layout.tabs).toHaveLength(1);
    expect(PaneLayout.safeParse({ tabs: [], activeTabId: null }).success).toBe(true);
  });

  it('refuses a ratio that hides a pane, a split with one child and more tabs than panes allowed', () => {
    expect(PaneLayout.safeParse({ tabs: [{ id: 't', title: 'x', root: { ...split, ratio: 0 } }], activeTabId: null }).success).toBe(false);
    expect(PaneLayout.safeParse({ tabs: [{ id: 't', title: 'x', root: { type: 'split', direction: 'row', ratio: 0.5, first: split } }], activeTabId: null }).success).toBe(false);
    const tab = { id: 't', title: 'x', root: { type: 'pane', paneId: PAN } };
    expect(PaneLayout.safeParse({ tabs: Array.from({ length: MAX_PANES_PER_PROJECT + 1 }, () => tab), activeTabId: null }).success).toBe(false);
  });
});

describe('the Terminals settings default to everything off', () => {
  it('parses an empty object to off, no extra environment and no launcher arguments', () => {
    expect(TerminalsSettings.parse({})).toEqual({ notifyNeedsAttention: false, notifyExited: false, notifyLaunchers: [], passProxies: false, passSshAgent: false, launcherArgs: {}, hidden: false });
  });
});

describe('pane events carry state only (AD-6, AD-16)', () => {
  const inputs = [TerminalPaneOpenedEvent, TerminalPaneStatusChangedEvent, TerminalPaneExitedEvent, TerminalPaneClosedEvent, TerminalPaneRenamedEvent, TerminalLayoutChangedEvent];

  it('every pane event is in the event union, on the workspace stream', () => {
    const base = { workspaceId: WS, streamId: WS };
    const samples = [
      { type: 'terminal.pane_opened', ...base, payload: { paneId: PAN, launcherId: 'shell', title: 'Terminal 1' } },
      { type: 'terminal.pane_status_changed', ...base, payload: { paneId: PAN, status: 'needs_attention', previous: 'working' } },
      { type: 'terminal.pane_exited', ...base, payload: { paneId: PAN, exitCode: 3 } },
      { type: 'terminal.pane_closed', ...base, payload: { paneId: PAN, cause: 'user' } },
      { type: 'terminal.pane_renamed', ...base, payload: { paneId: PAN, title: 'Server' } },
      { type: 'terminal.layout_changed', ...base, payload: { tabCount: 1, paneCount: 2 } },
    ];
    for (const sample of samples) expect(NewCoreEvent.safeParse(sample).success, sample.type).toBe(true);
    expect(NewCoreEvent.safeParse({ ...samples[0], streamId: PAN }).success).toBe(false);
  });

  it('no payload field can hold text: only ids, enums, numbers and a pane title', () => {
    // A title is the pane's name, set by the user or the launcher; every other string is an id or an enum.
    const TEXT_FIELDS = new Set(['title']);
    for (const input of inputs) {
      const payload = (input.shape.payload as z.ZodObject<Record<string, z.ZodType>>).shape;
      for (const [name, field] of Object.entries(payload)) {
        const kind = field instanceof z.ZodString && !TEXT_FIELDS.has(name) && !/Id$/.test(name) ? 'string' : 'ok';
        expect(kind, `${input.shape.type.value}.${name}`).toBe('ok');
      }
    }
    for (const forbidden of ['text', 'output', 'data', 'screen', 'line', 'bytes', 'content']) {
      for (const input of inputs) expect(Object.keys((input.shape.payload as z.ZodObject<Record<string, z.ZodType>>).shape), input.shape.type.value).not.toContain(forbidden);
    }
  });
});
