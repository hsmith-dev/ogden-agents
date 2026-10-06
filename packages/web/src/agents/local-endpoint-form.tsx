import { LOOPBACK_PRIVACY_WORDS, MAX_ENDPOINT_KEY, MAX_ENDPOINT_LABEL, readEndpointAddress, remoteConfirmationWords, type DetectedEndpoint, type LocalEndpointPreset } from '@ogden-agents/shared';
import { MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/ui/button';
import { CheckboxOption } from '@/ui/checkbox';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Text } from '@/ui/typography';
import { addLocalEndpoint, detectLocalServers, useEndpointPresets } from './local-endpoints-api';

/**
 * Add a server to the Local model (epic 14 story 14.4; E14-R2): one-click
 * presets (their labels and addresses come from the server), Detect (the
 * server probes this computer's two usual ports, only when pressed), or any
 * OpenAI-compatible address with an optional key. The address is read as the
 * user types: a server on this computer says so and needs nothing more;
 * another host shows exactly where messages and project text will go, warns
 * about plain http, and needs the user's confirmation before it is added.
 * The browser contacts no server itself. The key is a write-only field: sent
 * once, cleared at once, never kept in the page.
 */
export function AddEndpoint({ onAdded }: { onAdded: () => void }) {
  const presets = useEndpointPresets();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [preset, setPreset] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [detected, setDetected] = useState<DetectedEndpoint[] | undefined>(undefined);
  const [detecting, setDetecting] = useState(false);

  const address = baseUrl.trim() === '' ? undefined : readEndpointAddress(baseUrl);
  const remote = address?.ok === true && !address.loopback ? address : undefined;
  const canAdd = !busy && label.trim() !== '' && address?.ok === true && (remote === undefined || confirmed);

  const choose = (item: { id: string; label: string; baseUrl: string }) => {
    setLabel(item.label);
    setBaseUrl(item.baseUrl);
    setPreset(item.id);
    setConfirmed(false);
    setError(undefined);
    setOpen(true);
  };

  const submit = async () => {
    if (!canAdd || address?.ok !== true) return;
    const secret = key;
    // Cleared at once, whatever the answer: the key never stays in the page.
    setKey('');
    setBusy(true);
    setError(undefined);
    try {
      await addLocalEndpoint({ label: label.trim(), baseUrl, ...(preset === null ? {} : { preset }), ...(secret.trim() === '' ? {} : { key: secret }), ...(remote === undefined ? {} : { confirmHost: remote.host }) });
      setOpen(false);
      setLabel('');
      setBaseUrl('');
      setPreset(null);
      setConfirmed(false);
      setDetected(undefined);
      onAdded();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That server couldn't be added.");
    } finally {
      setBusy(false);
    }
  };

  const detect = async () => {
    setDetecting(true);
    setError(undefined);
    try {
      setDetected(await detectLocalServers());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't look for servers.");
    } finally {
      setDetecting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submit();
  };

  return (
    <div className="flex flex-col gap-3" data-testid="endpoint-add">
      <div className="flex flex-wrap items-center gap-2">
        {(presets.data ?? []).map((item) => (
          <Button key={item.id} type="button" variant="outline" onClick={() => choose(item)} data-testid={`endpoint-preset-${item.id}`}>
            <Plus aria-hidden />
            Use {item.label}
          </Button>
        ))}
        <Button type="button" variant="outline" aria-disabled={detecting} onClick={detecting ? undefined : () => void detect()} data-testid="endpoint-detect">
          <MagnifyingGlass aria-hidden />
          {detecting ? 'Looking...' : 'Detect on this computer'}
        </Button>
        {open ? null : (
          <Button type="button" variant="ghost" onClick={() => setOpen(true)} data-testid="endpoint-add-other">
            <Plus aria-hidden />
            Add another server
          </Button>
        )}
      </div>
      <Text variant="caption">Detect looks only at this computer's usual server addresses, once, when you press it.</Text>
      {detected === undefined ? null : <DetectResult found={detected} presets={presets.data ?? []} onUse={choose} />}
      {open ? (
        <div className="flex flex-col gap-2" data-testid="endpoint-form">
          <Label htmlFor="endpoint-label">Name</Label>
          <Input id="endpoint-label" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={MAX_ENDPOINT_LABEL} onKeyDown={onKeyDown} />
          <Label htmlFor="endpoint-url">Server address</Label>
          <Input
            id="endpoint-url"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setPreset(null);
              setConfirmed(false);
            }}
            placeholder="http://localhost:1234/v1"
            spellCheck={false}
            autoCapitalize="none"
            onKeyDown={onKeyDown}
          />
          {address === undefined ? null : address.ok ? (
            address.loopback ? (
              <Text variant="caption" data-testid="endpoint-privacy">
                {LOOPBACK_PRIVACY_WORDS}
              </Text>
            ) : (
              <div className="flex flex-col gap-2" data-testid="endpoint-confirm">
                <Text variant="caption" data-testid="endpoint-privacy">
                  {remoteConfirmationWords(address.host, address.insecureRemote)}
                </Text>
                <CheckboxOption id="endpoint-confirm-box" label={`I understand that my messages and project text go to ${address.host}`} checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
              </div>
            )
          ) : (
            <Text variant="caption" role="alert" data-testid="endpoint-address-problem">
              {address.reason}
            </Text>
          )}
          <Label htmlFor="endpoint-key">Key (only if the server needs one)</Label>
          <Text variant="caption" id="endpoint-key-description">
            Kept in this computer's keychain. A server on this computer usually needs none.
          </Text>
          <Input
            id="endpoint-key"
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={onKeyDown}
            name="ogden-agents-endpoint-key"
            autoComplete="one-time-code"
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore=""
            data-form-type="other"
            spellCheck={false}
            maxLength={MAX_ENDPOINT_KEY}
            aria-describedby="endpoint-key-description"
          />
          <div className="flex gap-2">
            <Button type="button" aria-disabled={!canAdd} onClick={canAdd ? () => void submit() : undefined} data-testid="endpoint-add-submit">
              {busy ? 'Adding...' : 'Add server'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                // Nothing typed stays behind, the key least of all.
                setOpen(false);
                setKey('');
                setConfirmed(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="endpoint-form-error">
          {error}
        </Text>
      )}
    </div>
  );
}

/** What Detect found, or that it found nothing, with the official pages to get a server from. */
function DetectResult({ found, presets, onUse }: { found: DetectedEndpoint[]; presets: LocalEndpointPreset[]; onUse: (item: { id: string; label: string; baseUrl: string }) => void }) {
  if (found.length === 0) {
    return (
      <div className="flex flex-col gap-1" data-testid="endpoint-detect-none">
        <Text variant="body">No server found on this computer.</Text>
        <Text variant="caption">Install one, start its local server and load a model, then press Detect again. Ogden Agents never installs or starts one for you.</Text>
        <ul className="flex flex-col gap-1">
          {presets.map((item) => (
            <li key={item.id}>
              <a className="text-label underline" href={item.downloadUrl} target="_blank" rel="noreferrer noopener" data-testid={`endpoint-download-${item.id}`}>
                Get {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="endpoint-detect-found">
      {found.map((item) => (
        <li key={item.baseUrl} className="flex flex-wrap items-center gap-3">
          <Text variant="body">
            Found {item.label} on this computer
            {item.models === 0 ? ', running with no model loaded yet.' : `, with ${item.models} ${item.models === 1 ? 'model' : 'models'}.`}
          </Text>
          <Button type="button" variant="secondary" onClick={() => onUse({ id: item.presetId, label: item.label, baseUrl: item.baseUrl })}>
            Use it
          </Button>
        </li>
      ))}
    </ul>
  );
}
