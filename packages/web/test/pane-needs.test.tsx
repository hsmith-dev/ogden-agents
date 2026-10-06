/** Terminal panes in Needs you (epic 16, story 16.6): a pane that seems to be waiting is a row and counts in the tab title; it never makes a sound or a desktop notification by itself. */
import type { CoreEvent } from '@ogden-agents/shared';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyEvents, emptyStore } from '../src/events/event-store';
import { notificationText } from '../src/notifications/notifier';
import { NeedsYouGroup } from '../src/shell/needs-you-group';
import { paneNeeds } from '../src/shell/sidebar-model';
import { SidebarProvider } from '../src/ui/sidebar';
import { TooltipProvider } from '../src/ui/tooltip';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const PANE = 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const PANE2 = 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W4';

let seq = 0;
const event = (type: string, payload: Record<string, unknown>) =>
  ({ id: `evt_01J9Z3K4M5N6P7Q8R9S0T1V2W${++seq % 10}`, seq: ++seq, at: `2026-10-05T12:00:${String(seq).padStart(2, '0')}.000Z`, type, workspaceId: WS, streamId: WS, payload }) as unknown as CoreEvent;
const storeOf = (...events: CoreEvent[]) => applyEvents(emptyStore(), events);

describe('Needs you from pane events', () => {
  it('lists a pane from the status that said needs attention until its next status', () => {
    const waiting = storeOf(
      event('terminal.pane_opened', { paneId: PANE, launcherId: 'shell', title: 'Terminal 1' }),
      event('terminal.pane_status_changed', { paneId: PANE, status: 'needs_attention', previous: 'working', title: 'Terminal 1' }),
    );
    const needs = paneNeeds(waiting, WS, 'My project');
    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({ kind: 'pane', wsId: WS, paneId: PANE, workspaceName: 'My project', chatName: 'Terminal 1', text: 'Terminal 1 may need you', sesId: '' });
    const answered = applyEvents(waiting, [event('terminal.pane_status_changed', { paneId: PANE, status: 'working', previous: 'needs_attention', title: 'Terminal 1' })]);
    expect(paneNeeds(answered, WS, 'My project')).toEqual([]);
  });

  it('a pane that exits or closes, or one that was renamed, is followed; a new wait is a new entry', () => {
    let store = storeOf(
      event('terminal.pane_opened', { paneId: PANE, launcherId: 'a', title: 'One' }),
      event('terminal.pane_opened', { paneId: PANE2, launcherId: 'b', title: 'Two' }),
      event('terminal.pane_renamed', { paneId: PANE2, title: 'Server' }),
      event('terminal.pane_status_changed', { paneId: PANE, status: 'needs_attention', previous: 'working' }),
      event('terminal.pane_status_changed', { paneId: PANE2, status: 'needs_attention', previous: 'working' }),
    );
    const first = paneNeeds(store, WS, 'P');
    expect(first.map((n) => n.chatName).sort()).toEqual(['One', 'Server']);
    store = applyEvents(store, [event('terminal.pane_exited', { paneId: PANE, exitCode: 0 }), event('terminal.pane_closed', { paneId: PANE2, cause: 'user' })]);
    expect(paneNeeds(store, WS, 'P')).toEqual([]);
    store = applyEvents(store, [event('terminal.pane_opened', { paneId: PANE, launcherId: 'a', title: 'One' }), event('terminal.pane_status_changed', { paneId: PANE, status: 'needs_attention', previous: 'working' })]);
    expect(paneNeeds(store, WS, 'P')[0]!.id).not.toBe(first.find((n) => n.paneId === PANE)!.id);
  });

  it('ignores what an earlier run of the server left in the log: panes live in memory', () => {
    const before = [
      event('terminal.pane_opened', { paneId: PANE, launcherId: 'a', title: 'One' }),
      event('terminal.pane_status_changed', { paneId: PANE, status: 'needs_attention', previous: 'working' }),
    ];
    const started = { id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W9', seq: ++seq, at: '2026-10-05T12:30:00.000Z', type: 'server.started', workspaceId: null, streamId: 'server', payload: { version: '1' } } as unknown as CoreEvent;
    expect(paneNeeds(applyEvents(emptyStore(), [...before, started]), WS, 'P')).toEqual([]);
    expect(paneNeeds(applyEvents(emptyStore(), before), WS, 'P')).toHaveLength(1);
  });

  it('carries no terminal text: only the pane\'s name and ids', () => {
    const needs = paneNeeds(storeOf(event('terminal.pane_opened', { paneId: PANE, launcherId: 'a', title: 'One' }), event('terminal.pane_status_changed', { paneId: PANE, status: 'needs_attention', previous: 'idle' })), WS, 'P');
    expect(Object.values(needs[0]!).filter((v) => typeof v === 'string').join(' ')).not.toMatch(/y\/n|proceed/i);
  });

  it('its words, if ever notified, name the project and the pane only', () => {
    const [need] = paneNeeds(storeOf(event('terminal.pane_opened', { paneId: PANE, launcherId: 'a', title: 'One' }), event('terminal.pane_status_changed', { paneId: PANE, status: 'needs_attention', previous: 'idle' })), WS, 'My project');
    expect(notificationText(need!)).toEqual({ title: 'A terminal may need you', body: 'My project: One' });
  });
});

describe('the Needs you row of a pane', () => {
  it('opens the project\'s Terminals, not a chat', async () => {
    const root = createRootRoute({ component: () => <TooltipProvider><SidebarProvider><NeedsYouGroup items={[{ id: 'p', wsId: WS, sesId: '', paneId: PANE, workspaceName: 'My project', chatName: 'Terminal 1', text: 'Terminal 1 may need you' }]} /></SidebarProvider></TooltipProvider> });
    const terminals = createRoute({ getParentRoute: () => root, path: '/w/$wsId/terminals' });
    const session = createRoute({ getParentRoute: () => root, path: '/w/$wsId/s/$sesId' });
    const router = createRouter({ routeTree: root.addChildren([terminals, session]), history: createMemoryHistory({ initialEntries: ['/'] }) });
    await router.load();
    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(html).toContain(`href="/w/${WS}/terminals"`);
    expect(html).toContain('Terminal 1 may need you');
  });
});
