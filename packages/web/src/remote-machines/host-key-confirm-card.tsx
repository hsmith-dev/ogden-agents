import type { RemoteMachine } from '@ogden-agents/shared';
import { useEffect, useState } from 'react';
import { CodeBlock } from '@/ui/code-block';
import { Notice } from '@/ui/notice';
import { Button } from '@/ui/button';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { checkRemoteMachineHostKey, confirmRemoteMachineHostKey, removeRemoteMachine } from './remote-machines-api';

/**
 * A machine's blocking host-key confirmation (CAP-24, AD-26), modeled
 * structurally on `PermissionCard`/the Skip-all `AlertDialog`: shown once,
 * not confirmed by default (no button is focused), and collapsed by the
 * caller once `onConfirmed` fires. The fingerprint is read fresh every time
 * this card mounts (never cached stale), and the exact `authorized_keys`
 * line the user must add to the machine by hand is shown with a Copy
 * action, since Ogden cannot install it there itself (CAP-24's non-goals).
 * A host key that changed between showing and confirming, or a host that
 * cannot be reached, is shown in plain words; neither ever pins anything.
 */
export function HostKeyConfirmCard({ machine, onConfirmed, onRemoved }: { machine: RemoteMachine; onConfirmed: (machine: RemoteMachine) => void; onRemoved: () => void }) {
  const [fingerprint, setFingerprint] = useState<string | undefined>(undefined);
  const [checking, setChecking] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setError(undefined);
    checkRemoteMachineHostKey(machine.id).then(
      (check) => {
        if (!cancelled) {
          setFingerprint(check.fingerprint);
          setChecking(false);
        }
      },
      (failure: unknown) => {
        if (!cancelled) {
          setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't reach that machine.");
          setChecking(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [machine.id]);

  const confirm = () => {
    if (fingerprint === undefined || confirming) return;
    setConfirming(true);
    setError(undefined);
    confirmRemoteMachineHostKey(machine.id, fingerprint).then(onConfirmed, (failure: unknown) => {
      setConfirming(false);
      setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't confirm that host key.");
    });
  };

  const remove = () => {
    if (removing) return;
    setRemoving(true);
    removeRemoteMachine(machine.id).then(onRemoved, (failure: unknown) => {
      setRemoving(false);
      setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't remove that machine.");
    });
  };

  const busy = confirming || removing;

  return (
    <div data-testid="host-key-confirm-card" data-machine-id={machine.id} className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div>
        <Text variant="label">{machine.label}</Text>
        <Text variant="caption">
          {machine.username}@{machine.host}:{machine.port} is not confirmed yet. It cannot be used for a chat or a build until you confirm its host key below.
        </Text>
      </div>

      {checking ? (
        <>
          <Skeleton />
          <span role="status" className="sr-only">
            Reading {machine.host}&rsquo;s host key
          </span>
        </>
      ) : fingerprint === undefined ? null : (
        <div className="flex flex-col gap-2">
          <Text variant="caption" id={`host-key-fingerprint-${machine.id}`}>
            This machine&rsquo;s host key fingerprint (SHA-256):
          </Text>
          <CodeBlock text={fingerprint} language={undefined} />
          <Text variant="caption">
            Only confirm this if you trust it is really {machine.host}&rsquo;s key &mdash; for example, because you compared it over a channel other than this network.
          </Text>
        </div>
      )}

      <Text variant="caption">Confirming generates a new key for this machine. You&rsquo;ll then add its public half to {machine.host}&rsquo;s authorized_keys file by hand (shown right after, and any time after that in the machine list below).</Text>

      <div className="flex items-center gap-2" data-testid="host-key-confirm-actions">
        <Button variant="primary" disabled={fingerprint === undefined || busy} data-testid="host-key-confirm-button" onClick={confirm} autoFocus={false}>
          {confirming ? 'Confirming…' : 'Confirm host key'}
        </Button>
        <Button variant="ghost" disabled={busy} data-testid="host-key-confirm-remove" onClick={remove} autoFocus={false}>
          {removing ? 'Removing…' : 'Remove'}
        </Button>
      </div>

      {error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="host-key-confirm-error">
          {error}
        </Notice>
      )}
    </div>
  );
}
