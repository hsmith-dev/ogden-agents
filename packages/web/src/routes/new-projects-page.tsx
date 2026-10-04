import { NEW_PROJECTS_SETTINGS_LABEL } from '@ogden-agents/shared';
import { NewProjectDefaultsSection, NewProjectsAgentSection } from '@/settings/new-project-defaults';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';

/** `/settings/new-projects` (story 10.4): the app-wide default new projects start with. */
export function NewProjectsPage() {
  return (
    <>
      <WorkspaceHeader title={NEW_PROJECTS_SETTINGS_LABEL} />
      <PageBody data-testid="new-projects-page">
        <NewProjectDefaultsSection />
        <NewProjectsAgentSection />
      </PageBody>
    </>
  );
}
