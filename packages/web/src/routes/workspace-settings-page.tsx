import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';

/**
 * `/w/:wsId/settings`: the workspace's settings (story 2.5, then the
 * caution level in 2.8): caution level, history deletion, and later the
 * default agent and BMad Method setup. Story 2.3 registers the route; 2.5
 * and 2.8 fill this file.
 */
export function WorkspaceSettingsPage() {
  return (
    <>
      <WorkspaceHeader title="Workspace settings" />
      <PageBody data-testid="workspace-settings-page" />
    </>
  );
}
