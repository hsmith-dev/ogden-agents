import { LOOPBACK_PRIVACY_WORDS, remoteConfirmationWords, type LocalEndpointId, type LocalEndpointTestResponse, type LocalEndpointView } from '@ogden-agents/shared';
import { Key, Trash } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Notice } from '@/ui/notice';
import { Text } from '@/ui/typography';
import { AddEndpoint } from './local-endpoint-form';
import {
  confirmEndpointHost,
  LOCAL_ENDPOINTS_QUERY_KEY,
  removeEndpointKey,
  removeLocalEndpoint,
  saveEndpointKey,
  setDefaultEndpoint,
  testLocalEndpoint,
  useLocalEndpoints,
} from './local-endpoints-api';

/**
 * The OpenAI-compatible endpoints card section of the Local model (epic 14
 * story 14.4; E14-R2, E14-R6): the list of servers, each with where its
 * messages go in plain words, Test connection, its key (never shown again
 * after saving), a per-endpoint confirmation for another host, and Remove;
 * then Add. The page never contacts a server: it asks Ogden Agents, which does.
 */
export function LocalEndpointsSection() {
  const query = useLocalEndpoints();
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: LOCAL_ENDPOINTS_QUERY_KEY });
  const [error, setError] = useState<string | undefined>(undefined);
  const guard = async (work: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await work();
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That did not work. Try again.');
    }
  };
  if (query.data === undefined) {
    return query.isError ? (
      <Notice variant="blocked" action={<Button onClick={() => void query.refetch()}>Try again</Button>}>
        {query.error.message}
      </Notice>
    ) : null;
  }
  const { endpoints, defaultEndpointId } = query.data;
  return (
    <div className="flex flex-col gap-4" data-testid="local-endpoints">
      <Text as="h3" variant="heading">
        Servers
      </Text>
      {endpoints.length === 0 ? (
        <Text variant="body" data-testid="endpoint-none">
          No server is set up yet. Use a preset or Detect below, or add any OpenAI compatible server.
        </Text>
      ) : (
        <ul className="flex flex-col gap-3">
          {endpoints.map((endpoint) => (
            <li key={endpoint.id}>
              <EndpointRow
                endpoint={endpoint}
                isDefault={defaultEndpointId === endpoint.id || (defaultEndpointId === null && endpoints[0]?.id === endpoint.id)}
                many={endpoints.length > 1}
                onChange={refresh}
                guard={guard}
              />
            </li>
          ))}
        </ul>
      )}
      <AddEndpoint onAdded={refresh} />
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="endpoint-error">
          {error}
        </Text>
      )}
    </div>
  );
}

function EndpointRow({
  endpoint,
  isDefault,
  many,
  onChange,
  guard,
}: {
  endpoint: LocalEndpointView;
  isDefault: boolean;
  many: boolean;
  onChange: () => void;
  guard: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [test, setTest] = useState<LocalEndpointTestResponse | undefined>(undefined);
  const [testing, setTesting] = useState(false);
  const [asking, setAsking] = useState(false);
  const runTest = async () => {
    setTesting(true);
    setTest(undefined);
    await guard(async () => setTest(await testLocalEndpoint(endpoint.id)));
    setTesting(false);
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid={`endpoint-${endpoint.id}`} data-needs-confirmation={endpoint.needsConfirmation ? '' : undefined}>
      <Text variant="body" data-testid="endpoint-label">
        {endpoint.label}
        {isDefault && many ? ' (used for new chats)' : ''}
      </Text>
      <Text variant="caption" data-testid="endpoint-host">
        {endpoint.host}
      </Text>
      {/* The privacy statement for this endpoint, in every state: where messages and project text go. */}
      <Text variant="caption" data-testid="endpoint-privacy">
        {endpoint.loopback ? LOOPBACK_PRIVACY_WORDS : remoteConfirmationWords(endpoint.host, endpoint.insecureRemote)}
      </Text>
      {endpoint.needsConfirmation ? (
        <Notice
          variant="blocked"
          glyphLabel="Needs your confirmation"
          data-testid="endpoint-needs-confirmation"
          action={
            <Button variant="secondary" onClick={() => void guard(() => confirmEndpointHost(endpoint.id, endpoint.host))}>
              I understand, use this server
            </Button>
          }
        >
          This server is not on this computer and has not been confirmed. Nothing is sent to it until you confirm.
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" aria-disabled={testing || endpoint.needsConfirmation} onClick={testing || endpoint.needsConfirmation ? undefined : () => void runTest()} data-testid="endpoint-test">
          {testing ? 'Testing...' : 'Test connection'}
        </Button>
        {many && !isDefault ? (
          <Button variant="ghost" onClick={() => void guard(() => setDefaultEndpoint(endpoint.id))}>
            Use for new chats
          </Button>
        ) : null}
        {asking ? (
          <span className="flex items-center gap-2" role="group" aria-label={`Remove ${endpoint.label}?`}>
            <Button variant="outline" onClick={() => void guard(() => removeLocalEndpoint(endpoint.id))}>
              Remove
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              Keep it
            </Button>
          </span>
        ) : (
          <Button variant="ghost" onClick={() => setAsking(true)} data-testid="endpoint-remove">
            <Trash aria-hidden />
            Remove server
          </Button>
        )}
      </div>
      {test === undefined ? null : (
        <Text variant="caption" role="status" data-testid="endpoint-test-result" data-state={test.state}>
          {test.message}
        </Text>
      )}
      <EndpointKey endpointId={endpoint.id} saved={endpoint.keySaved} guard={guard} onChange={onChange} />
    </div>
  );
}

/** A server's key: saved (never shown again) with Remove key, or a write-only field. */
function EndpointKey({ endpointId, saved, guard }: { endpointId: LocalEndpointId; saved: boolean; guard: (work: () => Promise<unknown>) => Promise<void>; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const fieldId = `endpoint-${endpointId}-key`;
  if (saved) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="endpoint-key">
        <Text variant="caption" data-testid="endpoint-key-saved">
          Key saved in this computer's keychain.
        </Text>
        <Button variant="ghost" onClick={() => void guard(() => removeEndpointKey(endpointId))}>
          Remove key
        </Button>
      </div>
    );
  }
  if (!open) {
    return (
      <div className="flex" data-testid="endpoint-key">
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Key aria-hidden />
          Add a key
        </Button>
      </div>
    );
  }
  const submit = () => {
    if (value.trim() === '') return;
    const key = value;
    // Cleared at once: the key never stays in the page.
    setValue('');
    void guard(async () => {
      await saveEndpointKey(endpointId, key);
      setOpen(false);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  };
  return (
    <div className="flex flex-col gap-1" data-testid="endpoint-key">
      <Label htmlFor={fieldId}>Key</Label>
      <div className="flex gap-2">
        <Input
          id={fieldId}
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          name="ogden-agents-endpoint-key"
          autoComplete="one-time-code"
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          data-form-type="other"
          spellCheck={false}
        />
        <Button type="button" variant="secondary" aria-disabled={value.trim() === ''} onClick={submit}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
