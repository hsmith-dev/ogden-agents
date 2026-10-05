import { InstallBuildLimits } from '@/planning/build-limit-fields';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';

/** `/settings/builds` (story 5.8): how many builds run at once in the install and the time limit of one. */
export function BuildsSettingsPage() {
  return (
    <>
      <WorkspaceHeader title="Builds" />
      <PageBody data-testid="builds-settings-page">
        <InstallBuildLimits />
      </PageBody>
    </>
  );
}
