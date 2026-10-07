/** User palettes override semantic color tokens, leaving type, spacing and state colors consistent. */
export const PALETTES = ['default', 'forest', 'ember', 'custom'] as const;
export type PalettePreference = typeof PALETTES[number];
export interface PaletteColors { background: string; foreground: string; signal: string }
export interface CustomPalette { light: PaletteColors; dark: PaletteColors }
export const COLOR_FIELDS = ['background', 'foreground', 'signal'] as const;

export function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
}
function channels(color: string): number[] {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
}
function luminance(color: string): number {
  return channels(color).reduce((sum, channel, index) => {
    const value = channel / 255;
    return sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]!;
  }, 0);
}
export function contrast(a: string, b: string): number {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high! + 0.05) / (low! + 0.05);
}
export function validColors(value: unknown): value is PaletteColors {
  if (value === null || typeof value !== 'object') return false;
  const colors = value as PaletteColors;
  return COLOR_FIELDS.every((field) => isColor(colors[field])) && contrast(colors.background, colors.foreground) >= 4.5 && contrast(colors.background, colors.signal) >= 4.5;
}
export function parseCustomPalette(value: unknown): CustomPalette | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const palette = value as CustomPalette;
  if (!validColors(palette.light) || !validColors(palette.dark)) return undefined;
  const clean = (colors: PaletteColors): PaletteColors => ({ background: colors.background.toLowerCase(), foreground: colors.foreground.toLowerCase(), signal: colors.signal.toLowerCase() });
  return { light: clean(palette.light), dark: clean(palette.dark) };
}
const STATUS_COLORS = ['state-working', 'state-waiting', 'state-idle', 'state-done', 'state-error', 'destructive'];
const STATUS_SURFACES = ['state-working-subtle', 'state-error-subtle', 'destructive-foreground', 'diff-add', 'diff-add-strong', 'diff-remove', 'diff-remove-strong'];
const OVERRIDES = [...STATUS_COLORS, ...STATUS_SURFACES, 'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'sidebar', 'sidebar-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground', 'secondary', 'secondary-foreground', 'border', 'input', 'primary', 'primary-foreground', 'signal', 'signal-foreground', 'signal-subtle', 'ring'];
function mix(a: string, b: string, weight: number): string {
  const other = channels(b);
  return '#' + channels(a).map((channel, index) => Math.round(channel * (1 - weight) + other[index]! * weight).toString(16).padStart(2, '0')).join('');
}
export function applyPalette(root: HTMLElement, palette: PalettePreference = 'default', custom?: CustomPalette, dark = false): void {
  for (const token of OVERRIDES) root.style.removeProperty(`--${token}`);
  if (palette === 'custom' && custom !== undefined) {
    const colors = custom[dark ? 'dark' : 'light'];
    const { background, foreground, signal } = colors;
    const defaults = getComputedStyle(root);
    const statuses = STATUS_COLORS.map((name) => [name, defaults.getPropertyValue(`--${name}`).trim()] as const);
    const surface = mix(background, foreground, 0.08);
    const safeSurface = contrast(surface, foreground) >= 4.5 ? surface : background;
    const set = (names: string[], value: string) => names.forEach((name) => root.style.setProperty(`--${name}`, value));
    set(['background', 'sidebar', 'primary-foreground'], background);
    set(['foreground', 'card-foreground', 'popover-foreground', 'sidebar-foreground', 'accent-foreground', 'secondary-foreground', 'primary'], foreground);
    set(['card', 'popover'], background);
    set(['muted', 'accent', 'secondary'], safeSurface);
    set(['muted-foreground'], foreground);
    set(['border', 'input'], mix(background, foreground, 0.25));
    set(['signal', 'ring'], signal);
    set(['signal-foreground'], contrast(signal, background) >= contrast(signal, foreground) ? background : foreground);
    const subtle = mix(background, signal, 0.08);
    set(['signal-subtle'], contrast(subtle, foreground) >= 4.5 && contrast(subtle, signal) >= 4.5 ? subtle : background);
    for (const [name, value] of statuses) {
      let adjusted = isColor(value) ? value : foreground;
      for (let step = 1; step <= 10 && contrast(adjusted, background) < 4.5; step++) adjusted = mix(isColor(value) ? value : foreground, foreground, step / 10);
      set([name], adjusted);
    }
    set(STATUS_SURFACES.filter((name) => name !== 'destructive-foreground'), background);
    set(['destructive-foreground'], background);
  } else if (palette === 'forest' || palette === 'ember') {
    const base = palette === 'forest' ? 'state-working' : 'state-error';
    root.style.setProperty('--signal', `var(--${base})`);
    root.style.setProperty('--ring', `var(--${base})`);
    root.style.setProperty('--signal-subtle', `var(--${base}-subtle)`);
    root.style.setProperty('--signal-foreground', 'var(--background)');
  }
}
/** Capture the default token palette for an editable, accessible starting point. */
export function capturePalette(root: HTMLElement = document.documentElement): PaletteColors {
  const style = getComputedStyle(root);
  return Object.fromEntries(COLOR_FIELDS.map((field) => [field, style.getPropertyValue(`--${field}`).trim()])) as unknown as PaletteColors;
}
