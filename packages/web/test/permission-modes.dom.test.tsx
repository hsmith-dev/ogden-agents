// @vitest-environment happy-dom
/**
 * Permission modes in a DOM: the session header's picker (Skip all listed only
 * in Developer mode, behind its red warning; a mode the agent doesn't offer
 * disabled with its reason; nothing chosen while the terminal drives), the
 * red Skip-all banner, a Skip-all card's caption and refusal, and Developer
 * mode following the server (with the one-time carry-over of a browser's old
 * "on"). The REST calls are replaced.
 */
import { PERMISSION_MODES, SKIP_ALL_REFUSAL, type CoreEvent, type PermissionMode, type SessionPermissionModeOption } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCE_KEY } from '../src/appearance/appearance';
import { AppearanceProvider, useAppearance } from '../src/appearance/appearance-provider';
import { DEVELOPER_MODE_CARRIED_KEY, DeveloperModeSync, useDeveloperModeSave } from '../src/appearance/developer-mode';
import type { TranscriptPermission } from '../src/chat/transcript';
import { PermissionCard } from '../src/permissions/permission-card';
import {
  permissionModeDescriptions,
  PermissionModePicker,
  skipAllBanner,
  skipAllWarning,
  SkipAllBanner,
  TERMINAL_MODE_REASON,
  usePermissionMode,
} from '../src/permissions/permission-mode-picker';
import { TooltipProvider } from '../src/ui/tooltip';

const server = vi.hoisted(() => ({ developerMode: false, everSet: false, puts: [] as boolean[], holdReads: false, heldReads: [] as (() => void)[], holdPuts: false, heldPuts: [] as (() => void)[] }));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  call: async (_auth: unknown, _path: string, init: RequestInit) => {
    if (init.method === 'PUT') {
      const { developerMode } = JSON.parse(String(init.body)) as { developerMode: boolean };
      server.puts.push(developerMode);
      const apply = () => {
        server.developerMode = developerMode;
        server.everSet = true;
        return { developerMode: server.developerMode, everSet: server.everSet };
      };
      // A held save reaches the server, and answers, only when released.
      if (server.holdPuts) return new Promise((resolve) => server.heldPuts.push(() => resolve(apply())));
      apply();
    }
    const answer = { developerMode: server.developerMode, everSet: server.everSet };
    // A held read answers later with the value it read when it was sent (a request held up behind others).
    if (init.method !== 'PUT' && server.holdReads) return new Promise((resolve) => server.heldReads.push(() => resolve(answer)));
    return answer;
  },
}));
vi.mock('@/events/use-event-invalidation', () => ({ useEventInvalidation: () => undefined }));

afterEach(cleanup);
beforeEach(() => {
  server.developerMode = false;
  server.everSet = false;
  server.puts = [];
  server.holdReads = false;
  server.heldReads = [];
  server.holdPuts = false;
  server.heldPuts = [];
  localStorage.clear();
});

const allAvailable: SessionPermissionModeOption[] = PERMISSION_MODES.map((mode) => ({ mode, available: true }));

function mountPicker(props: Partial<Parameters<typeof PermissionModePicker>[0]> = {}) {
  const onChoose = vi.fn();
  render(
    <TooltipProvider>
      <PermissionModePicker agentName="Claude Code" mode="ask" options={allAvailable} developerMode={false} terminalDrives={false} changing={false} onChoose={onChoose} {...props} />
    </TooltipProvider>,
  );
  const open = async () => {
    const trigger = screen.getByTestId('permission-mode-picker');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    return screen.findByTestId('permission-mode-menu');
  };
  return { onChoose, open };
}

describe('the permission mode picker', () => {
  it('shows the current mode, and offers Ask and Auto with what they do; Skip all only in Developer mode', async () => {
    const { open } = mountPicker();
    expect(screen.getByTestId('permission-mode-picker').textContent).toContain('Ask');
    await open();
    expect(screen.getByTestId('permission-mode-ask').textContent).toContain(permissionModeDescriptions('Claude Code').ask);
    expect(screen.getByTestId('permission-mode-auto').textContent).toContain(permissionModeDescriptions('Claude Code').auto);
    expect(screen.queryByTestId('permission-mode-skip_all')).toBeNull();
    cleanup();
    await mountPicker({ developerMode: true }).open();
    expect(screen.getByTestId('permission-mode-skip_all')).not.toBeNull();
  });

  it('asks for Auto at once; the view stays on Ask until the server says otherwise', async () => {
    const { onChoose, open } = mountPicker();
    await open();
    fireEvent.click(screen.getByTestId('permission-mode-auto'));
    expect(onChoose).toHaveBeenCalledWith('auto', false);
    expect(screen.getByTestId('permission-mode-picker').getAttribute('data-mode')).toBe('ask');
  });

  it('Skip all opens its red warning first: Cancel changes nothing, the confirm button asks with the confirmation', async () => {
    const { onChoose, open } = mountPicker({ developerMode: true });
    await open();
    fireEvent.click(screen.getByTestId('permission-mode-skip_all'));
    const dialog = await screen.findByTestId('skip-all-confirm');
    expect(dialog.textContent).toContain(skipAllWarning('Claude Code'));
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('skip-all-cancel'));
    await waitFor(() => expect(screen.queryByTestId('skip-all-confirm')).toBeNull());
    expect(onChoose).not.toHaveBeenCalled();

    await open();
    fireEvent.click(screen.getByTestId('permission-mode-skip_all'));
    fireEvent.click(await screen.findByTestId('skip-all-confirm-button'));
    expect(onChoose).toHaveBeenCalledWith('skip_all', true);
  });

  it('a mode the agent does not offer is disabled with its one-sentence reason, and cannot be chosen', async () => {
    const options: SessionPermissionModeOption[] = [
      { mode: 'ask', available: true },
      { mode: 'auto', available: false, reason: "Claude Code doesn't offer Auto." },
      { mode: 'skip_all', available: false, reason: "This chat's Claude Code session doesn't offer Skip all on this computer." },
    ];
    const { onChoose, open } = mountPicker({ options, developerMode: true });
    await open();
    const auto = screen.getByTestId('permission-mode-auto');
    expect(auto.hasAttribute('data-disabled')).toBe(true);
    expect(auto.textContent).toContain("Claude Code doesn't offer Auto.");
    expect(screen.getByTestId('permission-mode-skip_all').textContent).toContain('on this computer');
    fireEvent.click(auto);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('while the terminal drives, nothing can be chosen, and each mode says to switch back first', async () => {
    const { onChoose, open } = mountPicker({ terminalDrives: true, mode: 'auto' });
    await open();
    expect(screen.getByTestId('permission-mode-ask').textContent).toContain(TERMINAL_MODE_REASON);
    fireEvent.click(screen.getByTestId('permission-mode-ask'));
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('follows the latest session.permission_mode_changed, else the session as read, else Ask', () => {
    const changed = (mode: PermissionMode, seq: number) =>
      ({ type: 'session.permission_mode_changed', seq, payload: { mode } }) as unknown as CoreEvent;
    expect(renderHook(() => usePermissionMode([], undefined)).result.current).toBe('ask');
    expect(renderHook(() => usePermissionMode([], 'auto')).result.current).toBe('auto');
    expect(renderHook(() => usePermissionMode([changed('skip_all', 1), changed('ask', 2)], 'auto')).result.current).toBe('ask');
  });
});

describe('the Skip-all banner', () => {
  it('names the mode in the destructive variant, with a way back to Ask', () => {
    const onBackToAsk = vi.fn();
    render(<SkipAllBanner agentName="Claude Code" changing={false} onBackToAsk={onBackToAsk} />);
    const banner = screen.getByTestId('skip-all-banner');
    expect(banner.textContent).toContain(skipAllBanner('Claude Code'));
    expect(banner.getAttribute('data-variant')).toBe('destructive');
    fireEvent.click(screen.getByTestId('skip-all-back-to-ask'));
    expect(onBackToAsk).toHaveBeenCalledTimes(1);
  });

  it('ignores Back to Ask while a change is on its way', () => {
    const onBackToAsk = vi.fn();
    render(<SkipAllBanner agentName="Claude Code" changing onBackToAsk={onBackToAsk} />);
    fireEvent.click(screen.getByTestId('skip-all-back-to-ask'));
    expect(onBackToAsk).not.toHaveBeenCalled();
  });
});

describe('a Skip-all permission card', () => {
  it('offers Allow once and Deny only, says why, and its caption names Skip all', () => {
    const permission: TranscriptPermission = {
      requestId: 'preq_1',
      toolCall: { toolCallId: 't1', title: 'Run rm -rf .git', kind: 'execute', command: 'rm -rf .git' },
      scope: null,
      cautionLevel: 'ask_every_time',
      permissionMode: 'skip_all',
      requestedAt: '2026-10-02T12:00:00.000Z',
      status: 'pending',
      resolution: undefined,
    } as TranscriptPermission;
    render(<PermissionCard permission={permission} wsId="ws_1" sesId="ses_1" projectName="clay" agentName="Claude Code" />);
    expect(screen.queryByRole('button', { name: 'Always allow' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Allow once' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Deny' })).not.toBeNull();
    expect(screen.getByTestId('permission-scope').textContent).toBe(SKIP_ALL_REFUSAL);
    expect(screen.getByTestId('permission-caption').textContent).toContain('Skip all');
  });
});

describe('Developer mode follows the server', () => {
  const mountSync = (client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) => {
    return renderHook(
      () => {
        const appearance = useAppearance();
        return appearance.appearance;
      },
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>
            <AppearanceProvider>
              <DeveloperModeSync storage={localStorage} />
              {children}
            </AppearanceProvider>
          </QueryClientProvider>
        ),
      },
    );
  };

  it("carries a browser's old Developer mode on over to the server once", async () => {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ developerMode: true, density: 'compact' }));
    const { result } = mountSync();
    await waitFor(() => expect(server.puts).toEqual([true]));
    await waitFor(() => expect(localStorage.getItem(DEVELOPER_MODE_CARRIED_KEY)).toBe('1'));
    expect(result.current.developerMode).toBe(true);
  });

  it('a carried-over on stays on when a read sent before the carry-over answered lands after it with the old off (story 6.9)', async () => {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ developerMode: true, density: 'compact' }));
    server.holdPuts = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = mountSync(client);
    await waitFor(() => expect(server.heldPuts).toHaveLength(1));
    // A refetch (an event, say) goes out while the carry-over is on its way, and reads the old off.
    server.holdReads = true;
    void client.invalidateQueries({ queryKey: ['developer-mode'] });
    await waitFor(() => expect(server.heldReads).toHaveLength(1));
    await act(async () => server.heldPuts.shift()?.());
    await waitFor(() => expect(localStorage.getItem(DEVELOPER_MODE_CARRIED_KEY)).toBe('1'));
    await act(async () => server.heldReads.shift()?.());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await act(async () => {});
    expect(client.getQueryData(['developer-mode'])).toEqual({ developerMode: true, everSet: true });
    expect(result.current.developerMode).toBe(true);
  });

  it('never carries an old "on" over to an install where Developer mode was already set (turned off elsewhere)', async () => {
    server.everSet = true;
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ developerMode: true, density: 'compact' }));
    const { result } = mountSync();
    await waitFor(() => expect(result.current.developerMode).toBe(false));
    expect(server.puts).toEqual([]);
    expect(localStorage.getItem(DEVELOPER_MODE_CARRIED_KEY)).toBe('1');
  });

  it('once carried, the server alone decides: its off turns this browser off, keeping its density', async () => {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ developerMode: true, density: 'compact' }));
    localStorage.setItem(DEVELOPER_MODE_CARRIED_KEY, '1');
    const { result } = mountSync();
    await waitFor(() => expect(result.current.developerMode).toBe(false));
    expect(result.current.density).toBe('compact');
    expect(server.puts).toEqual([]);
  });

  it('a switch saved while the first read is still on its way stays on when that read answers with the old off', async () => {
    // Seen on a Windows runner (story 6.7, CI run 37226493048): the page's first read was held up behind other
    // requests, the switch was saved on, and the read's old "off" then landed and turned the switch back.
    localStorage.setItem(DEVELOPER_MODE_CARRIED_KEY, '1');
    server.holdReads = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => ({ appearance: useAppearance().appearance, ...useDeveloperModeSave() }), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <AppearanceProvider>
            <DeveloperModeSync storage={localStorage} />
            {children}
          </AppearanceProvider>
        </QueryClientProvider>
      ),
    });
    await waitFor(() => expect(server.heldReads).toHaveLength(1));
    act(() => result.current.save(true));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(server.puts).toEqual([true]);
    expect(result.current.appearance.developerMode).toBe(true);
    await act(async () => server.heldReads.shift()?.());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await act(async () => {});
    expect(client.getQueryData(['developer-mode'])).toEqual({ developerMode: true, everSet: true });
    expect(result.current.appearance.developerMode).toBe(true);
  });

  it("a browser that had it off takes the server's on, and never carries an off over", async () => {
    server.developerMode = true;
    const { result } = mountSync();
    await waitFor(() => expect(result.current.developerMode).toBe(true));
    expect(server.puts).toEqual([]);
    expect(localStorage.getItem(DEVELOPER_MODE_CARRIED_KEY)).toBe('1');
    await act(async () => {});
  });
});
