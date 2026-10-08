import { MAX_MACHINE_HOST, MAX_MACHINE_LABEL, MAX_MACHINE_USERNAME, type RemoteMachine } from '@ogden-agents/shared';
import { Plus } from '@phosphor-icons/react';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Notice } from '@/ui/notice';
import { Text } from '@/ui/typography';
import { addRemoteMachine } from './remote-machines-api';

/**
 * Add a remote machine (CAP-24, epic 19 story 19.3): host, port (22 unless
 * changed), username and a display name. Adding it only creates the
 * record; it is unusable until its host key is confirmed (the card that
 * appears for it once added, below).
 */
export function AddMachineForm({ onAdded }: { onAdded: (machine: RemoteMachine) => void }) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const portNumber = Number.parseInt(port, 10);
  const canAdd = !busy && host.trim() !== '' && username.trim() !== '' && label.trim() !== '' && Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;

  const submit = async () => {
    if (!canAdd) return;
    setBusy(true);
    setError(undefined);
    try {
      const machine = await addRemoteMachine({ host: host.trim(), port: portNumber, username: username.trim(), label: label.trim() });
      setOpen(false);
      setHost('');
      setPort('22');
      setUsername('');
      setLabel('');
      onAdded(machine);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That machine couldn't be added.");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submit();
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)} data-testid="remote-machine-add-other">
        <Plus aria-hidden />
        Add a machine
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="remote-machine-form">
      <Label htmlFor="remote-machine-label">Name</Label>
      <Input id="remote-machine-label" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={MAX_MACHINE_LABEL} onKeyDown={onKeyDown} />
      <Label htmlFor="remote-machine-host">Host name or IP address</Label>
      <Input id="remote-machine-host" value={host} onChange={(event) => setHost(event.target.value)} maxLength={MAX_MACHINE_HOST} placeholder="192.168.1.20" spellCheck={false} autoCapitalize="none" onKeyDown={onKeyDown} />
      <Label htmlFor="remote-machine-port">Port</Label>
      <Input id="remote-machine-port" value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" onKeyDown={onKeyDown} />
      <Label htmlFor="remote-machine-username">Username</Label>
      <Input id="remote-machine-username" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={MAX_MACHINE_USERNAME} spellCheck={false} autoCapitalize="none" onKeyDown={onKeyDown} />
      <Text variant="caption">
        Ogden Agents needs SSH access to this machine, with one of the supported agent CLIs already installed there &mdash; it installs nothing on it itself. After adding it, you&rsquo;ll confirm its host key and add a generated public key to its authorized_keys file by hand.
      </Text>
      <div className="flex items-center gap-2">
        <Button type="button" variant="primary" disabled={!canAdd} onClick={() => void submit()} data-testid="remote-machine-submit">
          {busy ? 'Adding…' : 'Add machine'}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="remote-machine-form-error">
          {error}
        </Notice>
      )}
    </div>
  );
}
