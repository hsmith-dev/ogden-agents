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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriverToggle, driverShortcutLabel, NOT_IDLE_REASON, SWITCHING_WORDS } from '../src/terminal/driver-toggle';
import { useDriverShortcut } from '../src/terminal/use-driver-shortcut';
import { TooltipProvider } from '../src/ui/tooltip';

afterEach(cleanup);

function mount(props: { driver?: SessionDriver; switching?: SessionDriver; reason?: string }) {
  const onSwitch = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <DriverToggle driver={props.driver ?? 'ui'} switching={props.switching} terminalBlockedReason={props.reason} onSwitch={onSwitch} />
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

  it('does nothing when off (Developer mode off)', () => {
    const { onToggle, terminal, terminalKeys } = setup(false);
    terminal.dispatchEvent(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(terminalKeys).toHaveBeenCalledOnce();
  });
});
