// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '../src/ui/tooltip';
import { AppearanceProvider } from '../src/appearance/appearance-provider';
import { PaletteBuilder } from '../src/appearance/palette-builder';
import { APPEARANCE_KEY, parseAppearance } from '../src/appearance/appearance';
import { applyPalette } from '../src/appearance/palette';
const custom = { light: { background: '#ffffff', foreground: '#141715', signal: '#2f4fd8' }, dark: { background: '#0f1210', foreground: '#e6eae6', signal: '#8198ff' } };
beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('style'); });
afterEach(cleanup);
const mount = () => { localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ customPalette: custom })); render(<TooltipProvider><AppearanceProvider><PaletteBuilder /></AppearanceProvider></TooltipProvider>); };
describe('palette builder', () => {
  it('imports accessible palettes, exports them and resets persisted overrides', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Theme JSON'), { target: { value: JSON.stringify({ version: 1, ...custom }) } });
    fireEvent.click(screen.getByRole('button', { name: 'Import theme' }));
    expect(document.documentElement.style.getPropertyValue('--background')).toBe(custom.light.background);
    expect(parseAppearance(localStorage.getItem(APPEARANCE_KEY)).palette).toBe('custom');
    fireEvent.click(screen.getByRole('button', { name: 'Export theme' }));
    expect(JSON.parse((screen.getByLabelText('Theme JSON') as HTMLTextAreaElement).value)).toEqual({ version: 1, ...custom });
    fireEvent.click(screen.getByRole('button', { name: 'Reset palette' }));
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('');
    expect(parseAppearance(localStorage.getItem(APPEARANCE_KEY)).customPalette).toBeUndefined();
  });
  it('rejects invalid imports and inaccessible edits without changing the active palette', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Theme JSON'), { target: { value: '{"version":2}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import theme' }));
    expect(screen.getByRole('alert').textContent).toContain('version 1');
    fireEvent.change(screen.getByLabelText('Light foreground'), { target: { value: custom.light.background } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply theme' }));
    expect(screen.getByRole('alert').textContent).toContain('4.5:1');
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('');
  });
  it('swaps presets and light/dark custom tokens without stale overrides', () => {
    const root = document.documentElement;
    applyPalette(root, 'custom', custom, true);
    expect(root.style.getPropertyValue('--background')).toBe(custom.dark.background);
    applyPalette(root, 'forest');
    expect(root.style.getPropertyValue('--background')).toBe('');
    expect(root.style.getPropertyValue('--signal')).toBe('var(--state-working)');
    applyPalette(root);
    expect(root.style.getPropertyValue('--signal')).toBe('');
  });
});
