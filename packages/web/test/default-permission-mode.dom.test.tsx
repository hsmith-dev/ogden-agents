// @vitest-environment happy-dom
/**
 * Default permission mode in the UI: Workspace settings' and Settings → New
 * projects' "New chats start in" (Skip all listed only in Developer mode,
 * behind its red warning, sent with the confirmation; a read on its way never
 * turns a saved choice back, story 6.9's keepSaved), the notices when a
 * default went back to Ask or waits for confirmation, and a new chat's note
 * about the mode it started in. The REST calls are a small fake server.
 */
import { API_ROUTES, apiPath, DEFAULT_MODE_NOTICE_TEXT, type CoreEvent, type NewProjectDefaults, type WorkspaceSettings } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider, useAppearance } from '../src/appearance/appearance-provider';
import { StartModeNote, useStartModeNote } from '../src/permissions/default-permission-mode';
import { DefaultPermissionModeSection } from '../src/routes/workspace-settings-page';
import { NEW_PROJECT_DEFAULTS_QUERY_KEY, NewProjectsPermissionModeSection } from '../src/settings/new-project-defaults';
import { TooltipProvider } from '../src/ui/tooltip';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SETTINGS_PATH = apiPath(API_ROUTES.workspaceSettings, { wsId: WS });
const SETTINGS_KEY = ['workspace-settings', WS] as const;

const server = vi.hoisted(() => ({
  settings: undefined as unknown as WorkspaceSettings,
  defaults: undefined as unknown as NewProjectDefaults,
  bodies: [] as Record<string, unknown>[],
  holdReads: false,
  held: [] as (() => void)[],
}));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  call: async (_auth: unknown, path: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    if (method !== 'GET') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      server.bodies.push(body);
      const { confirm: _confirm, ...fields } = body;
      if (path === API_ROUTES.newProjectDefaults) server.defaults = { ...server.defaults, ...fields } as NewProjectDefaults;
      else {
        const { defaultPermissionModeNotice: _notice, ...kept } = server.settings;
        server.settings = { ...kept, ...fields } as WorkspaceSettings;
      }
    }
    const now = path === SETTINGS_PATH ? { settings: server.settings } : path === API_ROUTES.newProjectDefaults ? { defaults: server.defaults } : undefined;
    if (now === undefined) throw new Error(`unexpected ${method} ${path}`);
    if (method === 'GET' && server.holdReads) return new Promise((resolve) => server.held.push(() => resolve(now)));
    return now;
  },
}));
vi.mock('@/events/use-event-invalidation', () => ({ useEventInvalidation: () => undefined }));

let client: QueryClient;
beforeEach(() => {
  server.settings = { cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false };
  server.defaults = { bmadPieces: [] };
  server.bodies = [];
  server.holdReads = false;
  server.held = [];
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(cleanup);

function DeveloperMode({ on }: { on: boolean }) {
  const { update } = useAppearance();
  useEffect(() => update({ developerMode: on }), [on, update]);
  return null;
}

function show(node: ReactNode, developerMode = false) {
  return render(
    <QueryClientProvider client={client}>
      <AppearanceProvider>
        <DeveloperMode on={developerMode} />
        <TooltipProvider>{node}</TooltipProvider>
      </AppearanceProvider>
    </QueryClientProvider>,
  );
}

const checked = (testId: string) => screen.getByTestId(testId).getAttribute('aria-checked');

describe('Workspace settings → New chats start in', () => {
  it('offers Ask and Auto, and Skip all only in Developer mode', async () => {
    show(<DefaultPermissionModeSection wsId={WS} />);
    await screen.findByTestId('default-mode');
    expect(checked('default-mode-ask')).toBe('true');
    expect(screen.queryByTestId('default-mode-skip_all')).toBeNull();
    fireEvent.click(screen.getByTestId('default-mode-auto'));
    await waitFor(() => expect(screen.getByTestId('default-mode-status').textContent).toBe('Saved: new chats start in Auto.'));
    expect(server.bodies).toEqual([{ defaultPermissionMode: 'auto' }]);
  });

  it('sends Skip all only after its red warning is confirmed', async () => {
    show(<DefaultPermissionModeSection wsId={WS} />, true);
    fireEvent.click(await screen.findByTestId('default-mode-skip_all'));
    expect(await screen.findByTestId('default-mode-skip-all-confirm')).toBeTruthy();
    fireEvent.click(screen.getByTestId('default-mode-skip-all-cancel'));
    await waitFor(() => expect(screen.queryByTestId('default-mode-skip-all-confirm')).toBeNull());
    expect(server.bodies).toEqual([]);
    expect(checked('default-mode-ask')).toBe('true');

    fireEvent.click(screen.getByTestId('default-mode-skip_all'));
    fireEvent.click(await screen.findByTestId('default-mode-skip-all-confirm-button'));
    await waitFor(() => expect(screen.getByTestId('default-mode-status').textContent).toBe('Saved: new chats start in Skip all.'));
    expect(server.bodies).toEqual([{ defaultPermissionMode: 'skip_all', confirm: true }]);
  });

  it('keeps the saved choice when a read from before the save lands after it', async () => {
    show(<DefaultPermissionModeSection wsId={WS} />);
    await screen.findByTestId('default-mode');
    server.holdReads = true;
    void client.invalidateQueries({ queryKey: SETTINGS_KEY, exact: true });
    await waitFor(() => expect(server.held).toHaveLength(1));
    fireEvent.click(screen.getByTestId('default-mode-auto'));
    await waitFor(() => expect(screen.getByTestId('default-mode-status').textContent).toMatch(/^Saved/));
    await act(async () => {
      for (const release of server.held.splice(0)) release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(client.getQueryData<WorkspaceSettings>(SETTINGS_KEY)?.defaultPermissionMode).toBe('auto');
    expect(checked('default-mode-auto')).toBe('true');
  });

  it('says why a Skip all default went back to Ask', async () => {
    server.settings = { ...server.settings, defaultPermissionMode: 'ask', defaultPermissionModeNotice: 'developer_mode_off' };
    show(<DefaultPermissionModeSection wsId={WS} />);
    expect((await screen.findByTestId('default-mode-notice')).textContent).toContain(DEFAULT_MODE_NOTICE_TEXT.developer_mode_off);
  });

  it('asks for the confirmation a Skip all from the app-wide default waits for', async () => {
    server.settings = { ...server.settings, defaultPermissionMode: 'ask', defaultPermissionModeNotice: 'skip_all_unconfirmed' };
    show(<DefaultPermissionModeSection wsId={WS} />, true);
    fireEvent.click(await screen.findByTestId('default-mode-confirm-skip-all'));
    fireEvent.click(await screen.findByTestId('default-mode-skip-all-confirm-button'));
    await waitFor(() => expect(checked('default-mode-skip_all')).toBe('true'));
    expect(server.bodies).toEqual([{ defaultPermissionMode: 'skip_all', confirm: true }]);
    expect(screen.queryByTestId('default-mode-notice')).toBeNull();
  });

  it('without Developer mode, says how to confirm instead of offering it', async () => {
    server.settings = { ...server.settings, defaultPermissionMode: 'ask', defaultPermissionModeNotice: 'skip_all_unconfirmed' };
    show(<DefaultPermissionModeSection wsId={WS} />);
    expect((await screen.findByTestId('default-mode-notice')).textContent).toContain('Turn on Developer mode');
    expect(screen.queryByTestId('default-mode-confirm-skip-all')).toBeNull();
  });
});

describe('Settings → New projects → New chats start in', () => {
  it('saves the app-wide default; Skip all after its warning, with the confirmation', async () => {
    show(<NewProjectsPermissionModeSection />, true);
    fireEvent.click(await screen.findByTestId('new-projects-mode-default-skip_all'));
    fireEvent.click(await screen.findByTestId('new-projects-mode-default-skip-all-confirm-button'));
    await waitFor(() => expect(screen.getByTestId('new-projects-mode-default-status').textContent).toBe("Saved: new projects' chats start in Skip all."));
    expect(server.bodies).toEqual([{ defaultPermissionMode: 'skip_all', confirm: true }]);
    expect(client.getQueryData<NewProjectDefaults>(NEW_PROJECT_DEFAULTS_QUERY_KEY)?.defaultPermissionMode).toBe('skip_all');
  });
});

describe("a new chat's note about the mode it started in", () => {
  const created = (permissionModeNote?: string): CoreEvent =>
    ({
      seq: 1,
      type: 'session.created',
      workspaceId: WS,
      streamId: 'ses_1',
      at: '2026-10-04T00:00:00.000Z',
      payload: { session: {}, ...(permissionModeNote === undefined ? {} : { permissionModeNote }) },
    }) as unknown as CoreEvent;
  const changed = { seq: 2, type: 'session.permission_mode_changed', workspaceId: WS, streamId: 'ses_1', at: '2026-10-04T00:00:01.000Z', payload: {} } as unknown as CoreEvent;

  it('shows the note until the chat changes mode or the user dismisses it', () => {
    const note = "Antigravity doesn't offer Auto, so this chat started in Ask instead of this project's default.";
    expect(renderHook(() => useStartModeNote([created(note)])).result.current).toBe(note);
    expect(renderHook(() => useStartModeNote([created(note), changed])).result.current).toBeUndefined();
    expect(renderHook(() => useStartModeNote([created()])).result.current).toBeUndefined();
    render(<StartModeNote note={note} />);
    expect(screen.getByTestId('start-mode-note').textContent).toContain(note);
    fireEvent.click(screen.getByTestId('start-mode-note-dismiss'));
    expect(screen.queryByTestId('start-mode-note')).toBeNull();
  });
});
