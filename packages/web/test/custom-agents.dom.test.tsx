// @vitest-environment happy-dom
/**
 * Your own agents on Settings, Agents (epic 21, story 21.3): each card says
 * what the agent can't do and where its key is kept (never the key), the
 * form shows the schema's sentence for a forbidden variable name, the key is
 * cleared once sent and never left in the page, a server refusal is shown in
 * its own words, Test lists what the agent said, and Remove asks first.
 */
import type { CustomAgent } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  agents: [] as unknown[],
  add: vi.fn(),
  remove: vi.fn(),
  testCommand: vi.fn(),
  testAgent: vi.fn(),
}));

vi.mock('../src/agents/custom-agents-api', () => ({
  CUSTOM_AGENTS_QUERY_KEY: ['custom-agents'],
  useCustomAgents: () => ({ data: api.agents, isError: false }),
  addCustomAgent: api.add,
  removeCustomAgent: api.remove,
  testCustomCommand: api.testCommand,
  testCustomAgent: api.testAgent,
}));

const { CustomAgentsSection, CUSTOM_AGENT_LIMITS } = await import('../src/agents/custom-agents');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.agents = [];
});

const SECRET = 'sk-test-0123456789abcdefSECRET';

const agent = (over: Partial<CustomAgent> = {}): CustomAgent => ({
  agentId: 'custom-my-harness',
  displayName: 'My harness',
  commandLine: '/usr/local/bin/harness acp',
  keyEnvName: 'MY_HARNESS_API_KEY',
  hasKey: true,
  ...over,
});

const section = (startAdding = false) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CustomAgentsSection startAdding={startAdding} />
    </QueryClientProvider>,
  );

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('your own agents', () => {
  it('a card says its limits and where its key is kept, never the key', () => {
    api.agents = [agent()];
    section();
    const card = screen.getByTestId('custom-agent-card');
    expect(card.textContent).toContain('My harness');
    expect(card.textContent).toContain('/usr/local/bin/harness acp');
    for (const line of CUSTOM_AGENT_LIMITS) expect(card.textContent).toContain(line);
    expect(card.textContent).toContain('Your own agent. Ogden asks before everything it does.');
    expect(screen.getByTestId('custom-agent-key').textContent).toBe('An API key is kept in your keychain as MY_HARNESS_API_KEY.');
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('says nothing about a key when none is kept', () => {
    api.agents = [agent({ hasKey: false, keyEnvName: null })];
    section();
    expect(screen.queryByTestId('custom-agent-key')).toBeNull();
  });

  it('opens the form from Add your own agent, or at once when asked to', () => {
    section();
    expect(screen.queryByTestId('custom-agent-form')).toBeNull();
    fireEvent.click(screen.getByTestId('custom-agent-add'));
    expect(screen.getByTestId('custom-agent-form')).toBeTruthy();
    cleanup();
    section(true);
    expect(screen.getByTestId('custom-agent-form')).toBeTruthy();
  });

  it.each([
    ['PATH', 'Use capital letters, digits and _ and end the name with _API_KEY, such as MY_AGENT_API_KEY.'],
    ['my_api_key', 'Use capital letters, digits and _ and end the name with _API_KEY, such as MY_AGENT_API_KEY.'],
    ['LD_PRELOAD_API_KEY', "That variable changes how programs start, so it can't hold a key. Pick another name."],
  ])('a forbidden variable name (%s) shows the schema sentence and Add agent stays disabled', async (envName, sentence) => {
    section(true);
    type('Name', 'My harness');
    type('Command', '/usr/local/bin/harness');
    type('API key (optional)', SECRET);
    type('Variable name', envName);
    expect(screen.getByTestId('custom-agent-env-help').textContent).toBe(sentence);
    expect(screen.getByLabelText('Variable name').getAttribute('aria-invalid')).toBe('true');
    const save = screen.getByTestId('custom-agent-save');
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('custom-agent-form-test').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(save);
    fireEvent.submit(screen.getByTestId('custom-agent-form'));
    await Promise.resolve();
    expect(api.add).not.toHaveBeenCalled();
  });

  it('a key with no variable name asks for one', () => {
    section(true);
    type('Name', 'My harness');
    type('Command', 'harness');
    type('API key (optional)', SECRET);
    expect(screen.getByTestId('custom-agent-env-help').textContent).toBe('Name the variable the key goes in, such as MY_AGENT_API_KEY.');
    expect(screen.getByTestId('custom-agent-save').getAttribute('aria-disabled')).toBe('true');
  });

  it('a key is sent once with the joined command line, the field is cleared, and the key is nowhere in the page after save', async () => {
    let finish: (value: CustomAgent) => void = () => {};
    api.add.mockImplementation(() => new Promise<CustomAgent>((resolve) => (finish = resolve)));
    section(true);
    type('Name', '  My harness ');
    type('Command', '/Applications/My Harness/harness');
    type('Arguments', 'acp --stdio');
    type('API key (optional)', SECRET);
    type('Variable name', 'MY_HARNESS_API_KEY');
    expect(screen.getByTestId('custom-agent-save').getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(screen.getByTestId('custom-agent-save'));
    await waitFor(() =>
      expect(api.add).toHaveBeenCalledWith({
        displayName: 'My harness',
        commandLine: '"/Applications/My Harness/harness" acp --stdio',
        apiKey: { envName: 'MY_HARNESS_API_KEY', value: SECRET },
      }),
    );
    // Cleared at once, before the answer.
    expect((screen.getByLabelText('API key (optional)') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('custom-agent-save').textContent).toBe('Adding...');
    expect(document.body.innerHTML).not.toContain(SECRET);
    finish(agent());
    await waitFor(() => expect(screen.queryByTestId('custom-agent-form')).toBeNull());
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("a server refusal is shown in its own words, the key is cleared, and the form stays", async () => {
    api.add.mockRejectedValue(new Error("Ogden Agents couldn't find harness. Type its full path, or check it is on your PATH."));
    section(true);
    type('Name', 'My harness');
    type('Command', 'harness');
    type('API key (optional)', SECRET);
    type('Variable name', 'MY_HARNESS_API_KEY');
    fireEvent.click(screen.getByTestId('custom-agent-save'));
    await waitFor(() => expect(screen.getByTestId('custom-agent-error').textContent).toBe("Ogden Agents couldn't find harness. Type its full path, or check it is on your PATH."));
    expect(screen.getByTestId('custom-agent-form')).toBeTruthy();
    expect((screen.getByLabelText('API key (optional)') as HTMLInputElement).value).toBe('');
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('Test on the form starts the typed command and lists what it said', async () => {
    api.testCommand.mockResolvedValue({
      advertised: { name: 'fake-acp-agent', version: '1.0.0', resume: false, load: true, image: false, audio: false, embeddedContext: false },
      lines: ['It started and says it is fake-acp-agent 1.0.0.', 'It can reopen a chat by replaying it.', 'Messages to it are text only.'],
    });
    section(true);
    type('Command', '/usr/bin/node');
    type('Arguments', '/tmp/fake-acp-agent.mjs');
    fireEvent.click(screen.getByTestId('custom-agent-form-test'));
    await waitFor(() => expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['It started and says it is fake-acp-agent 1.0.0.', 'It can reopen a chat by replaying it.', 'Messages to it are text only.']));
    expect(api.testCommand).toHaveBeenCalledWith({ commandLine: '/usr/bin/node /tmp/fake-acp-agent.mjs' });
    expect(api.add).not.toHaveBeenCalled();
  });

  it('Test on a card tests the saved agent and lists what it said, or its sentence', async () => {
    api.agents = [agent()];
    api.testAgent.mockResolvedValueOnce({
      advertised: { name: 'harness', resume: true, load: false, image: true, audio: false, embeddedContext: true },
      lines: ['It started and says it is harness.', 'It can pick a chat up where it left off.', 'Messages to it can include images and file contents.'],
    });
    section();
    fireEvent.click(screen.getByTestId('custom-agent-test'));
    await waitFor(() => expect(screen.getByTestId('custom-agent-test-lines').textContent).toContain('It can pick a chat up where it left off.'));
    expect(api.testAgent).toHaveBeenCalledWith('custom-my-harness');

    api.testAgent.mockRejectedValueOnce(new Error('My harness stopped before it answered.'));
    fireEvent.click(screen.getByTestId('custom-agent-test'));
    await waitFor(() => expect(screen.getByTestId('custom-agent-error').textContent).toBe('My harness stopped before it answered.'));
    expect(screen.queryByTestId('custom-agent-test-lines')).toBeNull();
  });

  it('Remove asks first; Keep it leaves the agent; Remove removes it', async () => {
    api.agents = [agent()];
    api.remove.mockResolvedValue(undefined);
    section();
    fireEvent.click(screen.getByTestId('custom-agent-remove'));
    expect(screen.getByRole('group', { name: 'Remove My harness? Its chats stay.' }).textContent).toContain('Remove My harness? Its chats stay.');
    // Focus follows the replaced button: to Remove when asked, back to Remove agent after Keep it.
    expect(document.activeElement).toBe(screen.getByTestId('custom-agent-remove-confirm'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('group', { name: 'Remove My harness? Its chats stay.' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('custom-agent-remove'));
    expect(api.remove).not.toHaveBeenCalled();
    expect(screen.getByTestId('custom-agent-card')).toBeTruthy();

    fireEvent.click(screen.getByTestId('custom-agent-remove'));
    fireEvent.click(screen.getByTestId('custom-agent-remove-confirm'));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('custom-my-harness'));
  });

  it('uses no em or en dash in what it says', () => {
    api.agents = [agent()];
    section(true);
    expect(document.body.textContent).not.toMatch(/[–—]/);
  });
});
