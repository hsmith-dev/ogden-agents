import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentMark, agentMark } from '../src/ui/sidebar-rows';

describe("an agent's mark (epic 26 sweep)", () => {
  it('is two letters from its plain name: the initials of two words, else its first two letters', () => {
    expect(agentMark('Claude Code')).toBe('CC');
    expect(agentMark('Codex')).toBe('Co');
    expect(agentMark('Grok')).toBe('Gr');
    expect(agentMark('Local model')).toBe('LM');
    expect(agentMark('x')).toBe('X');
    expect(agentMark('')).toBe('');
  });

  it('ignores spacing, takes only the first two words, and counts a letter outside the BMP as one', () => {
    expect(agentMark('  grok   helper ')).toBe('GH');
    expect(agentMark('my local model')).toBe('ML');
    expect(agentMark('CODEX')).toBe('Co');
    expect(agentMark('   ')).toBe('');
    expect(agentMark('𝒜b')).toBe('𝒜b');
  });

  it('draws the letters as generated content in a box at least the compact icon wide', () => {
    const html = renderToStaticMarkup(<AgentMark agent="Codex" />);
    expect(html).toMatch(/^<span data-slot="agent-mark" data-letter="Co" aria-hidden="true" class="[^"]*\bmin-w-\(--icon-size-compact\)[^"]*\bpx-0\.5\b[^"]*"><\/span>$/);
    expect(html).not.toMatch(/\bsize-\(--icon-size-compact\)/);
  });
});
