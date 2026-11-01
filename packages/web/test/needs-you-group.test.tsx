import { createMemoryHistory, createRootRoute, createRoute, createRouter, Link, RouterProvider } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NeedsYouGroup, needsYouGlyph, type NeedsYouItem } from '../src/shell/needs-you-group';
import { SidebarProvider, SidebarStatusRow, SidebarWorkspaceGroup } from '../src/ui/sidebar';
import { TooltipProvider } from '../src/ui/tooltip';

/** Renders `node` inside a router that knows the session route, so its links get their hrefs. */
async function renderInRouter(node: ReactNode, at = '/'): Promise<string> {
  const root = createRootRoute({
    component: () => (
      <TooltipProvider>
        <SidebarProvider>{node}</SidebarProvider>
      </TooltipProvider>
    ),
  });
  const session = createRoute({ getParentRoute: () => root, path: '/w/$wsId/s/$sesId' });
  const review = createRoute({ getParentRoute: () => root, path: '/w/$wsId/review/$ref' });
  const chats = createRoute({ getParentRoute: () => root, path: '/w/$wsId' });
  const settings = createRoute({ getParentRoute: () => root, path: '/w/$wsId/settings' });
  const router = createRouter({ routeTree: root.addChildren([session, review, chats, settings]), history: createMemoryHistory({ initialEntries: [at] }) });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

const render = (items: readonly NeedsYouItem[]) => renderInRouter(<NeedsYouGroup items={items} />);

const permission: NeedsYouItem = { id: 'req_x', kind: 'permission', wsId: 'ws_a', sesId: 'ses_a', workspaceName: 'Clay and kiln', chatName: 'Fix the login bug', text: 'Claude Code wants to run npm test' };
const rowOf = (html: string, n = 0) => [...html.matchAll(/<a[^>]*data-testid="needs-you-item"[^>]*>([\s\S]*?)<\/a>/g)][n]!;
const many = (n: number): NeedsYouItem[] => Array.from({ length: n }, (_, i) => ({ id: `req_${i}`, kind: 'waiting', wsId: 'ws_a', sesId: `ses_${i}`, workspaceName: 'Letterpress', chatName: `Chat ${i}`, text: 'Claude Code is waiting for you' }));

describe('Needs you group (DESIGN.md needs-you-group and needs-you-row; EXPERIENCE.md Needs you group, Responsive & Platform)', () => {
  it('renders nothing while nothing needs the user, in any form', async () => {
    const html = await render([]);
    expect(html).not.toContain('needs-you');
    expect(html).not.toContain('Needs you');
  });

  it('in the rail (md to lg) it is a counted button, and the full panel is hidden there', async () => {
    const items = [
      { id: 'a', wsId: 'ws_a', sesId: 'ses_a', workspaceName: 'Clay and kiln', text: 'Claude Code wants to run npm test' },
      { id: 'b', wsId: 'ws_b', sesId: 'ses_b', workspaceName: 'Letterpress', text: 'Claude Code is waiting for you' },
    ];
    const html = await render(items);

    const rail = /<button[^>]*data-testid="needs-you-rail"[^>]*>([\s\S]*?)<\/button>/.exec(html);
    expect(rail).not.toBeNull();
    expect(rail![0]).toContain('aria-label="Needs you, 2"');
    // Shown only in the rail form, with the count visible.
    expect(rail![0]).toMatch(/class="[^"]*\bhidden\b[^"]*\bmd:max-lg:flex\b/);
    expect(rail![1]).toMatch(/>2<\/span>/);

    const panel = /<section[^>]*data-testid="needs-you"[^>]*>/.exec(html)![0];
    expect(panel).toMatch(/\bmd:max-lg:hidden\b/);
  });

  it('a row is two lines: what, in full words and clamped only at its end, then the project and chat on one line', async () => {
    const [row, inner] = rowOf(await render([permission]));
    const what = /<span data-testid="needs-you-what" class="([^"]*)">([^<]*)<\/span>/.exec(inner!)!;
    expect(what[2]).toBe('Claude Code wants to run npm test');
    expect(what[1]).toMatch(/\bline-clamp-2\b/);
    expect(what[1]).not.toMatch(/\btruncate\b/);
    expect(what[1]).toMatch(/\btext-label\b/);
    const where = /<span data-testid="needs-you-where" class="([^"]*)">([\s\S]*?)<\/span>/.exec(inner!)!;
    expect(where[1]).toMatch(/\btruncate\b.*\btext-caption\b.*\btext-muted-foreground\b/);
    expect(where[2]).toBe('<bdi>Clay and kiln</bdi>, <bdi>Fix the login bug</bdi>');
    // Its height grows with its lines.
    expect(row).toMatch(/\bh-auto\b/);
  });

  it('its accessible name reads both lines', async () => {
    const [row] = rowOf(await render([permission, { ...permission, id: 'b', kind: 'pane', chatName: undefined, text: 'Terminal 1 may need you' }]));
    expect(row).toContain('aria-label="Claude Code wants to run npm test, in Clay and kiln, Fix the login bug"');
    const [pane] = rowOf(await render([{ ...permission, id: 'b', kind: 'pane', paneId: 'pane_1', sesId: '', chatName: undefined, text: 'Terminal 1 may need you' }]));
    expect(pane).toContain('aria-label="Terminal 1 may need you, in Clay and kiln"');
  });

  it('a kind glyph tells permission, question, review and blocked rows apart', async () => {
    const kinds = [
      ['permission', 'permission'],
      ['waiting', 'question'],
      ['check_in', 'question'],
      ['sign_in', 'question'],
      ['pane', 'question'],
      ['run_review', 'review'],
      ['run_blocked', 'blocked'],
    ] as const;
    for (const [kind, glyph] of kinds) {
      const [, inner] = rowOf(await render([{ ...permission, kind, ...(kind === 'run_review' ? { reviewRef: '1.2' } : {}) }]));
      expect(inner, kind).toMatch(new RegExp(`data-slot="needs-you-glyph" data-glyph="${glyph}" aria-hidden="true"`));
    }
    expect(needsYouGlyph({ reviewRef: '1.2' })).toBe('review');
    expect(needsYouGlyph({})).toBe('question');
  });

  it('a permission row links to its card in the chat; any other chat need to the chat; a review to its review page', async () => {
    expect(rowOf(await render([permission]))[0]).toContain('href="/w/ws_a/s/ses_a#permission-req_x"');
    expect(rowOf(await render([{ ...permission, kind: 'waiting', id: 'waiting:ses_a:1' }]))[0]).toContain('href="/w/ws_a/s/ses_a"');
    expect(rowOf(await render([{ ...permission, kind: 'run_review', id: 'run_review:run_1', reviewRef: '1.2' }]))[0]).toContain('href="/w/ws_a/review/1.2"');
  });

  it('five rows show, then "Show N more"', async () => {
    const html = await render(many(8));
    expect([...html.matchAll(/data-testid="needs-you-item"/g)]).toHaveLength(5);
    expect(html).toMatch(/<button[^>]*data-testid="needs-you-more"[^>]*aria-expanded="false"[^>]*>Show 3 more<\/button>/);
    // The count is the whole list's.
    expect(html).toMatch(/Needs you<span[^>]*>8<\/span>/);
    const five = await render(many(5));
    expect([...five.matchAll(/data-testid="needs-you-item"/g)]).toHaveLength(5);
    expect(five).not.toContain('needs-you-more');
  });
});

describe('workspace groups and status rows (DESIGN.md Workspace group and Status row)', () => {
  const group = (collapsed: boolean, { current = false, at = '/' }: { current?: boolean; at?: string } = {}) =>
    renderInRouter(
      <SidebarWorkspaceGroup
        name="Letterpress"
        collapsed={collapsed}
        onCollapsedChange={() => {}}
        summary={[{ state: 'working', count: 2 }, { state: 'waiting', count: 1 }]}
        current={current}
        link={<Link to="/w/$wsId" params={{ wsId: 'ws_b' }} activeOptions={{ exact: true }} />}
        settingsLink={<Link to="/w/$wsId/settings" params={{ wsId: 'ws_b' }} />}
      >
        <SidebarStatusRow state="waiting" title="Chat" caption="Claude Code, waiting for you" time={{ label: '5m', dateTime: '2026-09-30T11:55:00.000Z' }}>
          <Link to="/w/$wsId/s/$sesId" params={{ wsId: 'ws_b', sesId: 'ses_b' }} />
        </SidebarStatusRow>
      </SidebarWorkspaceGroup>,
      at,
    );

  it('a group is named by its workspace, with a disclosure that says whether it is open', async () => {
    const html = await group(false);
    expect(html).toMatch(/<div role="group" aria-label="Letterpress"/);
    expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*aria-controls="[^"]+"[^>]*aria-label="Chats in Letterpress"/);
    // Open: the chevron points down, and no summary.
    expect(html).toMatch(/<svg[^>]*class="[^"]*\brotate-90\b/);
    expect(html).not.toContain('sidebar-state-summary');
  });

  it('collapsed, it shows one glyph and count per state, in words too; the rail still shows its rows', async () => {
    const html = await group(true);
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).not.toMatch(/\brotate-90\b/);
    const summary = /<span data-slot="sidebar-state-summary"[\s\S]*?<\/span><\/span><\/span><\/span>/.exec(html)![0];
    expect(summary).toContain('Working </span>');
    expect(summary).toContain('Waiting for you </span>');
    expect(summary).toMatch(/data-state="working"[\s\S]*>2<\/span>/);
    expect(html).toMatch(/class="[^"]*\bhidden md:max-lg:flex\b/);
  });

  it('the name opens the project, the gear its settings; neither is the disclosure (backlog story 13)', async () => {
    const html = await group(false);
    const name = /<a[^>]*data-slot="sidebar-workspace-link"[^>]*>([\s\S]*?)<\/a>/.exec(html)!;
    expect(name[0]).toContain('href="/w/ws_b"');
    expect(name[0]).not.toContain('aria-current');
    expect(name[1]).toMatch(/data-slot="sidebar-label"[^>]*>Letterpress<\/span>/);
    // The rail shows a folder icon in place of the name.
    expect(name[1]).toMatch(/<svg[^>]*class="[^"]*\bhidden md:max-lg:block\b/);
    const gear = /<a[^>]*data-slot="sidebar-workspace-settings"[^>]*>/.exec(html)![0];
    expect(gear).toContain('href="/w/ws_b/settings"');
    expect(gear).toContain('aria-label="Letterpress settings"');
    // Not hover-only: always shown in the full sidebar and the drawer; the rail has no room.
    expect(gear).not.toMatch(/opacity-0|group-hover/);
    expect(gear).toMatch(/md:max-lg:hidden/);
  });

  it('the current project is marked: `page` on its own Chats list, `true` anywhere else inside it', async () => {
    const onChats = await group(false, { current: true, at: '/w/ws_b' });
    expect(/<a[^>]*data-slot="sidebar-workspace-link"[^>]*>/.exec(onChats)![0]).toContain('aria-current="page"');
    const inChat = await group(false, { current: true, at: '/w/ws_b/s/ses_b' });
    const link = /<a[^>]*data-slot="sidebar-workspace-link"[^>]*>/.exec(inChat)![0];
    expect(link).toContain('aria-current="true"');
    expect(link).toContain('data-active="true"');
    expect(inChat).toContain('data-current="true"');
  });

  it('a row links to its session, with title and state as its accessible name, a tooltip in the rail, and the signal rail when waiting', async () => {
    const html = await group(false);
    const row = /<a[^>]*data-slot="sidebar-menu-button"[^>]*>([\s\S]*?)<\/a>/.exec(html)!;
    expect(row[0]).toContain('href="/w/ws_b/s/ses_b"');
    expect(row[0]).toContain('aria-label="Chat, Claude Code, waiting for you"');
    expect(row[0]).toContain('data-session-state="waiting"');
    expect(row[0]).toMatch(/border-l-signal/);
    // The glyph alone in the rail: the text column is visually hidden there.
    expect(row[1]).toMatch(/data-slot="state-glyph" data-state="waiting" aria-hidden="true"/);
    expect(row[1]).toMatch(/md:max-lg:sr-only[^>]*><bdi class="truncate">Chat<\/bdi>/);
    expect(row[1]).toMatch(/<time datetime="2026-09-30T11:55:00.000Z"[^>]*tabular-nums[^>]*>5m<\/time>/i);
  });
});
