import { BMAD_COMING_SOON_LABEL, BMAD_PIECE_INFO, WORKSPACE_SETTINGS_BMAD_ANCHOR, type PermissionRule, type PermissionRuleId, type WorkspaceId } from '@ogden-agents/shared';
import type { ReactElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AlwaysAllowRulesView, BmadMethodView, CAUTION_OPTIONS, CautionLevelView } from '../src/routes/workspace-settings-page';
import { TooltipProvider } from '../src/ui/tooltip';
import { createLatestGate } from '../src/workspaces/workspace-settings-api';

/** The error notice's glyph has a tooltip, as in the app shell. */
const renderToStaticMarkup = (element: ReactElement) => renderMarkup(<TooltipProvider>{element}</TooltipProvider>);

const rule = (id: string, scope: PermissionRule['scope']): PermissionRule => ({
  id: `rule_01J9Z3K4M5N6P7Q8R9S0T1V2${id}` as PermissionRuleId,
  workspaceId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId,
  scope,
  createdAt: '2026-09-30T12:00:00.000Z',
});

describe('workspace settings page (story 2.8)', () => {
  it('shows the three caution levels as radios, strictest first, with the current one checked', () => {
    const html = renderToStaticMarkup(<CautionLevelView value="ask_for_commands" onChange={() => {}} saving={false} status={undefined} />);
    const order = ['Ask every time', 'Ask for commands', 'Ask only for risky actions'].map((label) => html.indexOf(`>${label}<`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*data-testid="caution-ask_for_commands"|data-testid="caution-ask_for_commands"[^>]*aria-checked="true"|aria-checked="true"[^>]*id="caution-ask_for_commands"|id="caution-ask_for_commands"[^>]*aria-checked="true"/);
    for (const { description } of Object.values(CAUTION_OPTIONS)) expect(html).toContain(description.replace(/'/g, '&#x27;'));
    expect(html).toContain('never to one already shown');
  });

  it('says what was saved, or why not, in its status line', () => {
    const saved = renderToStaticMarkup(<CautionLevelView value="ask_risky_only" onChange={() => {}} saving={false} status={{ kind: 'saved', text: 'Saved: Ask only for risky actions.' }} />);
    expect(saved).toMatch(/role="status"[^>]*>Saved: Ask only for risky actions\.</);
    const failed = renderToStaticMarkup(<CautionLevelView value="ask_every_time" onChange={() => {}} saving={false} status={{ kind: 'error', text: 'Nope.' }} />);
    expect(failed).toMatch(/data-testid="caution-error"[^>]*>.*Nope\./);
    expect(renderToStaticMarkup(<CautionLevelView value={undefined} onChange={() => {}} saving={false} status={undefined} />)).not.toContain('role="radio"');
  });

  it('lists the rules oldest first with the project and Remove, or says there are none', () => {
    const rules = [
      rule('A1', { kind: 'command_prefix', value: 'npm test', label: 'npm test' }),
      rule('B2', { kind: 'tool', value: 'edit', label: 'Editing files' }),
    ];
    const html = renderToStaticMarkup(<AlwaysAllowRulesView rules={rules} name="clay-and-kiln" onRemove={() => {}} removing={undefined} error={undefined} />);
    expect(html.indexOf('npm test')).toBeLessThan(html.indexOf('Editing files'));
    expect(html).toMatch(/<code[^>]*>npm test<\/code> in clay-and-kiln/);
    expect(html).toContain('Editing files in clay-and-kiln');
    expect(html.match(/>Remove</g)).toHaveLength(2);
    expect(html).toContain('aria-label="Remove npm test in clay-and-kiln"');

    const removing = renderToStaticMarkup(<AlwaysAllowRulesView rules={rules} name="clay-and-kiln" onRemove={() => {}} removing={rules[0]!.id} error="That rule was already removed." />);
    expect(removing).toContain('Removing...');
    expect(removing).toContain('That rule was already removed.');

    const empty = renderToStaticMarkup(<AlwaysAllowRulesView rules={[]} name="clay-and-kiln" onRemove={() => {}} removing={undefined} error={undefined} />);
    expect(empty).toContain('No rules yet.');
    expect(empty).not.toContain('>Remove<');
  });

  it('only the latest save is used; an earlier answer landing late is stale (review F4)', () => {
    const gate = createLatestGate();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isLatest(first)).toBe(false);
    expect(gate.isLatest(second)).toBe(true);
  });
});

describe('the BMad Method switch (story 10.1, availability 10.2)', () => {
  it('shows Planning as a switch in its state, says files are never changed, and shows a save error', () => {
    const off = renderToStaticMarkup(<BmadMethodView planning={false} available onChange={() => {}} saving={false} error={undefined} />);
    expect(off).toContain('>BMad Method<');
    expect(off).toContain(`id="${WORKSPACE_SETTINGS_BMAD_ANCHOR}"`);
    expect(off).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(off).not.toMatch(/role="switch"[^>]* disabled=""/);
    expect(off).toContain('>Planning<');
    expect(off).toContain(BMAD_PIECE_INFO.planning.sentence);
    expect(off).toContain('never changed');
    expect(off).not.toContain(BMAD_COMING_SOON_LABEL);
    const on = renderToStaticMarkup(<BmadMethodView planning available onChange={() => {}} saving={false} error="Nope." />);
    expect(on).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(on).toMatch(/data-testid="bmad-error"[^>]*>.*Nope\./);
    expect(renderToStaticMarkup(<BmadMethodView planning={undefined} available onChange={() => {}} saving={false} error={undefined} />)).not.toContain('role="switch"');
  });

  it('greys an unavailable Planning as Coming soon and refuses to turn it on, but lets one already on be turned off', () => {
    const off = renderToStaticMarkup(<BmadMethodView planning={false} available={false} onChange={() => {}} saving={false} error={undefined} />);
    expect(off).toMatch(/role="switch"[^>]* disabled=""/);
    expect(off).toMatch(/data-testid="bmad-planning-coming-soon"[^>]*>Coming soon</);
    const on = renderToStaticMarkup(<BmadMethodView planning available={false} onChange={() => {}} saving={false} error={undefined} />);
    expect(on).toContain(BMAD_COMING_SOON_LABEL);
    expect(on).not.toMatch(/role="switch"[^>]* disabled=""/);
    // While availability loads, an off switch can't be turned on yet, and nothing says Coming soon.
    const loading = renderToStaticMarkup(<BmadMethodView planning={false} available={undefined} onChange={() => {}} saving={false} error={undefined} />);
    expect(loading).toMatch(/role="switch"[^>]* disabled=""/);
    expect(loading).not.toContain(BMAD_COMING_SOON_LABEL);
  });
});
