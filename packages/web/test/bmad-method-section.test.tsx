/**
 * The BMad Method section's view and choice rules (story 10.5), as static
 * markup: the main switch and the four pieces with their labels, sentences
 * and descriptions wired by `aria-describedby`; Coming soon and the needs
 * reason in text; which switches are disabled; the status line and the
 * refusal notice; the 10.3/10.4 slots only when given. The DOM wiring
 * (saves, revert, other tabs, the anchor) is in `bmad-method-section.dom.test.tsx`.
 */
import {
  BMAD_COMING_SOON_LABEL,
  BMAD_FILES_STAY_TEXT,
  BMAD_OFF_TEXT,
  BMAD_ON_TEXT,
  BMAD_PIECE_INFO,
  BMAD_PIECES,
  BMAD_USE_DESCRIPTION,
  BMAD_USE_LABEL,
  WORKSPACE_SETTINGS_BMAD_ANCHOR,
  type BmadPiece,
} from '@ogden-agents/shared';
import type { ReactElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BmadMethodView, bmadToggleChoice, bmadUseChoice, type BmadAvailability, type BmadMethodViewProps } from '../src/workspaces/bmad-method-section';
import { TooltipProvider } from '../src/ui/tooltip';

/** The error notice's glyph has a tooltip, as in the app shell. */
const renderToStaticMarkup = (element: ReactElement) => renderMarkup(<TooltipProvider>{element}</TooltipProvider>);

const shipping = (...available: BmadPiece[]): BmadAvailability =>
  Object.fromEntries(BMAD_PIECES.map((piece) => [piece, available.includes(piece)])) as Record<BmadPiece, boolean>;

const view = (props: Partial<BmadMethodViewProps>) =>
  renderToStaticMarkup(
    <BmadMethodView pieces={[]} availability={shipping(...BMAD_PIECES)} saving={false} status={undefined} error={undefined} onToggle={() => {}} onUseBmad={() => {}} {...props} />,
  );

/** The `<button role="switch">` with this test id, as markup. */
const switchTag = (html: string, testId: string) => html.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? '';
const disabled = (html: string, testId: string) => / disabled=""/.test(switchTag(html, testId));
const checked = (html: string, testId: string) => /aria-checked="true"/.test(switchTag(html, testId));
const unescape = (html: string) => html.replace(/&#x27;/g, "'");
/** The text of the element with this id. */
const textOf = (html: string, id: string) =>
  unescape(html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</p>`))?.[1] ?? '').replace(/<[^>]+>/g, '');

describe('BmadMethodView (story 10.5)', () => {
  it('shows the section heading at the anchor, the main switch and the four pieces, each named and described', () => {
    const html = view({});
    expect(html).toContain(`id="${WORKSPACE_SETTINGS_BMAD_ANCHOR}"`);
    expect(html).toMatch(/<h2[^>]*tabindex="-1"[^>]*>BMad Method<\/h2>/);
    expect(html).toContain(`for="bmad-use"`);
    expect(html).toContain(`>${BMAD_USE_LABEL}<`);
    expect(switchTag(html, 'bmad-use')).toContain('aria-describedby="bmad-use-description"');
    expect(textOf(html, 'bmad-use-description')).toContain(BMAD_USE_DESCRIPTION);
    for (const piece of BMAD_PIECES) {
      const info = BMAD_PIECE_INFO[piece];
      expect(html).toContain(`for="bmad-${piece}"`);
      expect(html).toContain(`>${info.label}<`);
      expect(switchTag(html, `bmad-${piece}`)).toContain(`id="bmad-${piece}"`);
      expect(switchTag(html, `bmad-${piece}`)).toContain(`aria-describedby="bmad-${piece}-description"`);
      expect(textOf(html, `bmad-${piece}-description`)).toContain(info.sentence);
      expect(disabled(html, `bmad-${piece}`), piece).toBe(false);
    }
    // In canonical order, after the main switch.
    const order = ['bmad-use', ...BMAD_PIECES.map((piece) => `bmad-${piece}`)].map((id) => html.indexOf(`data-testid="${id}"`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain(BMAD_COMING_SOON_LABEL);
    expect(html).not.toMatch(/[–—]/);
  });

  it('the main switch is derived: on while any piece is on', () => {
    expect(checked(view({ pieces: [] }), 'bmad-use')).toBe(false);
    const html = view({ pieces: ['board', 'builds'] });
    expect(checked(html, 'bmad-use')).toBe(true);
    expect(checked(html, 'bmad-board')).toBe(true);
    expect(checked(html, 'bmad-builds')).toBe(true);
    expect(checked(html, 'bmad-planning')).toBe(false);
  });

  it('nothing shipped: four rows greyed and Coming soon, every switch disabled, the main switch too', () => {
    const html = view({ availability: shipping() });
    for (const piece of BMAD_PIECES) {
      expect(disabled(html, `bmad-${piece}`), piece).toBe(true);
      expect(html).toMatch(new RegExp(`data-testid="bmad-${piece}-coming-soon"[^>]*>${BMAD_COMING_SOON_LABEL}<`));
      expect(textOf(html, `bmad-${piece}-description`)).toContain(BMAD_COMING_SOON_LABEL);
    }
    expect(disabled(html, 'bmad-use')).toBe(true);
    expect(html).toMatch(/data-testid="bmad-use-coming-soon"[^>]*>Coming soon</);
  });

  it('needs unavailable: builds ships but Board does not, so builds is disabled and says why', () => {
    const html = view({ availability: shipping('builds') });
    expect(disabled(html, 'bmad-builds')).toBe(true);
    expect(html).not.toContain('data-testid="bmad-builds-coming-soon"');
    expect(textOf(html, 'bmad-builds-description')).toContain("Needs Board, which isn't in this version yet.");
    expect(textOf(html, 'bmad-retrospectives-description')).toContain(BMAD_COMING_SOON_LABEL);
  });

  it('a stored piece now unavailable shows on, Coming soon, and can be turned off', () => {
    const html = view({ pieces: ['planning'], availability: shipping() });
    expect(checked(html, 'bmad-planning')).toBe(true);
    expect(disabled(html, 'bmad-planning')).toBe(false);
    expect(html).toContain('data-testid="bmad-planning-coming-soon"');
    // The main switch is on and can be turned off; it isn't marked Coming soon while BMad is on.
    expect(checked(html, 'bmad-use')).toBe(true);
    expect(disabled(html, 'bmad-use')).toBe(false);
    expect(html).not.toContain('data-testid="bmad-use-coming-soon"');
  });

  it('while loading, no switches; while availability loads, nothing can be turned on and nothing says Coming soon', () => {
    expect(view({ pieces: undefined })).not.toContain('role="switch"');
    const html = view({ pieces: ['board'], availability: undefined });
    expect(disabled(html, 'bmad-planning')).toBe(true);
    expect(disabled(html, 'bmad-board')).toBe(false);
    expect(disabled(html, 'bmad-use')).toBe(false);
    expect(html).not.toContain(BMAD_COMING_SOON_LABEL);
  });

  it('while a save is in flight, every switch is disabled and the list is busy', () => {
    const html = view({ pieces: ['planning'], saving: true });
    for (const id of ['bmad-use', ...BMAD_PIECES.map((piece) => `bmad-${piece}`)]) expect(disabled(html, id), id).toBe(true);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="BMad Method features"');
  });

  it('the status line is polite; a refusal is an alert', () => {
    const html = view({ status: BMAD_ON_TEXT, error: 'Nope.' });
    expect(html).toMatch(/role="status"[^>]*data-testid="bmad-status"[^>]*>BMad Method is on in this project\.</);
    expect(html).toMatch(/role="alert"[^>]*data-testid="bmad-error"[^>]*>.*Nope\./);
    expect(view({})).not.toContain('data-testid="bmad-error"');
  });

  it('renders the 10.3 and 10.4 slots above the main switch only when given', () => {
    const none = view({});
    expect(none).not.toContain('bmad-offer-slot');
    expect(none).not.toContain('bmad-default-slot');
    const html = view({ offerSlot: <span>offer</span>, defaultSlot: <span>default</span> });
    expect(html).toContain('data-testid="bmad-offer-slot"');
    expect(html).toContain('data-testid="bmad-default-slot"');
    expect(html.indexOf('bmad-offer-slot')).toBeLessThan(html.indexOf('data-testid="bmad-use"'));
    expect(html.indexOf('bmad-default-slot')).toBeLessThan(html.indexOf('data-testid="bmad-use"'));
  });
});

describe('the choices (story 10.5)', () => {
  it('a piece: the shared rule, its note, and the off line when nothing is left', () => {
    expect(bmadToggleChoice([], 'builds', true)).toEqual({ pieces: ['board', 'builds'], status: `${BMAD_ON_TEXT} Board was turned on too, because the feature you chose needs it.` });
    // From all off, one piece on says BMad is on, as the reverse says it is off.
    expect(bmadToggleChoice([], 'planning', true)).toEqual({ pieces: ['planning'], status: BMAD_ON_TEXT });
    expect(bmadToggleChoice(['board', 'builds'], 'board', false)).toEqual({
      pieces: [],
      status: `Unattended builds was turned off too, because it needs the feature you turned off. ${BMAD_OFF_TEXT}`,
    });
    expect(bmadToggleChoice(['planning'], 'board', true)).toEqual({ pieces: ['planning', 'board'], status: undefined });
    expect(bmadToggleChoice(['planning'], 'planning', false)).toEqual({ pieces: [], status: BMAD_OFF_TEXT });
    expect(BMAD_OFF_TEXT).toContain(BMAD_FILES_STAY_TEXT);
  });

  it('the main switch: on adds the preselected pieces that ship; off turns every piece off', () => {
    expect(bmadUseChoice([], true, ['planning', 'board', 'builds'])).toEqual({ pieces: ['planning', 'board'], status: BMAD_ON_TEXT });
    expect(bmadUseChoice([], true, ['board'])).toEqual({ pieces: ['board'], status: BMAD_ON_TEXT });
    expect(bmadUseChoice(['board', 'builds'], false, [...BMAD_PIECES])).toEqual({ pieces: [], status: BMAD_OFF_TEXT });
  });
});
