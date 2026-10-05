import {
  ATTENDED_EXPLAINED_TEXT,
  BUILD_DIALOG_LOAD_FAILED,
  BUILD_DIALOG_READY_TEXT,
  BUILD_DIALOG_TITLE,
  DOCKER_INSTALL_URL,
  DOCKER_READY_BUT_UNSUPPORTED_TEXT,
  NO_INSTALL_FOR_YOU_TEXT,
  OTHER_AGENT_DISABLED_TEXT,
  SANDBOX_CHOICE_LABELS,
  SANDBOX_CHOICES,
  type SandboxChoice,
  type SandboxProbe,
  type SandboxStatus,
} from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { Notice } from '@/ui/notice';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { fetchBuildSandbox, startBuild } from './builds-api';

/**
 * The Build dialog (story 5.6; EXPERIENCE.md Build actions, Sandbox
 * unavailable): opened when a Build is refused `sandbox_unavailable`. It
 * says in plain words what this computer can use, what to install if
 * something is missing (text only; Ogden Agents installs nothing), and
 * offers three choices in the order the server gives them: **Use another
 * agent** (disabled until epic 6), **Install Docker** (a link you open
 * yourself) and **Build with me watching** (an attended build: every command
 * asks you first). On Windows the server puts building with you watching
 * first, and focus lands on the first choice you can use.
 */
export interface BuildDialogProps {
  wsId: string;
  /** The ticket the Build was for. */
  ticketRef: string;
  onClose: () => void;
  /** The attended build started: its session. */
  onStarted: (sessionId: string) => void;
}

/** What each probe found, one plain line (a usable sandbox needs no line: the dialog would not be open). */
function ProbeList({ probes }: { probes: readonly SandboxProbe[] }) {
  const shown = probes.filter((probe) => probe.state !== 'usable');
  if (shown.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="build-dialog-probes">
      {shown.map((probe) => (
        <li key={probe.kind} data-kind={probe.kind} data-state={probe.state} className="text-caption break-words text-muted-foreground">
          {probe.note}
        </li>
      ))}
    </ul>
  );
}

export function BuildDialog({ wsId, ticketRef, onClose, onStarted }: BuildDialogProps) {
  const sandbox = useQuery({ queryKey: ['build-sandbox', wsId], queryFn: () => fetchBuildSandbox(wsId), retry: false, staleTime: 0, gcTime: 0 });
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const status: SandboxStatus | undefined = sandbox.data;
  // Until the server answers (or when it cannot), the entry's own order; a failed read never blocks building with you watching.
  const ready = status?.available === true;
  const choices: readonly SandboxChoice[] = ready ? [] : status === undefined || status.choices.length === 0 ? SANDBOX_CHOICES : status.choices;
  const dockerReady = status?.probes.some((probe) => probe.kind === 'docker' && probe.state === 'detected') === true;

  const buildAttended = () => {
    if (starting) return;
    setStarting(true);
    setFailure(undefined);
    startBuild(wsId, ticketRef, 'attended').then(
      ({ session }) => {
        setStarting(false);
        onStarted(session.id);
        onClose();
      },
      (error: unknown) => {
        setStarting(false);
        setFailure(error instanceof Error ? error.message : String(error));
      },
    );
  };

  const choice = (id: SandboxChoice) => {
    const label = SANDBOX_CHOICE_LABELS[id];
    if (id === 'other_agent') {
      return (
        <li key={id} className="flex flex-col gap-1" data-testid="build-dialog-choice" data-choice={id}>
          <Button type="button" variant="outline" disabled data-testid="build-dialog-other-agent">
            {label}
          </Button>
          <Text variant="caption">{OTHER_AGENT_DISABLED_TEXT}</Text>
        </li>
      );
    }
    if (id === 'install_docker') {
      return (
        <li key={id} className="flex flex-col gap-1" data-testid="build-dialog-choice" data-choice={id}>
          {dockerReady ? (
            <>
              <Button type="button" variant="outline" disabled data-testid="build-dialog-install-docker">
                {label}
              </Button>
              <Text variant="caption">{DOCKER_READY_BUT_UNSUPPORTED_TEXT}</Text>
            </>
          ) : (
            <>
              <Button asChild variant="outline">
                <a href={DOCKER_INSTALL_URL} target="_blank" rel="noopener noreferrer" data-testid="build-dialog-install-docker">
                  {label}
                </a>
              </Button>
              <Text variant="caption">{NO_INSTALL_FOR_YOU_TEXT}</Text>
            </>
          )}
        </li>
      );
    }
    return (
      <li key={id} className="flex flex-col gap-1" data-testid="build-dialog-choice" data-choice={id}>
        <Button type="button" variant="primary" aria-disabled={starting || undefined} onClick={buildAttended} data-testid="build-dialog-attended">
          {label}
        </Button>
        <Text variant="caption">{ATTENDED_EXPLAINED_TEXT}</Text>
      </li>
    );
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent title={BUILD_DIALOG_TITLE} description={`Building ${ticketRef}.`} data-testid="build-dialog">
        {sandbox.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : status === undefined ? (
          <Notice variant="blocked" role="alert" data-testid="build-dialog-load-error">
            {BUILD_DIALOG_LOAD_FAILED}
          </Notice>
        ) : (
          <div className="flex flex-col gap-2" data-testid="build-dialog-status" data-available={status.available ? 'true' : 'false'}>
            <Text variant="body" data-testid="build-dialog-summary">
              {status.summary}
            </Text>
            <ProbeList probes={status.probes} />
            {status.installHint === null ? null : (
              <Text variant="caption" data-testid="build-dialog-install-hint">
                {status.installHint}
              </Text>
            )}
          </div>
        )}
        {failure === undefined ? null : (
          <Notice variant="blocked" role="alert" data-testid="build-dialog-error">
            {failure}
          </Notice>
        )}
        {ready ? <Text variant="body" data-testid="build-dialog-ready">{BUILD_DIALOG_READY_TEXT}</Text> : null}
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Choices" data-testid="build-dialog-choices">
          {choices.map(choice)}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
