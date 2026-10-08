// @vitest-environment happy-dom
/**
 * The remote machines settings page (CAP-24, epic 19 story 19.3): adding a
 * machine shows it unconfirmed with a blocking host-key card; the card
 * shows the live fingerprint and only confirms with an explicit action;
 * once confirmed it collapses to a one-line record whose public key is
 * available on request; Remove acts at once, from either state. The page
 * contacts no server itself (it only ever calls Ogden Agents' own API).
 */
import type { RemoteMachine } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  machines: [] as unknown[],
  add: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  check: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../src/remote-machines/remote-machines-api', () => ({
  REMOTE_MACHINES_QUERY_KEY: ['remote-machines'],
  useRemoteMachines: () => ({ data: api.machines, isError: false, error: undefined, refetch: vi.fn() }),
  fetchRemoteMachines: vi.fn(() => Promise.resolve(api.machines)),
  addRemoteMachine: api.add,
  renameRemoteMachine: api.rename,
  removeRemoteMachine: api.remove,
  checkRemoteMachineHostKey: api.check,
  confirmRemoteMachineHostKey: api.confirm,
}));

const { RemoteMachinesSection } = await import('../src/remote-machines/remote-machines-section');
const { TooltipProvider } = await import('../src/ui/tooltip');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.machines = [];
});

const machine = (over: Partial<RemoteMachine> = {}): RemoteMachine => ({
  id: 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W3',
  host: 'bench.local',
  port: 22,
  username: 'ada',
  label: 'Build bench',
  hostKeyFingerprint: null,
  publicKey: null,
  hostKeyConfirmed: false,
  createdAt: '2026-10-07T00:00:00.000Z',
  ...over,
});

const page = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <RemoteMachinesSection />
      </TooltipProvider>
    </QueryClientProvider>,
  );

describe('the remote machines settings page', () => {
  it('says plainly when none is added, and offers Add a machine', () => {
    page();
    expect(screen.getByTestId('remote-machines-empty').textContent).toContain('No machines added yet');
    expect(screen.getByTestId('remote-machine-add-other')).toBeTruthy();
  });

  it('adds a machine through the form, with the name, host, port and username sent', async () => {
    api.add.mockResolvedValue(machine());
    page();
    fireEvent.click(screen.getByTestId('remote-machine-add-other'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Build bench' } });
    fireEvent.change(screen.getByLabelText('Host name or IP address'), { target: { value: 'bench.local' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByTestId('remote-machine-submit'));
    await waitFor(() => expect(api.add).toHaveBeenCalledWith({ host: 'bench.local', port: 22, username: 'ada', label: 'Build bench' }));
  });

  it('shows an unconfirmed machine with its host-key confirm card, reading the fingerprint fresh, and confirms only on an explicit action', async () => {
    api.machines = [machine()];
    api.check.mockResolvedValue({ fingerprint: 'fp-live' });
    const confirmed = machine({ hostKeyFingerprint: 'fp-live', publicKey: 'ssh-ed25519 AAAA ogden-agents:mach_test', hostKeyConfirmed: true });
    api.confirm.mockResolvedValue(confirmed);
    page();
    expect(screen.getByTestId('host-key-confirm-card')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('host-key-confirm-card').textContent).toContain('fp-live'));
    const confirmButton = screen.getByTestId('host-key-confirm-button') as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);
    // No button is focused by default: the confirm action is never activated except by an explicit click.
    expect(document.activeElement).not.toBe(confirmButton);
    fireEvent.click(confirmButton);
    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith(machine().id, 'fp-live'));
  });

  it('shows an unreachable machine’s check failure in plain words, and confirms nothing', async () => {
    api.machines = [machine()];
    api.check.mockRejectedValue(new Error('Could not reach bench.local:22.'));
    page();
    await waitFor(() => expect(screen.getByTestId('host-key-confirm-error').textContent).toContain('Could not reach'));
    expect(api.confirm).not.toHaveBeenCalled();
  });

  it('a confirmed machine is a one-line record whose public key shows only on request, and Remove acts at once', async () => {
    api.machines = [machine({ hostKeyFingerprint: 'fp-1', publicKey: 'ssh-ed25519 AAAA ogden-agents:mach_test', hostKeyConfirmed: true })];
    api.remove.mockResolvedValue(undefined);
    page();
    expect(screen.getByTestId('remote-machine-row')).toBeTruthy();
    expect(screen.queryByText(/ssh-ed25519/)).toBeNull();
    fireEvent.click(screen.getByTestId('remote-machine-show-key'));
    expect(screen.getByText(/ssh-ed25519 AAAA/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('remote-machine-remove'));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(machine().id));
  });
});
