/**
 * What each command palette source offers in each context (epic 26 story
 * 3): chats from every project (on the empty query, the last 5 opened that
 * still exist), projects, the current project's tickets (none without a
 * project or on the empty query), and actions: New chat only in a project,
 * Go to Needs you only with something waiting, the detail level only on a
 * chat (naming the other level), each Settings group, the themes not in use.
 * The sources are a constant list with the reserved Files slot in the order.
 */
import type { TicketRow } from '@ogden-agents/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  actionItems,
  chatItems,
  PALETTE_EMPTY_ORDER,
  PALETTE_GROUP_ORDER,
  PALETTE_SOURCES,
  projectItems,
  ticketItems,
  type ActionInputs,
} from '../src/palette/palette-sources';
import { SETTINGS_GROUPS, visibleSettingsGroups } from '../src/settings/settings-groups';
import type { SidebarWorkspace } from '../src/shell/sidebar-model';

const row = (wsId: string, sesId: string, title: string, state: 'idle' | 'working' | 'done' = 'idle') => ({
  sesId,
  wsId,
  title,
  userTitle: null,
  state,
  updatedAt: '2026-10-31T00:00:00.000Z',
  agentName: 'Claude Code',
});

const GROUPS: SidebarWorkspace[] = [
  { wsId: 'ws_a', name: 'Letterpress', rows: [row('ws_a', 'ses_1', 'Fix the login'), row('ws_a', 'ses_2', 'Write docs', 'working')], earlier: [], summary: [] },
  { wsId: 'ws_b', name: 'Billing', rows: [row('ws_b', 'ses_3', 'Invoice totals')], earlier: [row('ws_b', 'ses_4', 'Old invoice run', 'done')], summary: [] },
];

describe('the sources', () => {
  it('are a constant list in group order, with Files reserved between Projects and Tickets', () => {
    expect(PALETTE_SOURCES.map((source) => source.group)).toEqual(['chats', 'projects', 'tickets', 'actions']);
    expect(PALETTE_GROUP_ORDER).toEqual(['chats', 'projects', 'files', 'tickets', 'actions']);
    expect(PALETTE_EMPTY_ORDER).toEqual(['chats', 'actions', 'projects']);
  });
});

describe('chats', () => {
  it('typed: every chat in every project, Earlier too, with its project and state', () => {
    const open = vi.fn();
    const items = chatItems(GROUPS, 'inv', [], open);
    expect(items.map((item) => [item.label, item.context, item.glyph])).toEqual([
      ['Fix the login', 'Letterpress', { state: 'idle' }],
      ['Write docs', 'Letterpress', { state: 'working' }],
      ['Invoice totals', 'Billing', { state: 'idle' }],
      ['Old invoice run', 'Billing', { state: 'done' }],
    ]);
    items[2]!.run!();
    expect(open).toHaveBeenCalledWith('ws_b', 'ses_3');
  });

  it('typed: an unnamed chat ("New chat") is left out, so the New chat action is what "New chat" finds; on the empty query it can be recent', () => {
    const groups = [{ ...GROUPS[0]!, rows: [row('ws_a', 'ses_n', 'New chat'), { ...row('ws_a', 'ses_u', 'New chat'), userTitle: 'New chat' }] }];
    expect(chatItems(groups, 'new chat', [], vi.fn()).map((item) => item.id)).toEqual(['chat:ses_u']);
    expect(chatItems(groups, '', [{ wsId: 'ws_a', sesId: 'ses_n' }], vi.fn()).map((item) => item.id)).toEqual(['chat:ses_n']);
  });

  it('empty query: the recent ones that still exist, in recent order, at most 5', () => {
    const recent = ['ses_4', 'ses_gone', 'ses_1', 'ses_3', 'ses_2'].map((sesId) => ({ wsId: 'ws_x', sesId }));
    expect(chatItems(GROUPS, '', recent, vi.fn()).map((item) => item.label)).toEqual(['Old invoice run', 'Fix the login', 'Invoice totals', 'Write docs']);
    const many = Array.from({ length: 7 }, (_, i) => row('ws_a', `ses_m${i}`, `Chat ${i}`));
    const groups = [{ ...GROUPS[0]!, rows: many }];
    const opened = [6, 5, 4, 3, 2, 1, 0].map((i) => ({ wsId: 'ws_a', sesId: `ses_m${i}` }));
    expect(chatItems(groups, ' ', opened, vi.fn()).map((item) => item.label)).toEqual(['Chat 6', 'Chat 5', 'Chat 4', 'Chat 3', 'Chat 2']);
  });
});

describe('projects', () => {
  it('every project, opening it', () => {
    const open = vi.fn();
    const items = projectItems(GROUPS, open);
    expect(items.map((item) => [item.group, item.label])).toEqual([
      ['projects', 'Letterpress'],
      ['projects', 'Billing'],
    ]);
    items[1]!.run!();
    expect(open).toHaveBeenCalledWith('ws_b');
  });
});

describe('tickets', () => {
  const tickets = [{ ref: '1.1', title: 'Build the first thing' }, { ref: '1.2', title: 'Build the second thing' }] as TicketRow[];

  it('typed, in a project: "<ref> <title>", opening the ticket', () => {
    const open = vi.fn();
    const items = ticketItems('ws_a', tickets, '1.2', open);
    expect(items.map((item) => item.label)).toEqual(['1.1 Build the first thing', '1.2 Build the second thing']);
    items[1]!.run!();
    expect(open).toHaveBeenCalledWith('ws_a', '1.2');
  });

  it('none outside a project, without tickets (Board off, or they failed), or on the empty query', () => {
    expect(ticketItems(undefined, tickets, '1.2', vi.fn())).toEqual([]);
    expect(ticketItems('ws_a', undefined, '1.2', vi.fn())).toEqual([]);
    expect(ticketItems('ws_a', tickets, '', vi.fn())).toEqual([]);
  });
});

describe('actions', () => {
  const inputs = (change: Partial<ActionInputs> = {}): ActionInputs => ({
    wsId: undefined,
    sesId: undefined,
    detail: 'normal',
    hasNeedsYou: false,
    settingsGroups: visibleSettingsGroups('/', false),
    theme: 'system',
    newChat: vi.fn(),
    goToNeedsYou: vi.fn(),
    setDetail: vi.fn(),
    openPage: vi.fn(),
    setTheme: vi.fn(),
    ...change,
  });
  const labels = (change?: Partial<ActionInputs>) => actionItems(inputs(change)).map((item) => item.label);

  it('outside a project: New chat in..., the Settings groups (Terminals only in Developer mode), the other themes', () => {
    expect(labels()).toEqual([
      'New chat in...',
      'Settings: Agents',
      'Settings: Projects',
      'Settings: Appearance',
      'Settings: Notifications',
      'Settings: Remote machines',
      'Settings: Advanced',
      'Theme: Light',
      'Theme: Dark',
    ]);
    expect(labels({ settingsGroups: visibleSettingsGroups('/', true) })).toContain('Settings: Terminals');
    expect(actionItems(inputs()).find((item) => item.label === 'New chat in...')?.mode).toBe('new-chat-in');
  });

  it('in a project on a chat with Needs you: New chat, Go to Needs you, Show every step', () => {
    const given = inputs({ wsId: 'ws_a', sesId: 'ses_1', hasNeedsYou: true });
    const items = actionItems(given);
    expect(items.slice(0, 4).map((item) => [item.label, item.keys])).toEqual([
      ['New chat', ['g', 'n']],
      ['New chat in...', undefined],
      ['Go to Needs you', ['g', 'y']],
      ['Show every step', undefined],
    ]);
    items[0]!.run!();
    expect(given.newChat).toHaveBeenCalledWith('ws_a');
    items[2]!.run!();
    expect(given.goToNeedsYou).toHaveBeenCalled();
    const detail = items[3]!;
    expect(detail.returnFocus).toBe(true);
    detail.run!();
    expect(given.setDetail).toHaveBeenCalledWith('ses_1', 'verbose');
  });

  it('Verbose reads "Show less detail" and goes back to Normal; not on a chat, no detail action', () => {
    const given = inputs({ wsId: 'ws_a', sesId: 'ses_1', detail: 'verbose' });
    const detail = actionItems(given).find((item) => item.id === 'action:detail')!;
    expect(detail.label).toBe('Show less detail');
    detail.run!();
    expect(given.setDetail).toHaveBeenCalledWith('ses_1', 'normal');
    expect(actionItems(inputs({ wsId: 'ws_a' })).some((item) => item.id === 'action:detail')).toBe(false);
  });

  it('a Settings group opens its first page; the theme in use is left out and the others set it', () => {
    const given = inputs({ theme: 'dark' });
    const items = actionItems(given);
    items.find((item) => item.label === 'Settings: Projects')!.run!();
    expect(given.openPage).toHaveBeenCalledWith(SETTINGS_GROUPS.find((group) => group.id === 'projects')!.pages[0]!.to);
    expect(items.filter((item) => item.label.startsWith('Theme: ')).map((item) => item.label)).toEqual(['Theme: Light', 'Theme: System']);
    items.find((item) => item.label === 'Theme: Light')!.run!();
    expect(given.setTheme).toHaveBeenCalledWith('light');
  });

  it('no UI string has an em or en dash', () => {
    for (const item of actionItems(inputs({ wsId: 'ws_a', sesId: 'ses_1', hasNeedsYou: true }))) expect(item.label).not.toMatch(/[–—]/);
  });
});
