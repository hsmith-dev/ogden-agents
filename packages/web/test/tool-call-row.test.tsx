/**
 * Tool-call rows by held state and detail level (epic 26 story 4): a call its
 * card holds reads "Waiting for you", a denied one "Denied" without "Failed";
 * Normal groups a run with held calls on their own rows below it, Verbose
 * lists every call with its diff open.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToolCalls, toolCallLabel } from '../src/chat/tool-call-row';
import type { ChatDetail } from '../src/chat/detail-level';
import type { TranscriptToolCall } from '../src/chat/transcript';
import { TooltipProvider } from '../src/ui/tooltip';

const call = (toolCallId: string, kind: TranscriptToolCall['kind'], title: string, overrides: Partial<TranscriptToolCall> = {}): TranscriptToolCall => ({
  toolCallId,
  title,
  kind,
  status: 'completed',
  diffs: undefined,
  ...overrides,
});

const render = (calls: TranscriptToolCall[], detail: ChatDetail) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ToolCalls calls={calls} detail={detail} />
    </TooltipProvider>,
  );

const npmTest = (overrides: Partial<TranscriptToolCall>) => call('t_run', 'execute', 'Run npm test', overrides);

describe('a tool row says the call’s real state', () => {
  it('held at its card: "Waiting for you:", never Running', () => {
    expect(toolCallLabel(npmTest({ status: 'pending', held: 'waiting' }))).toEqual({ verb: 'Waiting for you:', target: 'npm test' });
    const html = render([npmTest({ status: 'pending', held: 'waiting' })], 'normal');
    expect(html).toContain('data-state="waiting"');
    expect(html).not.toContain('data-state="working"');
    expect(html).not.toContain('Running');
  });

  it('allowed: Running with the working glyph; finished: Ran', () => {
    expect(toolCallLabel(npmTest({ status: 'pending' }))).toEqual({ verb: 'Running', target: 'npm test' });
    expect(toolCallLabel(npmTest({ status: 'in_progress' }))).toEqual({ verb: 'Running', target: 'npm test' });
    expect(render([npmTest({ status: 'in_progress' })], 'normal')).toContain('data-state="working"');
    expect(toolCallLabel(npmTest({ status: 'completed' }))).toEqual({ verb: 'Ran', target: 'npm test' });
  });

  it('denied: "Denied:" and no Failed tag', () => {
    expect(toolCallLabel(npmTest({ status: 'failed', held: 'denied' }))).toEqual({ verb: 'Denied:', target: 'npm test' });
    const html = render([npmTest({ status: 'failed', held: 'denied' })], 'normal');
    expect(html).toContain('Denied:');
    expect(html).not.toContain('Failed');
    // A failure without a denial still says so.
    expect(render([npmTest({ status: 'failed' })], 'normal')).toContain('Failed');
  });
});

describe('the detail level decides how much shows', () => {
  const diff = { path: 'src/a.ts', oldText: 'export const a = 1;\n', newText: 'export const a = 2;\n' };
  const run = [call('r1', 'read', 'Read src/a.ts'), call('r2', 'read', 'Read src/b.ts'), call('r3', 'read', 'Read src/c.ts'), call('e1', 'edit', 'Edit src/a.ts', { diffs: [diff] })];

  it('Normal groups a run into one row, closed', () => {
    const html = render(run, 'normal');
    expect(html).toContain('data-testid="tool-call-group"');
    expect(html).toContain('Read 3 files, edited 1');
    expect(html).not.toContain('data-testid="tool-call-row"');
  });

  it('Normal shows a held call on its own row below the group of the others', () => {
    const html = render([call('r1', 'read', 'Read a'), call('r2', 'read', 'Read b'), npmTest({ status: 'pending', held: 'waiting' })], 'normal');
    expect(html).toContain('Read 2 files');
    expect(html).not.toContain('ran 1 command');
    expect(html.indexOf('tool-call-group')).toBeLessThan(html.indexOf('Waiting for you:'));
    expect(html.match(/data-testid="tool-call-row"/g)).toHaveLength(1);
  });

  it('Normal with one call left beside a held one lists both as rows', () => {
    const html = render([call('r1', 'read', 'Read a'), npmTest({ status: 'pending', held: 'waiting' })], 'normal');
    expect(html).not.toContain('tool-call-group');
    expect(html.match(/data-testid="tool-call-row"/g)).toHaveLength(2);
  });

  it('Verbose lists every call, the edit’s hunk open without a click', () => {
    const html = render(run, 'verbose');
    expect(html).not.toContain('tool-call-group');
    expect(html.match(/data-testid="tool-call-row"/g)).toHaveLength(4);
    expect(html).toContain('data-testid="tool-call-detail"');
    // The edit's file in the diff viewer, inline, with its signs and line labels.
    expect(html).toContain('data-testid="diff-viewer" data-layout="inline"');
    expect(html).toContain('aria-label="Changes in src/a.ts"');
    const text = (kind: string) => new RegExp(`data-kind="${kind}"[^>]*>((?:(?!</tr>).)*)`).exec(html)![1]!.replace(/<[^>]+>/g, '');
    expect(text('remove')).toBe('1-Removed line 1: export const a = 1;');
    expect(text('add')).toBe('1+Added line 1: export const a = 2;');
    expect(html).not.toContain('data-slot="diff-toolbar"');
    expect(html).toContain('aria-expanded="true"');
  });
});
