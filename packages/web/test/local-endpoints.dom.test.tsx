// @vitest-environment happy-dom
/**
 * The Local model's servers section (epic 14 story 14.4): loopback needs no
 * confirmation, another host shows where messages go and waits for the
 * user's confirmation, plain http warns, Detect and presets come from the
 * server's data, a key is sent once and never shown again, and the page
 * contacts no server itself (it only ever calls Ogden Agents' own API).
 */
import type { LocalEndpointView } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  endpoints: [] as unknown[],
  presets: [
    { id: 'p-one', label: 'Server One', baseUrl: 'http://localhost:1234/v1', downloadUrl: 'https://example.com/one' },
    { id: 'p-two', label: 'Server Two', baseUrl: 'http://localhost:11434/v1', downloadUrl: 'https://example.com/two' },
  ],
  add: vi.fn(),
  detect: vi.fn(),
  test: vi.fn(),
  confirm: vi.fn(),
  saveKey: vi.fn(),
  removeKey: vi.fn(),
  remove: vi.fn(),
  setDefault: vi.fn(),
}));

vi.mock('../src/agents/local-endpoints-api', () => ({
  LOCAL_ENDPOINTS_QUERY_KEY: ['local-endpoints'],
  useLocalEndpoints: () => ({ data: { endpoints: api.endpoints, defaultEndpointId: null }, isError: false }),
  useEndpointPresets: () => ({ data: api.presets }),
  addLocalEndpoint: api.add,
  detectLocalServers: api.detect,
  testLocalEndpoint: api.test,
  confirmEndpointHost: api.confirm,
  saveEndpointKey: api.saveKey,
  removeEndpointKey: api.removeKey,
  removeLocalEndpoint: api.remove,
  setDefaultEndpoint: api.setDefault,
}));

const { LocalEndpointsSection } = await import('../src/agents/local-endpoints');
const { TooltipProvider } = await import('../src/ui/tooltip');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.endpoints = [];
});

const view = (over: Partial<LocalEndpointView> = {}): LocalEndpointView => ({
  id: 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3',
  label: 'My server',
  preset: null,
  baseUrl: 'http://localhost:1234/v1',
  auth: 'none',
  model: null,
  remoteConfirmedFor: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  host: 'http://localhost:1234',
  loopback: true,
  needsConfirmation: false,
  insecureRemote: false,
  keySaved: false,
  ...over,
});

const section = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <LocalEndpointsSection />
      </TooltipProvider>
    </QueryClientProvider>,
  );

describe('the servers section', () => {
  it('says plainly when none is set up, and offers the presets the server gave, Detect and add another', () => {
    section();
    expect(screen.getByTestId('endpoint-none').textContent).toContain('No server is set up yet');
    expect(screen.getByRole('button', { name: 'Use Server One' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use Server Two' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Detect on this computer/ })).toBeTruthy();
    expect(api.detect).not.toHaveBeenCalled();
  });

  it('a preset fills the name and address; a server on this computer needs no confirmation and no key', async () => {
    api.add.mockResolvedValue(view());
    section();
    fireEvent.click(screen.getByRole('button', { name: 'Use Server One' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Server One');
    expect((screen.getByLabelText('Server address') as HTMLInputElement).value).toBe('http://localhost:1234/v1');
    expect(screen.getByTestId('endpoint-privacy').textContent).toBe('This server runs on this computer. Nothing leaves it except to this server.');
    expect(screen.queryByTestId('endpoint-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('endpoint-add-submit'));
    await waitFor(() => expect(api.add).toHaveBeenCalledWith({ label: 'Server One', baseUrl: 'http://localhost:1234/v1', preset: 'p-one' }));
  });

  it('another host shows where messages go, warns about plain http, and adds only after the confirmation', async () => {
    api.add.mockResolvedValue(view({ loopback: false }));
    section();
    fireEvent.click(screen.getByTestId('endpoint-add-other'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Gateway' } });
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'http://192.168.1.20:8000/v1' } });
    const words = screen.getByTestId('endpoint-confirm').textContent ?? '';
    expect(words).toContain('http://192.168.1.20:8000');
    expect(words).toContain('plain http');
    // Not added until confirmed.
    fireEvent.click(screen.getByTestId('endpoint-add-submit'));
    expect(api.add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('endpoint-add-submit'));
    await waitFor(() => expect(api.add).toHaveBeenCalledWith({ label: 'Gateway', baseUrl: 'http://192.168.1.20:8000/v1', confirmHost: 'http://192.168.1.20:8000' }));
  });

  it('https does not warn about plain http, and a changed address asks again', () => {
    section();
    fireEvent.click(screen.getByTestId('endpoint-add-other'));
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'https://api.example.com/v1' } });
    expect(screen.getByTestId('endpoint-confirm').textContent).not.toContain('plain http');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'https://other.example.com/v1' } });
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
  });

  it('says in plain words why an address cannot be used, never echoing a password', () => {
    section();
    fireEvent.click(screen.getByTestId('endpoint-add-other'));
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'http://me:hunter2@localhost:1234/v1' } });
    const problem = screen.getByTestId('endpoint-address-problem').textContent ?? '';
    expect(problem).toContain('key box');
    expect(problem).not.toContain('hunter2');
  });

  it('sends a key once, clears the field, and never shows it again', async () => {
    // The add fails, so the form stays open and the field can be checked while it is still on the page.
    api.add.mockRejectedValue(new Error('Could not add.'));
    section();
    fireEvent.click(screen.getByTestId('endpoint-add-other'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Keyed' } });
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'http://localhost:1234/v1' } });
    const field = screen.getByLabelText(/^Key/) as HTMLInputElement;
    expect(field.type).toBe('password');
    fireEvent.change(field, { target: { value: 'sk-secret-123' } });
    fireEvent.click(screen.getByTestId('endpoint-add-submit'));
    await waitFor(() => expect(api.add).toHaveBeenCalledWith({ label: 'Keyed', baseUrl: 'http://localhost:1234/v1', key: 'sk-secret-123' }));
    await waitFor(() => expect(screen.getByTestId('endpoint-form-error').textContent).toBe('Could not add.'));
    expect(field.value).toBe('');
    expect(document.body.textContent).not.toContain('sk-secret-123');
    // Cancel leaves nothing typed behind.
    fireEvent.change(field, { target: { value: 'sk-secret-456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByTestId('endpoint-add-other'));
    expect((screen.getByLabelText(/^Key/) as HTMLInputElement).value).toBe('');
  });

  it('Detect lists what the server found, with Use it, and says none was found with the download pages', async () => {
    api.detect.mockResolvedValueOnce([{ presetId: 'p-one', label: 'Server One', baseUrl: 'http://127.0.0.1:1234/v1', models: 2 }]);
    section();
    fireEvent.click(screen.getByTestId('endpoint-detect'));
    await waitFor(() => expect(screen.getByTestId('endpoint-detect-found').textContent).toContain('Found Server One on this computer, with 2 models.'));
    fireEvent.click(screen.getByRole('button', { name: 'Use it' }));
    expect((screen.getByLabelText('Server address') as HTMLInputElement).value).toBe('http://127.0.0.1:1234/v1');
    cleanup();
    api.detect.mockResolvedValueOnce([]);
    section();
    fireEvent.click(screen.getByTestId('endpoint-detect'));
    await waitFor(() => expect(screen.getByTestId('endpoint-detect-none').textContent).toContain('No server found on this computer.'));
    const link = screen.getByTestId('endpoint-download-p-one') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.com/one');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.textContent).toBe('Get Server One');
  });
});

describe('a listed server', () => {
  it('shows where its messages go and Test connection with the result in plain words', async () => {
    api.endpoints = [view()];
    api.test.mockResolvedValue({ state: 'ready', models: ['a'], message: 'Ready. 1 model is available.' });
    section();
    expect(screen.getByTestId('endpoint-host').textContent).toBe('http://localhost:1234');
    expect(screen.getByTestId('endpoint-privacy').textContent).toContain('Nothing leaves it except to this server');
    fireEvent.click(screen.getByTestId('endpoint-test'));
    await waitFor(() => expect(screen.getByTestId('endpoint-test-result').textContent).toBe('Ready. 1 model is available.'));
    expect(screen.getByTestId('endpoint-test-result').getAttribute('data-state')).toBe('ready');
  });

  it('an unconfirmed host cannot be tested until the user confirms it', async () => {
    api.endpoints = [view({ loopback: false, needsConfirmation: true, host: 'https://b.example.com', insecureRemote: false })];
    api.confirm.mockResolvedValue(view());
    section();
    expect(screen.getByTestId('endpoint-needs-confirmation').textContent).toContain('Nothing is sent to it until you confirm');
    fireEvent.click(screen.getByTestId('endpoint-test'));
    expect(api.test).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'I understand, use this server' }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith('lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3', 'https://b.example.com'));
  });

  it('shows a saved key only as saved, and removes it', async () => {
    api.endpoints = [view({ keySaved: true, auth: 'key' })];
    api.removeKey.mockResolvedValue(view());
    section();
    expect(screen.getByTestId('endpoint-key-saved').textContent).toBe("Key saved in this computer's keychain.");
    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    await waitFor(() => expect(api.removeKey).toHaveBeenCalledOnce());
  });

  it('removes a server only after asking once more', async () => {
    api.endpoints = [view()];
    api.remove.mockResolvedValue(undefined);
    section();
    fireEvent.click(screen.getByTestId('endpoint-remove'));
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    fireEvent.click(screen.getByTestId('endpoint-remove'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledOnce());
  });

  it('with several, marks the one new chats use and can change it', async () => {
    api.endpoints = [view(), view({ id: 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W4', label: 'Second', host: 'http://localhost:11434' })];
    api.setDefault.mockResolvedValue({});
    section();
    expect(screen.getAllByTestId('endpoint-label')[0]!.textContent).toContain('used for new chats');
    fireEvent.click(screen.getByRole('button', { name: 'Use for new chats' }));
    await waitFor(() => expect(api.setDefault).toHaveBeenCalledWith('lep_01J9Z3K4M5N6P7Q8R9S0T1V2W4'));
  });
});
