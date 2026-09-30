import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TranscriptPermission } from '../src/chat/transcript';
import { PermissionCard } from '../src/permissions/permission-card';

const pending = (overrides: Partial<TranscriptPermission> = {}): TranscriptPermission => ({
  requestId: 'preq_1',
  toolCall: { toolCallId: 't1', title: 'Run npm install stripe', kind: 'execute', command: 'npm install stripe' },
  scope: { kind: 'command_prefix', value: 'npm install', label: 'npm install' },
  cautionLevel: 'ask_every_time',
  requestedAt: '2026-09-30T12:00:00.000Z',
  status: 'pending',
  resolution: undefined,
  ...overrides,
});

const render = (permission: TranscriptPermission) =>
  renderToStaticMarkup(<PermissionCard permission={permission} wsId="ws_1" sesId="ses_1" projectName="clay-and-kiln" />);

describe('PermissionCard (DESIGN.md Permission card; EXPERIENCE.md Permission card)', () => {
  it('shows the headline, the command, the project and caution level, and three buttons, none focused by default', () => {
    const html = render(pending());
    expect(html).toContain('Claude Code wants to run a command');
    expect(html).toMatch(/data-testid="permission-command"[^>]*>npm install stripe</);
    expect(html).toContain('clay-and-kiln · Ask every time');
    expect(html).toContain('>Allow once<');
    expect(html).toContain('>Always allow<');
    expect(html).toContain('>Deny<');
    expect(html).toContain('npm install in clay-and-kiln');
    expect(html).toContain('Reason for Deny (optional)');
    expect(html).not.toContain('autofocus');
    expect(html).not.toContain('autoFocus');
  });

  it('does not offer Always allow without a scope, and says why', () => {
    const html = render(pending({ toolCall: { toolCallId: 't1', title: 'Do something', kind: 'other' }, scope: null }));
    expect(html).toContain('Claude Code wants to use a tool');
    expect(html).toMatch(/aria-disabled="true"[^>]*>Always allow</);
    expect(html).toContain('Not offered for this kind of request');
  });

  it('offers only Allow once and Deny for an interpreter or wrapper, with the reason', () => {
    const html = render(pending({ toolCall: { toolCallId: 't1', title: 'Run bash -c ls', kind: 'execute', command: 'bash -c ls' }, scope: null }));
    expect(html).toContain('>Allow once<');
    expect(html).toContain('>Deny<');
    expect(html).not.toContain('>Always allow<');
    expect(html).toContain('Always allow isn&#x27;t offered for bash, because it can run anything.');
  });

  it('collapses to its record line once answered, with a Deny reason on it', () => {
    const allowed = render(pending({ status: 'resolved', resolution: { decision: 'allow_once', by: 'user', reason: undefined, ruleId: undefined, ruleRemoved: false, at: '2026-09-30T12:01:00.000Z' } }));
    expect(allowed).toContain('data-testid="permission-record"');
    expect(allowed).toContain('Allowed once: npm install stripe');
    expect(allowed).not.toContain('>Allow once<');

    const denied = render(pending({ status: 'resolved', resolution: { decision: 'deny', by: 'user', reason: 'Use pnpm', ruleId: undefined, ruleRemoved: false, at: '2026-09-30T12:01:00.000Z' } }));
    expect(denied).toContain('Denied: npm install stripe');
    expect(denied).toContain('Your reason: Use pnpm');

    const unanswered = render(pending({ status: 'unanswered' }));
    expect(unanswered).toContain('Not answered: npm install stripe');
    expect(unanswered).not.toContain('<button');
  });

  it('an Always allow record opens the undo popover until the rule is undone', () => {
    const always = pending({ status: 'resolved', resolution: { decision: 'allow_always', by: 'user', reason: undefined, ruleId: 'rule_1', ruleRemoved: false, at: '2026-09-30T12:01:00.000Z' } });
    expect(render(always)).toMatch(/<button[^>]*data-testid="permission-record-text"[^>]*>Always allowed: npm install stripe</);
    const undone = render({ ...always, resolution: { ...always.resolution!, ruleRemoved: true } });
    expect(undone).not.toContain('<button');
    expect(undone).toContain('Always allow undone');
  });

  it('says in one line why a protected file always asks (2.8 F1)', () => {
    const html = render(pending({ toolCall: { toolCallId: 't1', title: 'Edit .git/hooks/pre-commit', kind: 'edit', protectedPath: true }, scope: { kind: 'tool', value: 'edit', label: 'Editing files' } }));
    expect(html).toContain('It touches a file that controls how Claude Code or git runs, so Ogden Agents always asks.');
    expect(render(pending())).not.toContain('permission-protected');
  });
});
