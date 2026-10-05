// @vitest-environment happy-dom
/**
 * The driver toggle and its shortcut (story 3.6), in a DOM: the Terminal
 * segment is `aria-disabled` (still focusable) with its reason in an openable
 * tooltip when the session is not idle or the terminal can't work here
 * (`terminal.reason`, verbatim); choosing a segment only asks, and the toggle
 * says "Switching..." without flipping; `⌘.` / `Ctrl+.` is caught in the
 * capture phase, before the terminal's own key handler, and only when on.
 * Story 3.7 appends its availability cases to this file.
 */
import type { SessionDriver } from '@ogden-agents/shared';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriverToggle, driverShortcutLabel, notIdleReason, SWITCHING_WORDS } from '../src/terminal/driver-toggle';

const NOT_IDLE_REASON = notIdleReason('Claude Code');
import { conversationProps, READ_ONLY_CONVERSATION } from '../src/terminal/terminal-pane';
import { SWITCH_UNCONFIRMED, useDriverSwitch } from '../src/terminal/use-driver-switch';
import { useDriverShortcut } from '../src/terminal/use-driver-shortcut';
import { PageBody } from '../src/ui/page';
import { TooltipProvider } from '../src/ui/tooltip';

afterEach(cleanup);

function mount(props: { driver?: SessionDriver; switching?: SessionDriver; reason?: string | null }) {
  const onSwitch = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <DriverToggle agentName="Claude Code" driver={props.driver ?? 'ui'} switching={props.switching} terminalBlockedReason={props.reason} onSwitch={onSwitch} />
    </TooltipProvider>,
  );
  return { onSwitch, terminal: screen.getByTestId('switch-to-terminal'), chat: screen.getByTestId('switch-to-chat') };
}

/** Opens the Terminal segment's tooltip the keyboard way and returns its words. */
async function tooltipText(item: HTMLElement): Promise<string> {
  act(() => item.focus());
  fireEvent.focus(item);
  const tips = await screen.findAllByRole('tooltip');
  return tips[0]?.textContent ?? '';
}

describe('DriverToggle', () => {
  it('when idle and available, offers the terminal and asks for the switch without flipping', async () => {
    const { onSwitch, terminal, chat } = mount({});
    expect(chat.getAttribute('data-state')).toBe('on');
    expect(terminal.hasAttribute('aria-disabled')).toBe(false);
    expect(await tooltipText(terminal)).toContain(driverShortcutLabel());
    fireEvent.click(terminal);
    expect(onSwitch).toHaveBeenCalledWith('terminal');
    // The view flips only on `session.driver_changed`: the toggle still shows Chat.
    expect(chat.getAttribute('data-state')).toBe('on');
  });

  it('when not idle, disables the Terminal segment with aria-disabled (still focusable) and the busy reason', async () => {
    const { onSwitch, terminal } = mount({ reason: NOT_IDLE_REASON });
    expect(terminal.getAttribute('aria-disabled')).toBe('true');
    expect(terminal.hasAttribute('disabled')).toBe(false);
    expect(NOT_IDLE_REASON).toBe('Claude Code is busy. Switch when it is idle.');
    expect(await tooltipText(terminal)).toContain(NOT_IDLE_REASON);
    expect(document.getElementById(terminal.getAttribute('aria-describedby') ?? '')?.textContent).toBe(NOT_IDLE_REASON);
    fireEvent.click(terminal);
    fireEvent.keyDown(terminal, { key: 'Enter' });
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("when the terminal can't work here, shows terminal.reason verbatim", async () => {
    const reason = "The terminal couldn't start on this computer: node-pty failed to load.";
    const { onSwitch, terminal } = mount({ reason });
    expect(terminal.getAttribute('aria-disabled')).toBe('true');
    expect(await tooltipText(terminal)).toContain(reason);
    fireEvent.click(terminal);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('says Switching... while a switch is in flight and takes no second request', () => {
    const { onSwitch, terminal, chat } = mount({ switching: 'terminal' });
    expect(screen.getByTestId('driver-switching').textContent).toBe(SWITCHING_WORDS);
    expect(terminal.getAttribute('aria-disabled')).toBe('true');
    expect(chat.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(terminal);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('while the terminal drives, Chat asks to switch back even when the terminal would be blocked', () => {
    const { onSwitch, terminal, chat } = mount({ driver: 'terminal', reason: NOT_IDLE_REASON });
    expect(terminal.getAttribute('data-state')).toBe('on');
    expect(terminal.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(chat);
    expect(onSwitch).toHaveBeenCalledWith('ui');
  });

  it('while the session loads, the Terminal segment is disabled with nothing to say (review F5)', () => {
    const { onSwitch, terminal } = mount({ reason: null });
    expect(terminal.getAttribute('aria-disabled')).toBe('true');
    expect(terminal.hasAttribute('aria-describedby')).toBe(false);
    act(() => terminal.focus());
    fireEvent.focus(terminal);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(terminal);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('puts the help on the segment you would switch to: Chat while the terminal drives (review F3)', async () => {
    const { chat, terminal } = mount({ driver: 'terminal' });
    expect(terminal.hasAttribute('aria-describedby')).toBe(false);
    const described = document.getElementById(chat.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe(`Back to the chat (${driverShortcutLabel()})`);
    expect(chat.getAttribute('aria-keyshortcuts')).toBe('Meta+. Control+.');
    expect(await tooltipText(chat)).toContain('Back to the chat');
  });

  it('describes the Terminal segment with its hint while the chat drives (review F3)', () => {
    const { chat, terminal } = mount({});
    expect(chat.hasAttribute('aria-describedby')).toBe(false);
    expect(document.getElementById(terminal.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      `Open this chat in Claude Code's own terminal (${driverShortcutLabel()})`,
    );
  });

  it('writes the shortcut for the computer it runs on', () => {
    expect(driverShortcutLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('⌘.');
    expect(driverShortcutLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Ctrl+.');
  });
});

describe('useDriverShortcut', () => {
  function Shortcut({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
    useDriverShortcut(enabled, onToggle);
    return <textarea data-testid="xterm-helper" />;
  }

  function setup(enabled: boolean) {
    const onToggle = vi.fn();
    render(<Shortcut enabled={enabled} onToggle={onToggle} />);
    const terminal = screen.getByTestId('xterm-helper');
    // Stands in for xterm's own key handler on its textarea.
    const terminalKeys = vi.fn();
    terminal.addEventListener('keydown', terminalKeys);
    return { onToggle, terminal, terminalKeys };
  }

  it('catches Ctrl+. and ⌘. before the terminal sees them, and toggles once per press', () => {
    const { onToggle, terminal, terminalKeys } = setup(true);
    const ctrl = new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true, cancelable: true });
    terminal.dispatchEvent(ctrl);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(terminalKeys).not.toHaveBeenCalled();
    expect(ctrl.defaultPrevented).toBe(true);

    terminal.dispatchEvent(new KeyboardEvent('keydown', { key: '.', metaKey: true, bubbles: true, cancelable: true }));
    expect(onToggle).toHaveBeenCalledTimes(2);

    // A held key does not toggle again, and still never reaches the terminal.
    terminal.dispatchEvent(new KeyboardEvent('keydown', { key: '.', metaKey: true, repeat: true, bubbles: true, cancelable: true }));
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(terminalKeys).not.toHaveBeenCalled();
  });

  it('leaves other keys to the terminal', () => {
    const { onToggle, terminal, terminalKeys } = setup(true);
    terminal.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true }));
    terminal.dispatchEvent(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, shiftKey: true, bubbles: true }));
    terminal.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(terminalKeys).toHaveBeenCalledTimes(3);
  });

  it('leaves a press inside a dialog alone (review F4)', () => {
    const onToggle = vi.fn();
    render(
      <>
        <Shortcut enabled onToggle={onToggle} />
        <div role="dialog">
          <input data-testid="in-dialog" />
        </div>
      </>,
    );
    const field = screen.getByTestId('in-dialog');
    const dialogKeys = vi.fn();
    field.addEventListener('keydown', dialogKeys);
    const press = new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true, cancelable: true });
    field.dispatchEvent(press);
    expect(onToggle).not.toHaveBeenCalled();
    expect(dialogKeys).toHaveBeenCalledOnce();
    expect(press.defaultPrevented).toBe(false);
  });

  it('does nothing when off (Developer mode off)', () => {
    const { onToggle, terminal, terminalKeys } = setup(false);
    terminal.dispatchEvent(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(terminalKeys).toHaveBeenCalledOnce();
  });
});

describe('useDriverSwitch (review F1)', () => {
  afterEach(() => vi.useRealTimers());

  function setup(confirmed: SessionDriver | undefined | Error, send: () => Promise<unknown> = () => Promise.resolve()) {
    vi.useFakeTimers();
    const onError = vi.fn();
    const confirm = vi.fn(() => (confirmed instanceof Error ? Promise.reject(confirmed) : Promise.resolve(confirmed)));
    const hook = renderHook(({ driver }: { driver: SessionDriver }) => useDriverSwitch({ driver, send, confirm, onError, timeoutMs: 8_000 }), {
      initialProps: { driver: 'ui' as SessionDriver },
    });
    return { hook, onError, confirm };
  }

  it('ends the wait when session.driver_changed arrives, and never checks', async () => {
    const { hook, onError, confirm } = setup('terminal');
    await act(async () => hook.result.current.start('terminal'));
    expect(hook.result.current.switchingTo).toBe('terminal');
    hook.rerender({ driver: 'terminal' });
    expect(hook.result.current.switchingTo).toBeUndefined();
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(confirm).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('after the wait, ends quietly when the server already has the driver', async () => {
    const { hook, onError, confirm } = setup('terminal');
    await act(async () => hook.result.current.start('terminal'));
    await act(async () => vi.advanceTimersByTime(7_999));
    expect(confirm).not.toHaveBeenCalled();
    expect(hook.result.current.switchingTo).toBe('terminal');
    await act(async () => vi.advanceTimersByTime(1));
    expect(confirm).toHaveBeenCalledOnce();
    expect(hook.result.current.switchingTo).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });

  it('after the wait, says it could not confirm when the server has the other driver or cannot be read', async () => {
    for (const answer of ['ui', new Error('offline')] as const) {
      const { hook, onError } = setup(answer);
      await act(async () => hook.result.current.start('terminal'));
      await act(async () => vi.advanceTimersByTime(8_000));
      expect(hook.result.current.switchingTo).toBeUndefined();
      expect(onError).toHaveBeenCalledWith(SWITCH_UNCONFIRMED, answer === 'ui' ? undefined : answer);
      hook.unmount();
      vi.useRealTimers();
    }
  });

  it('a refused request ends the wait with its message', async () => {
    const refusal = new Error('Claude Code is busy. Switch when it is idle.');
    const { hook, onError, confirm } = setup('ui', () => Promise.reject(refusal));
    await act(async () => hook.result.current.start('terminal'));
    expect(hook.result.current.switchingTo).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(refusal.message, refusal);
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('unmounting stops the timer', async () => {
    const { hook, confirm } = setup('ui');
    await act(async () => hook.result.current.start('terminal'));
    hook.unmount();
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('conversationProps (review F2, F6)', () => {
  it('leaves the conversation alone while the chat drives', () => {
    expect(conversationProps(false, false)).toEqual({});
  });

  it('while the terminal drives, the conversation is hidden until the peek opens, and readable under its read-only name', () => {
    for (const peekOpen of [false, true]) {
      render(
        <PageBody {...conversationProps(true, peekOpen)}>
          <button type="button">Undo</button>
        </PageBody>,
      );
      const region = screen.getByRole('region', { name: READ_ONLY_CONVERSATION, hidden: true });
      // Kept in the accessibility tree (no inert): read-only comes from the ReadOnlyConversation context.
      expect(region.hasAttribute('inert')).toBe(false);
      const scroller = region.parentElement!;
      expect(scroller.getAttribute('data-slot')).toBe('page-body');
      expect(scroller.classList.contains('hidden')).toBe(!peekOpen);
      if (peekOpen) {
        // Below xl a sheet over the terminal; at xl beside it.
        expect(scroller.className).toContain('absolute');
        expect(scroller.className).toContain('xl:relative');
      }
      cleanup();
    }
  });
});

describe('availability reasons (story 3.7)', () => {
  // The reasons GET session's `terminal` carries, one per code (server/src/terminal-availability.ts).
  const reasons: Record<'agent_unsupported' | 'pty_unavailable' | 'no_agent_session' | 'cli_not_found', string> = {
    agent_unsupported: "Gemini CLI can't pick up this session in its terminal.",
    pty_unavailable: "The terminal couldn't start on this computer: node-pty failed to load",
    no_agent_session: 'Send Claude Code a message first, then switch to the terminal.',
    cli_not_found: "Claude Code's terminal couldn't be found on this computer.",
  };
  for (const [code, reason] of Object.entries(reasons)) {
    it(`${code}: the Terminal segment is disabled and its tooltip shows the reason`, async () => {
      const { onSwitch, terminal } = mount({ reason });
      expect(terminal.getAttribute('aria-disabled')).toBe('true');
      expect(await tooltipText(terminal)).toContain(reason);
      fireEvent.click(terminal);
      expect(onSwitch).not.toHaveBeenCalled();
    });
  }
});
