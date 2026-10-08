import type { RemoteMachine } from '@ogden-agents/shared';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { CodeBlock } from '@/ui/code-block';
import { Notice } from '@/ui/notice';
import { Text } from '@/ui/typography';
import { removeRemoteMachine } from './remote-machines-api';

/**
 * A confirmed machine, one line, with its public key available any time
 * (not only right after confirming) in case the user hasn't added it to
 * the machine's `authorized_keys` yet, or needs it again. Mirrors the
 * agent card's "saved … Remove key" pattern: Remove acts at once, with
 * no further confirmation dialog.
 */
export function RemoteMachineRow({ machine, onRemoved }: { machine: RemoteMachine; onRemoved: () => void }) {
  const [showKey, setShowKey] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const remove = () => {
    if (removing) return;
    setRemoving(true);
    setError(undefined);
    removeRemoteMachine(machine.id).then(onRemoved, (failure: unknown) => {
      setRemoving(false);
      setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't remove that machine.");
    });
  };

  return (
    <div data-testid="remote-machine-row" data-machine-id={machine.id} className="flex flex-col gap-2 rounded-md border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Text variant="label">{machine.label}</Text>
          <Text variant="caption">
            {machine.username}@{machine.host}:{machine.port} &middot; Confirmed
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" data-testid="remote-machine-show-key" onClick={() => setShowKey((value) => !value)}>
            {showKey ? 'Hide public key' : 'Show public key'}
          </Button>
          <Button variant="ghost" size="sm" disabled={removing} data-testid="remote-machine-remove" onClick={remove}>
            {removing ? 'Removing…' : 'Remove'}
          </Button>
        </div>
      </div>
      {showKey && machine.publicKey !== null ? (
        <div className="flex flex-col gap-2">
          <Text variant="caption">This machine&rsquo;s public key, for its authorized_keys file:</Text>
          <CodeBlock text={machine.publicKey} language={undefined} />
        </div>
      ) : null}
      {error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="remote-machine-error">
          {error}
        </Notice>
      )}
    </div>
  );
}
