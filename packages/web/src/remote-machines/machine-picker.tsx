import { UNATTENDED_REMOTE_MESSAGE, type RemoteMachineId } from '@ogden-agents/shared';
import { CaretDown, Desktop } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuChoiceItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MACHINE_HOST_KEY_CHANGED_REASON, MACHINE_UNREACHABLE_REASON, useMachineChecks } from './machine-checks';
import { useRemoteMachines } from './remote-machines-api';

/** The local-computer choice (CAP-24, epic 19 story 19.7): every chat and attended build defaults to it. */
export const LOCAL_MACHINE_LABEL = 'Local';

export { MACHINE_HOST_KEY_CHANGED_REASON, MACHINE_UNREACHABLE_REASON } from './machine-checks';

/**
 * The machine a chat or an attended build runs on (CAP-24, epic 19 story
 * 19.7), modeled on `AgentPicker`'s own unavailable-but-focusable pattern:
 * Local, plus every *confirmed* machine from {@link useRemoteMachines}. A
 * machine whose live host key (probed once when the menu opens, cached
 * briefly) disagrees with its pinned fingerprint, or can't be reached at
 * all, is shown unavailable with a plain reason, unselectable by mouse but
 * still reachable by keyboard so a screen reader reads why (same pattern as
 * an unavailable agent). With no confirmed machine at all there is nothing
 * to choose beside Local, so the picker renders nothing (mirrors
 * `AgentPicker`'s own single-choice hide).
 */
export function MachinePicker({
  value,
  onChange,
  unattendedMode = false,
}: {
  value: RemoteMachineId | null;
  onChange: (machineId: RemoteMachineId | null) => void;
  /**
   * True inside the Build dialog once `mode === 'unattended'` (19.6's own
   * scope decision): every remote machine is shown unavailable with
   * `UNATTENDED_REMOTE_MESSAGE`'s exact text, no live check needed -- the
   * refusal is universal, not a fact about any one machine.
   */
  unattendedMode?: boolean;
}) {
  const machines = useRemoteMachines();
  const confirmed = (machines.data ?? []).filter((machine) => machine.hostKeyConfirmed);
  const [open, setOpen] = useState(false);
  const checks = useMachineChecks(open, confirmed, !unattendedMode);

  if (confirmed.length === 0) return null;

  const current = value === null ? undefined : confirmed.find((machine) => machine.id === value);
  const name = value === null ? LOCAL_MACHINE_LABEL : current?.label ?? 'Choose a machine';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" data-testid="machine-picker" data-machine={value ?? 'local-machine'} aria-label={`Run on: ${name}`}>
          <Desktop aria-hidden />
          {name}
          <CaretDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="machine-menu">
        <DropdownMenuLabel>Run on</DropdownMenuLabel>
        <DropdownMenuChoiceItem
          data-testid="machine-option"
          data-machine="local-machine"
          checked={value === null}
          label={LOCAL_MACHINE_LABEL}
          description="This computer."
          onSelect={() => onChange(null)}
        />
        {confirmed.map((machine) => {
          const state = checks[machine.id]?.state;
          const reason = unattendedMode ? UNATTENDED_REMOTE_MESSAGE : state === 'unreachable' ? MACHINE_UNREACHABLE_REASON : state === 'host_key_changed' ? MACHINE_HOST_KEY_CHANGED_REASON : undefined;
          const unavailable = reason !== undefined;
          return (
            <DropdownMenuChoiceItem
              key={machine.id}
              data-testid="machine-option"
              data-machine={machine.id}
              checked={machine.id === value}
              // Unavailable but focusable: the keyboard and a screen reader still reach its reason.
              aria-disabled={unavailable || undefined}
              data-disabled={unavailable ? '' : undefined}
              label={machine.label}
              description={reason ?? `${machine.username}@${machine.host}`}
              onSelect={(event) => {
                if (unavailable) {
                  event.preventDefault();
                  return;
                }
                onChange(machine.id);
              }}
            />
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
