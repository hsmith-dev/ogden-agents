import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { PageBody, PageSection } from '@/ui/page';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { useWorkspaces, workspaceName } from '@/workspaces/workspace-api';
import { AlwaysAllowRulesSection, NO_RULES_TEXT, RULES_EXPLAINED } from './workspace-settings-page';

/**
 * `/settings/always-allow` (epic 26 story 8, AD-40; EXPERIENCE.md Always
 * allow rules): in Settings, Projects, every project's Always allow rules,
 * each in its words ("Commands starting with `npm test`") with Remove. The
 * same list as each project's own settings, which keep theirs.
 */
export function AlwaysAllowSettingsPage() {
  const workspaces = useWorkspaces();
  return (
    <>
      <WorkspaceHeader title="Always allow rules" />
      <PageBody data-testid="always-allow-settings-page">
        <PageSection aria-label="Always allow rules">
          <Text>{RULES_EXPLAINED}</Text>
          {workspaces.data === undefined ? (
            workspaces.isError ? (
              <Notice
                variant="blocked"
                action={
                  <Button variant="primary" onClick={() => void workspaces.refetch()}>
                    Try again
                  </Button>
                }
              >
                {workspaces.error.message}
              </Notice>
            ) : (
              <>
                <Skeleton />
                <span role="status" className="sr-only">
                  Loading your projects
                </span>
              </>
            )
          ) : workspaces.data.length === 0 ? (
            <Text variant="caption" data-testid="rules-empty">
              {NO_RULES_TEXT}
            </Text>
          ) : null}
        </PageSection>
        {workspaces.data?.map((workspace) => (
          <AlwaysAllowRulesSection key={workspace.id} wsId={workspace.id} name={workspaceName(workspace)} title={workspaceName(workspace)} explained={false} />
        ))}
      </PageBody>
    </>
  );
}
