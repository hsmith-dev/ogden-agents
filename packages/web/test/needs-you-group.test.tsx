import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NeedsYouGroup, type NeedsYouItem } from '../src/shell/needs-you-group';
import { SidebarProvider } from '../src/ui/sidebar';
import { TooltipProvider } from '../src/ui/tooltip';

const render = (items: readonly NeedsYouItem[]) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <SidebarProvider>
        <NeedsYouGroup items={items} />
      </SidebarProvider>
    </TooltipProvider>,
  );

describe('Needs you group (DESIGN.md needs-you-group; EXPERIENCE.md Responsive & Platform)', () => {
  it('renders nothing while nothing needs the user, in any form', () => {
    const html = render([]);
    expect(html).not.toContain('needs-you');
    expect(html).not.toContain('Needs you');
  });

  it('in the rail (md to lg) it is a counted button, and the full panel is hidden there', () => {
    const items = [
      { id: 'a', workspaceName: 'Clay and kiln', text: 'Claude Code wants to run a command' },
      { id: 'b', workspaceName: 'Letterpress', text: '2.1 is ready for review' },
    ];
    const html = render(items);

    const rail = /<button[^>]*data-testid="needs-you-rail"[^>]*>([\s\S]*?)<\/button>/.exec(html);
    expect(rail).not.toBeNull();
    expect(rail![0]).toContain('aria-label="Needs you, 2"');
    // Shown only in the rail form, with the count visible.
    expect(rail![0]).toMatch(/class="[^"]*\bhidden\b[^"]*\bmd:max-lg:flex\b/);
    expect(rail![1]).toMatch(/>2<\/span>/);

    const panel = /<section[^>]*data-testid="needs-you"[^>]*>/.exec(html)![0];
    expect(panel).toMatch(/\bmd:max-lg:hidden\b/);
    expect(html).toContain('Clay and kiln: Claude Code wants to run a command');
  });
});
