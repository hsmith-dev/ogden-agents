import { TRACKERS_SETTINGS_TITLE } from '@ogden-agents/shared';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { TrackersSection } from '@/trackers/trackers-section';

/** `/settings/trackers` (CAP-35, epic 27): the GitHub and Linear accounts a chat can start from. */
export function TrackersSettingsPage() {
  return (
    <>
      <WorkspaceHeader title={TRACKERS_SETTINGS_TITLE} />
      <TrackersSection />
    </>
  );
}
