import {
  CustomAgentKeyEnvName,
  joinCommandLine,
  MAX_CUSTOM_AGENT_COMMAND_LENGTH,
  MAX_CUSTOM_AGENT_KEY_LENGTH,
  MAX_CUSTOM_AGENT_NAME_LENGTH,
  type CustomAgent,
} from '@ogden-agents/shared';
import { Plus, Trash } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { Text } from '@/ui/typography';
import { addCustomAgent, CUSTOM_AGENTS_QUERY_KEY, removeCustomAgent, testCustomAgent, testCustomCommand, useCustomAgents } from './custom-agents-api';

/**
 * Your own agents (epic 21, story 21.3; CAP-27, E21-R2, E21-R3;
 * EXPERIENCE.md Add your own agent): each ACP agent the user brings is a card
 * that says what it can't do, with Test and Remove; **Add your own agent**
 * opens the form (`/settings/agents/new` opens it at once). The command is
 * typed (the page has no file dialog, AD-15) and checked by the server; the
 * key is a write-only field, sent once and cleared at once, never kept in the
 * page.
 */
export function CustomAgentsSection({ startAdding = false, onFormClosed }: { startAdding?: boolean; onFormClosed?: () => void }) {
  const query = useCustomAgents();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(startAdding);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: CUSTOM_AGENTS_QUERY_KEY });
  return (
    <PageSection aria-labelledby="custom-agents-title" data-testid="custom-agents">
      <Text as="h2" variant="heading" id="custom-agents-title">
        Your own agents
      </Text>
      <Text variant="caption">Any agent that speaks ACP, such as your own harness or an open-source one aimed at your model.</Text>
      {query.isError ? (
        <Notice variant="blocked" action={<Button onClick={() => void query.refetch()}>Try again</Button>}>
          {query.error.message}
        </Notice>
      ) : null}
      {(query.data ?? []).map((agent) => (
        <CustomAgentCard key={agent.agentId} agent={agent} onRemoved={refresh} />
      ))}
      {adding ? (
        <CustomAgentForm
          onDone={(saved) => {
            setAdding(false);
            if (saved) refresh();
            onFormClosed?.();
          }}
        />
      ) : (
        <div className="flex">
          <Button variant="outline" onClick={() => setAdding(true)} data-testid="custom-agent-add">
            <Plus aria-hidden />
            Add your own agent
          </Button>
        </div>
      )}
    </PageSection>
  );
}

/** What a custom agent can't do, said on its card (E21-R4; enforced by the server in entry 4). */
export const CUSTOM_AGENT_LIMITS = [
  'Your own agent. Ogden asks before everything it does.',
  'It works in Ask only.',
  'It needs you to trust a project before it works there.',
  'It never builds on its own.',
  "It can't be a worker in an orchestrated run.",
] as const;

function TestResult({ lines, error }: { lines: readonly string[] | undefined; error: string | undefined }) {
  return (
    // Always on the page, so a screen reader announces what is put in it.
    <div role="status" aria-live="polite" data-testid="custom-agent-test-result">
      {error === undefined ? null : (
        <Text variant="caption" data-testid="custom-agent-error">
          {error}
        </Text>
      )}
      {lines === undefined ? null : (
        <ul className="flex list-disc flex-col gap-1 pl-5" data-testid="custom-agent-test-lines">
          {lines.map((line) => (
            <li key={line}>
              <Text variant="caption">{line}</Text>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CustomAgentCard({ agent, onRemoved }: { agent: CustomAgent; onRemoved: () => void }) {
  const [asking, setAsking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lines, setLines] = useState<string[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const headingId = `custom-agent-${agent.agentId}-name`;
  // The button pressed is replaced, so focus moves with it: to Remove when asked, back to Remove agent when not.
  const removeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const askedOnce = useRef(false);
  useEffect(() => {
    if (asking) {
      askedOnce.current = true;
      confirmRef.current?.focus();
    } else if (askedOnce.current) removeRef.current?.focus();
  }, [asking]);

  const runTest = async () => {
    setTesting(true);
    setError(undefined);
    setLines(undefined);
    try {
      setLines((await testCustomAgent(agent.agentId)).lines);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That agent couldn't be tested.");
    } finally {
      setTesting(false);
    }
  };
  const remove = async () => {
    setError(undefined);
    try {
      await removeCustomAgent(agent.agentId);
      onRemoved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That agent couldn't be removed.");
      setAsking(false);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-(--panel-padding)"
      data-testid="custom-agent-card"
      data-agent-id={agent.agentId}
    >
      <Text as="h3" variant="heading" id={headingId}>
        {agent.displayName}
      </Text>
      <Text variant="mono-compact" className="break-all" data-testid="custom-agent-command-line">
        {agent.commandLine}
      </Text>
      {agent.hasKey && agent.keyEnvName !== null ? (
        <Text variant="caption" data-testid="custom-agent-key">
          An API key is kept in your keychain as {agent.keyEnvName}.
        </Text>
      ) : null}
      <ul className="flex list-disc flex-col gap-1 pl-5" data-testid="custom-agent-limits">
        {CUSTOM_AGENT_LIMITS.map((line) => (
          <li key={line}>
            <Text variant="caption">{line}</Text>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" aria-disabled={testing} onClick={testing ? undefined : () => void runTest()} data-testid="custom-agent-test">
          {testing ? 'Testing...' : 'Test'}
        </Button>
        {asking ? (
          <span className="flex flex-wrap items-center gap-2" role="group" aria-label={`Remove ${agent.displayName}? Its chats stay.`} data-testid="custom-agent-remove-ask">
            <Text variant="caption">Remove {agent.displayName}? Its chats stay.</Text>
            <Button ref={confirmRef} variant="outline" onClick={() => void remove()} data-testid="custom-agent-remove-confirm">
              Remove
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              Keep it
            </Button>
          </span>
        ) : (
          <Button ref={removeRef} variant="ghost" onClick={() => setAsking(true)} data-testid="custom-agent-remove">
            <Trash aria-hidden />
            Remove agent
          </Button>
        )}
      </div>
      <TestResult lines={lines} error={error} />
    </section>
  );
}

/** The variable name's problem in the schema's own words, or `undefined` when it is fine or empty. */
function envNameProblem(envName: string): string | undefined {
  if (envName.trim() === '') return undefined;
  const parsed = CustomAgentKeyEnvName.safeParse(envName);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

/** Add your own agent: Name, Command, Arguments, an optional key and its variable, Test and Add agent. */
export function CustomAgentForm({ onDone }: { onDone: (saved: boolean) => void }) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [key, setKey] = useState('');
  const [envName, setEnvName] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | undefined>(undefined);
  const [lines, setLines] = useState<string[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const commandLine = command.trim() === '' ? '' : joinCommandLine(command, args);
  const wantsKey = key.trim() !== '';
  const envProblem = wantsKey && envName.trim() === '' ? 'Name the variable the key goes in, such as MY_AGENT_API_KEY.' : envNameProblem(envName);
  const canTest = busy === undefined && commandLine !== '' && commandLine.length <= MAX_CUSTOM_AGENT_COMMAND_LENGTH && envProblem === undefined;
  const canSave = canTest && name.trim() !== '';
  const apiKey = () => (wantsKey ? { apiKey: { envName: envName.trim(), value: key } } : {});

  const test = async () => {
    if (!canTest) return;
    setBusy('test');
    setError(undefined);
    setLines(undefined);
    try {
      setLines((await testCustomCommand({ commandLine, ...apiKey() })).lines);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That agent couldn't be tested.");
    } finally {
      setBusy(undefined);
    }
  };
  const save = async () => {
    if (!canSave) return;
    const body = { displayName: name.trim(), commandLine, ...apiKey() };
    // Cleared at once, whatever the answer: the key never stays in the page.
    setKey('');
    setBusy('save');
    setError(undefined);
    setLines(undefined);
    try {
      await addCustomAgent(body);
      onDone(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That agent couldn't be added.");
      setBusy(undefined);
    }
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-(--panel-padding)"
      aria-label="Add your own agent"
      data-testid="custom-agent-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Text as="h3" variant="heading">
        Add your own agent
      </Text>
      <div className="flex flex-col gap-1">
        <Label htmlFor="custom-agent-name">Name</Label>
        <Input id="custom-agent-name" value={name} maxLength={MAX_CUSTOM_AGENT_NAME_LENGTH} onChange={(event) => setName(event.target.value)} autoComplete="off" autoFocus />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="custom-agent-command">Command</Label>
        <Input
          id="custom-agent-command"
          className="font-mono"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="goose"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby="custom-agent-command-help"
        />
        <Text variant="caption" id="custom-agent-command-help">
          A program on this computer: its full path, or its name if it is on your PATH.
        </Text>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="custom-agent-args">Arguments</Label>
        <Input id="custom-agent-args" className="font-mono" value={args} onChange={(event) => setArgs(event.target.value)} placeholder="acp" autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="custom-agent-key">API key (optional)</Label>
        <Input
          id="custom-agent-key"
          type="password"
          value={key}
          maxLength={MAX_CUSTOM_AGENT_KEY_LENGTH}
          onChange={(event) => setKey(event.target.value)}
          name="ogden-agents-custom-agent-key"
          autoComplete="one-time-code"
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          data-form-type="other"
          spellCheck={false}
          aria-describedby="custom-agent-key-help"
        />
        <Text variant="caption" id="custom-agent-key-help">
          Kept in your keychain. Only this agent gets it.
        </Text>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="custom-agent-env">Variable name</Label>
        <Input
          id="custom-agent-env"
          className="font-mono"
          value={envName}
          onChange={(event) => setEnvName(event.target.value)}
          placeholder="MY_AGENT_API_KEY"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={envProblem !== undefined}
          aria-describedby="custom-agent-env-help"
        />
        <Text variant="caption" id="custom-agent-env-help" role={envProblem === undefined ? undefined : 'alert'} data-testid="custom-agent-env-help">
          {envProblem ?? 'The key reaches the agent in this variable. It must end in _API_KEY.'}
        </Text>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" aria-disabled={!canTest} onClick={canTest ? () => void test() : undefined} data-testid="custom-agent-form-test">
          {busy === 'test' ? 'Testing...' : 'Test'}
        </Button>
        <Button type="submit" variant="primary" aria-disabled={!canSave} data-testid="custom-agent-save">
          {busy === 'save' ? 'Adding...' : 'Add agent'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
      <TestResult lines={lines} error={error} />
    </form>
  );
}
