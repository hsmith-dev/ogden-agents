// @vitest-environment happy-dom
/**
 * Inside the desktop app (story 13.11, E13-R9) the pages that load before any server answer, and the
 * Quit dialog's sentence, never say "terminal" or "npx" and offer no command to copy, while the npm
 * route's wording is unchanged. The page is told it is in the app by Tauri's own marker, which it only
 * looks for (no IPC, AD-15).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { isDesktopApp } from '../src/shell/desktop-app';
import { OpenOgdenAgents } from '../src/shell/open-ogden-agents';
import { quitConsequence } from '../src/shell/quit-button';
import { ServerStopped } from '../src/shell/server-stopped';

const inApp = () => Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

describe('in the desktop app', () => {
  it('is detected only by the marker Tauri adds', () => {
    expect(isDesktopApp()).toBe(false);
    inApp();
    expect(isDesktopApp()).toBe(true);
  });

  it('the launch page says to open the app again, with no command and no copy button', () => {
    inApp();
    render(<OpenOgdenAgents />);
    const text = screen.getByTestId('open-ogden-agents').textContent ?? '';
    expect(text).toContain('Quit Ogden Agents and open it again');
    expect(text).not.toMatch(/terminal|npx/i);
    expect(screen.queryByRole('button', { name: /copy command/i })).toBeNull();
  });

  it.each(['quit', 'restart', 'unreachable'] as const)('the stopped state (%s) has no command, no terminal and no dashes', (reason) => {
    inApp();
    render(<ServerStopped reason={reason} />);
    const text = screen.getByTestId('server-stopped').textContent ?? '';
    expect(text).not.toMatch(/terminal|npx/i);
    expect(text).not.toMatch(/[–—]|\s-\s/);
    expect(screen.queryByRole('button', { name: /copy command/i })).toBeNull();
  });

  it('the quit sentence says to open the app again', () => {
    for (const busy of [0, 1, 3]) {
      expect(quitConsequence(busy, true)).not.toMatch(/terminal|npx/i);
      expect(quitConsequence(busy, true)).toContain('open the app again');
    }
  });
});

describe('on the npm route', () => {
  it('keeps its command and wording', () => {
    render(<OpenOgdenAgents />);
    expect(screen.getByTestId('open-ogden-agents').textContent).toContain('npx ogden-agents');
    expect(screen.getByRole('button', { name: /copy command/i })).toBeTruthy();
    expect(quitConsequence(0)).toContain('npx ogden-agents');
  });
});
