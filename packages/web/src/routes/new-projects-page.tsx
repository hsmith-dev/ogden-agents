import { NEW_PROJECTS_SETTINGS_LABEL } from '@ogden-agents/shared';
import { DefaultRoster } from '@/orchestrate/roster-editor';
import { NewProjectDefaultsSection, NewProjectsAgentSection, NewProjectsPermissionModeSection } from '@/settings/new-project-defaults';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody, PageSection } from '@/ui/page';
import { Text } from '@/ui/typography';

/** `/settings/new-projects` (story 10.4): the app-wide default new projects start with. */
export function NewProjectsPage() {
  return (
    <>
      <WorkspaceHeader title={NEW_PROJECTS_SETTINGS_LABEL} />
      <PageBody data-testid="new-projects-page">
        <NewProjectDefaultsSection />
        <NewProjectsAgentSection />
        <NewProjectsPermissionModeSection />
        <PageSection title="Team for new projects" data-testid="new-projects-team">
          <Text>For projects that use Orchestration. A project you add later starts with this team, and you can change it in that project. Projects you already have keep their own team. A role left on the default uses the first agent or model that is ready.</Text>
          <DefaultRoster />
        </PageSection>
      </PageBody>
    </>
  );
}
