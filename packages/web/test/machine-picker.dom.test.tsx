// @vitest-environment happy-dom
/**
 * The machine a chat or an attended build runs on (CAP-24, epic 19 story
 * 19.7): Local plus every *confirmed* machine; an unconfirmed one never
 * shows; a live host-key probe (run once the menu opens) marks a machine
 * whose fingerprint has changed, or that can't be reached at all, as
 * unavailable with a plain reason -- unselectable by mouse, still reachable
 * by keyboard (the same `AgentPicker` pattern). In `unattendedMode`, every
 * remote machine is unavailable with 19.6's own universal reason, no live
 * check needed. The page contacts no server itself beyond the one probe.
 */
import type { RemoteMachine, RemoteMachineId } from '@ogden-agents/shared';
import { UNATTENDED_REMOTE_MESSAGE } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Opens a Radix menu the way a pointer does (happy-dom has no layout; `agent-choice.dom.test.tsx`'s own helper). */
function openMenu(trigger: HTMLElement) {
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
}

const api = vi.hoisted(() => ({
  machines: [] as unknown[],
  check: vi.fn(),
}));

vi.mock('../src/remote-machines/remote-machines-api', () => ({
  REMOTE_MACHINES_QUERY_KEY: ['remote-machines'],
  useRemoteMachines: () => ({ data: api.machines, isError: false, error: undefined, refetch: vi.fn() }),
  checkRemoteMachineHostKey: api.check,
}));

const { MachinePicker, LOCAL_MACHINE_LABEL, MACHINE_HOST_KEY_CHANGED_REASON, MACHINE_UNREACHABLE_REASON } = await import('../src/remote-machines/machine-picker');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.machines = [];
});

const MACHINE_ID = 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

const machine = (over: Partial<RemoteMachine> = {}): RemoteMachine => ({
  id: MACHINE_ID,
  host: 'bench.local',
  port: 22,
  username: 'ada',
  label: 'Build bench',
  hostKeyFingerprint: 'fp-pinned',
  publicKey: 'ssh-ed25519 FAKE test', // secret-scan:allow: an obviously-fake, in-memory test double
  hostKeyConfirmed: true,
  createdAt: '2026-10-07T00:00:00.000Z',
  ...over,
});

function mount(props: { value?: RemoteMachineId | null; onChange?: (id: RemoteMachineId | null) => void; unattendedMode?: boolean } = {}) {
  const onChange = props.onChange ?? vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MachinePicker value={props.value ?? null} onChange={onChange} unattendedMode={props.unattendedMode} />
    </QueryClientProvider>,
  );
  return { onChange };
}

/** The machine menu's own option for `machineId`, among every `machine-option` the menu shows. */
const optionFor = (machineId: string) => screen.getAllByTestId('machine-option').find((node) => node.getAttribute('data-machine') === machineId)!;

describe('MachinePicker (CAP-24, epic 19 story 19.7)', () => {
  it('renders nothing with no confirmed machine, even if an unconfirmed one exists', () => {
    api.machines = [machine({ hostKeyConfirmed: false })];
    mount();
    expect(screen.queryByTestId('machine-picker')).toBeNull();
  });

  it('offers Local and every confirmed machine, defaulting to Local; an unconfirmed machine never shows', () => {
    api.check.mockResolvedValue({ fingerprint: 'fp-pinned' });
    api.machines = [machine(), machine({ id: 'mach_second', label: 'Second box', hostKeyConfirmed: false })];
    mount();
    expect(screen.getByTestId('machine-picker').textContent).toContain(LOCAL_MACHINE_LABEL);
    openMenu(screen.getByTestId('machine-picker'));
    const options = screen.getAllByTestId('machine-option');
    expect(options).toHaveLength(2);
    expect(options.map((node) => node.getAttribute('data-machine'))).toEqual(['local-machine', MACHINE_ID]);
  });

  it('choosing an available machine calls onChange', async () => {
    api.check.mockResolvedValue({ fingerprint: 'fp-pinned' });
    api.machines = [machine()];
    const { onChange } = mount();
    openMenu(screen.getByTestId('machine-picker'));
    await waitFor(() => expect(api.check).toHaveBeenCalledWith(MACHINE_ID));
    fireEvent.click(optionFor(MACHINE_ID));
    expect(onChange).toHaveBeenCalledWith(MACHINE_ID);
  });

  it("a live probe whose fingerprint disagrees with the pinned one shows the machine unavailable, unselectable by mouse", async () => {
    api.check.mockResolvedValue({ fingerprint: 'fp-changed' });
    api.machines = [machine()];
    const { onChange } = mount();
    openMenu(screen.getByTestId('machine-picker'));
    await waitFor(() => expect(optionFor(MACHINE_ID).getAttribute('data-disabled')).toBe(''));
    expect(optionFor(MACHINE_ID).textContent).toContain(MACHINE_HOST_KEY_CHANGED_REASON);
    fireEvent.click(optionFor(MACHINE_ID));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('an unreachable machine shows the plain unreachable reason', async () => {
    api.check.mockRejectedValue(new Error('refused'));
    api.machines = [machine()];
    mount();
    openMenu(screen.getByTestId('machine-picker'));
    await waitFor(() => expect(optionFor(MACHINE_ID).textContent).toContain(MACHINE_UNREACHABLE_REASON));
  });

  it('unattendedMode shows every remote machine unavailable with the universal reason, no live probe needed', () => {
    api.machines = [machine()];
    const { onChange } = mount({ unattendedMode: true });
    openMenu(screen.getByTestId('machine-picker'));
    const remote = optionFor(MACHINE_ID);
    expect(remote.getAttribute('data-disabled')).toBe('');
    expect(remote.textContent).toContain(UNATTENDED_REMOTE_MESSAGE);
    expect(api.check).not.toHaveBeenCalled();
    fireEvent.click(remote);
    expect(onChange).not.toHaveBeenCalled();
    // Local is never disabled: unattended + local is always fine.
    expect(optionFor('local-machine').getAttribute('data-disabled')).toBeNull();
  });
});
