import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { PageBody, PageSection } from '@/ui/page';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { AddMachineForm } from './add-machine-form';
import { HostKeyConfirmCard } from './host-key-confirm-card';
import { RemoteMachineRow } from './remote-machine-row';
import { REMOTE_MACHINES_QUERY_KEY, useRemoteMachines } from './remote-machines-api';

/**
 * Every machine added over SSH (CAP-24, epic 18 story 18.3). An
 * unconfirmed machine shows its blocking host-key confirmation; a
 * confirmed one is a one-line record with its public key available on
 * request. Removing a machine deletes its stored credential too. Split
 * out from its page so it can be rendered without `WorkspaceHeader`'s
 * providers in a component test, matching `LocalEndpointsSection`.
 */
export function RemoteMachinesSection() {
  const query = useRemoteMachines();
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: REMOTE_MACHINES_QUERY_KEY });

  return (
    <PageBody data-testid="remote-machines-settings-page">
      <PageSection aria-label="Remote machines" data-state={query.data === undefined ? (query.isError ? 'error' : 'loading') : 'ready'}>
        <Text variant="caption">
          Computers you&rsquo;ve given Ogden Agents SSH access to, for chats and builds that run there instead of here. Each needs nothing of Ogden Agents installed on it &mdash; only SSH reachability and one of the supported agent CLIs.
        </Text>
        {query.data === undefined ? (
          query.isError ? (
            <Notice
              variant="blocked"
              action={
                <Button variant="primary" onClick={() => void query.refetch()}>
                  Try again
                </Button>
              }
            >
              {query.error.message}
            </Notice>
          ) : (
            <>
              <Skeleton />
              <span role="status" className="sr-only">
                Reading your remote machines
              </span>
            </>
          )
        ) : query.data.length === 0 ? (
          <Text variant="caption" data-testid="remote-machines-empty">
            No machines added yet.
          </Text>
        ) : (
          query.data.map((machine) =>
            machine.hostKeyConfirmed ? (
              <RemoteMachineRow key={machine.id} machine={machine} onRemoved={refresh} />
            ) : (
              <HostKeyConfirmCard key={machine.id} machine={machine} onConfirmed={refresh} onRemoved={refresh} />
            ),
          )
        )}
      </PageSection>
      <AddMachineForm onAdded={refresh} />
    </PageBody>
  );
}
