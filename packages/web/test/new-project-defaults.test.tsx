import {
  BMAD_COMING_SOON_LABEL,
  BMAD_COMING_SOON_REASON,
  BMAD_PIECE_INFO,
  BMAD_PIECES,
  NEW_PROJECTS_SETTINGS_LABEL,
  type BmadPiece,
  type BmadPieceAvailability,
} from '@ogden-agents/shared';
import type { ReactElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { canTurnOn, NewProjectDefaultsView, type NewProjectDefaultsViewProps } from '../src/settings/new-project-defaults';
import { TooltipProvider } from '../src/ui/tooltip';

const renderToStaticMarkup = (element: ReactElement) => renderMarkup(<TooltipProvider>{element}</TooltipProvider>);

const all = (available: readonly BmadPiece[]): BmadPieceAvailability[] =>
  BMAD_PIECES.map((piece) => (available.includes(piece) ? { piece, available: true } : { piece, available: false, reason: BMAD_COMING_SOON_REASON }));

const view = (props: Partial<NewProjectDefaultsViewProps>) =>
  renderToStaticMarkup(
    <NewProjectDefaultsView pieces={[]} availability={all([])} mode={undefined} onModeChange={() => {}} onChange={() => {}} saving={false} status={undefined} {...props} />,
  );

/** The `<button>` or element carrying `data-testid="<id>"`, as markup. */
const tagOf = (html: string, id: string) => new RegExp(`<[^>]*data-testid="${id}"[^>]*>`).exec(html)?.[0] ?? '';

describe('Settings → New projects (story 10.4)', () => {
  it('shows Simple chats checked for an empty default, and no feature list', () => {
    const html = view({ availability: all(['planning', 'board']) });
    expect(html).toContain(`>${NEW_PROJECTS_SETTINGS_LABEL}<`);
    expect(tagOf(html, 'new-projects-simple_chats')).toContain('aria-checked="true"');
    expect(tagOf(html, 'new-projects-bmad_method')).toContain('aria-checked="false"');
    expect(tagOf(html, 'new-projects-bmad_method')).not.toContain('disabled=""');
    expect(html).not.toContain('data-testid="new-projects-pieces"');
  });

  it('greys BMad Method as Coming soon when none of its features ships', () => {
    const html = view({});
    expect(tagOf(html, 'new-projects-bmad_method')).toContain('disabled=""');
    expect(html).toMatch(/data-testid="new-projects-bmad-coming-soon"[^>]*>Coming soon</);
    // Not while availability loads.
    expect(view({ availability: undefined })).not.toContain(BMAD_COMING_SOON_LABEL);
  });

  it('under BMad Method lists the four features as checkboxes, the unshipped ones greyed and marked Coming soon', () => {
    const html = view({ pieces: ['planning'], availability: all(['planning', 'board']) });
    expect(tagOf(html, 'new-projects-bmad_method')).toContain('aria-checked="true"');
    expect(html.match(/role="checkbox"/g)).toHaveLength(4);
    for (const piece of BMAD_PIECES) expect(html).toContain(`>${BMAD_PIECE_INFO[piece].label}<`);
    expect(tagOf(html, 'new-projects-planning')).toContain('aria-checked="true"');
    expect(tagOf(html, 'new-projects-board')).not.toContain('disabled=""');
    expect(tagOf(html, 'new-projects-builds')).toContain('disabled=""');
    expect(html).toContain('data-testid="new-projects-builds-coming-soon"');
    expect(html).not.toContain('data-testid="new-projects-planning-coming-soon"');
  });

  it('keeps BMad Method shown while chosen with no feature on yet', () => {
    expect(view({ mode: 'bmad_method', availability: all(['planning']) })).toContain('data-testid="new-projects-pieces"');
  });

  it('says what was saved, or why not', () => {
    expect(view({ status: { kind: 'saved', text: 'Saved.' } })).toMatch(/role="status"[^>]*>Saved\.</);
    expect(view({ status: { kind: 'error', text: 'Nope.' } })).toMatch(/data-testid="new-projects-error"[^>]*>.*Nope\./);
    expect(view({ pieces: undefined })).not.toContain('role="radio"');
  });

  it('a feature can be turned on only when it and what it needs ship', () => {
    expect(canTurnOn([], 'builds', all(['board', 'builds']))).toBe(true);
    expect(canTurnOn([], 'builds', all(['builds']))).toBe(false);
    expect(canTurnOn(['board'], 'builds', all(['builds']))).toBe(true);
    expect(canTurnOn([], 'planning', undefined)).toBe(false);
  });
});
