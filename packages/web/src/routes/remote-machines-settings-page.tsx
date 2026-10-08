import { RemoteMachinesSection } from '@/remote-machines/remote-machines-section';
import { WorkspaceHeader } from '@/shell/workspace-header';

/**
 * `/settings/remote-machines` (CAP-24, epic 18 story 18.3): every machine
 * added over SSH.
 */
export function RemoteMachinesSettingsPage() {
  return (
    <>
      <WorkspaceHeader title="Remote machines" />
      <RemoteMachinesSection />
    </>
  );
}
