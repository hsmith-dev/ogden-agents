// @vitest-environment happy-dom
/**
 * Story 11 in a DOM: the chat's model picker (the agent's models with the
 * current one checked, its own default first, a note before the agent has
 * listed any, nothing chosen while the terminal drives), the chat's model
 * following `session.model_changed`, a refusal offering another model, and
 * a default-model section saving per agent.
 */
import type { AgentModel, ChatAgent, CoreEvent } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultModelsSection } from '../src/chat/default-models';
import { ModelPicker, TERMINAL_MODEL_REASON, useSessionModel } from '../src/chat/model-picker';
import { TooltipProvider } from '../src/ui/tooltip';

afterEach(cleanup);

const MODELS: AgentModel[] = [
  { id: 'opus', name: 'Opus', description: 'Most capable' },
  { id: 'sonnet', name: 'Sonnet' },
];

const open = async (testId: string) => {
  fireEvent.pointerDown(screen.getByTestId(testId), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByTestId(`${testId}-menu`);
};

function mountPicker(props: Partial<Parameters<typeof ModelPicker>[0]> = {}) {
  const onChoose = vi.fn();
  render(
    <TooltipProvider>
      <ModelPicker agentName="Claude Code" model={null} models={MODELS} current="opus" terminalDrives={false} changing={false} onChoose={onChoose} {...props} />
    </TooltipProvider>,
  );
  return { onChoose };
}

const options = () => screen.getAllByTestId('model-picker-option').map((option) => [option.getAttribute('data-model'), option.getAttribute('aria-checked')]);

describe('the chat model picker', () => {
  it("names the agent's own pick, lists its models with the current one checked, and asks for a switch", async () => {
    const { onChoose } = mountPicker();
    expect(screen.getByTestId('model-picker').getAttribute('aria-label')).toBe("Model: Claude Code's default");
    await open('model-picker');
    expect(options()).toEqual([
      ['', 'true'],
      ['opus', 'false'],
      ['sonnet', 'false'],
    ]);
    fireEvent.click(screen.getAllByTestId('model-picker-option')[2]!);
    expect(onChoose).toHaveBeenCalledWith('sonnet');
  });

  it('marks a chosen model, and choosing it again asks nothing', async () => {
    const { onChoose } = mountPicker({ model: 'sonnet' });
    expect(screen.getByTestId('model-picker').textContent).toContain('Sonnet');
    await open('model-picker');
    expect(options().find(([id]) => id === 'sonnet')?.[1]).toBe('true');
    fireEvent.click(screen.getAllByTestId('model-picker-option')[2]!);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("says when the agent's models appear, before it has listed any", async () => {
    mountPicker({ models: null, current: undefined });
    await open('model-picker');
    expect(screen.getByTestId('model-picker-empty').textContent).toContain("Claude Code's models appear here once it has started in a chat.");
  });

  it('while the terminal drives, every choice says why and nothing is asked', async () => {
    const { onChoose } = mountPicker({ terminalDrives: true });
    await open('model-picker');
    const sonnet = screen.getAllByTestId('model-picker-option')[2]!;
    expect(sonnet.textContent).toContain(TERMINAL_MODEL_REASON);
    expect(sonnet.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(sonnet);
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe("the chat's model follows the event log", () => {
  const event = (payload: { model: string | null; previous: string | null; cause: 'user' | 'agent'; reason?: string }, seq: number): CoreEvent =>
    ({
      id: `evt_01J9Z3K4M5N6P7Q8R9S0T1V2W${seq}`,
      seq,
      at: '2026-10-04T00:00:00.000Z',
      type: 'session.model_changed',
      workspaceId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3',
      streamId: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4',
      payload: { sessionId: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4', ...payload },
    }) as CoreEvent;

  it('reads the session until an event says otherwise, and a refusal is offered another model until the user picks', () => {
    expect(renderHook(() => useSessionModel([], 'opus')).result.current).toEqual({ model: 'opus', refusal: undefined });
    expect(renderHook(() => useSessionModel([], undefined)).result.current.model).toBeNull();
    const refused = event({ model: null, previous: 'opus', cause: 'agent', reason: "Claude Code couldn't switch to Opus: not in your plan." }, 5);
    expect(renderHook(() => useSessionModel([refused], 'opus')).result.current).toEqual({
      model: null,
      refusal: { model: 'opus', reason: "Claude Code couldn't switch to Opus: not in your plan." },
    });
    const picked = event({ model: 'sonnet', previous: null, cause: 'user' }, 6);
    expect(renderHook(() => useSessionModel([refused, picked], 'opus')).result.current).toEqual({ model: 'sonnet', refusal: undefined });
  });
});

describe('a default models section', () => {
  const agent = (overrides: Partial<ChatAgent> = {}): ChatAgent => ({
    agentId: 'claude-code',
    displayName: 'Claude Code',
    provider: 'Anthropic',
    signInMethods: [],
    install: 'installed',
    auth: 'signed_in',
    terminalResume: true,
    needsProjectTrust: false,
    permissionModes: ['ask'],
    models: MODELS,
    ...overrides,
  });

  it('saves the chosen model per agent and says so; a failure is shown', async () => {
    const onChoose = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("The default model couldn't be saved"));
    render(
      <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <DefaultModelsSection
          agents={[agent()]}
          testId="app-models"
          description="Per agent."
          valueOf={() => null}
          noneOf={() => ({ label: "Claude Code's default", description: 'It picks.' })}
          onChoose={onChoose}
        />
      </TooltipProvider>
      </QueryClientProvider>,
    );
    await open('app-models-claude-code');
    fireEvent.click(screen.getAllByTestId('app-models-claude-code-option')[1]!);
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'claude-code' }), 'opus');
    await waitFor(() => expect(screen.getByTestId('app-models-status').textContent).toBe('Saved: new Claude Code chats start on Opus.'));
    await open('app-models-claude-code');
    fireEvent.click(screen.getAllByTestId('app-models-claude-code-option')[2]!);
    await waitFor(() => expect(screen.getByTestId('app-models-error').textContent).toContain("The default model couldn't be saved"));
  });
});
