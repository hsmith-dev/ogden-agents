import { FolderPlus, Plus } from '@phosphor-icons/react';
import { ADD_PROJECT_UNAVAILABLE } from '@/shell/status-sidebar';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { EmptyState, PageBody } from '@/ui/page';

/**
 * `/`: the workspace area with no workspaces (EXPERIENCE.md State Patterns:
 * No workspaces). Both actions arrive with epic 2.
 */
export function HomePage() {
  return (
    <>
      <WorkspaceHeader title="Projects" />
      <PageBody>
        <EmptyState
          data-testid="workspace-empty"
          title="Add a project to get started."
          description="A project is a folder on this computer. Your agents plan and build inside it, and every conversation stays with its project."
          actions={
            <>
              <Button aria-disabled aria-describedby="home-add-unavailable" onClick={(event) => event.preventDefault()}>
                <Plus aria-hidden />
                Add project
              </Button>
              <Button variant="outline" aria-disabled aria-describedby="home-add-unavailable" onClick={(event) => event.preventDefault()}>
                <FolderPlus aria-hidden />
                Start a new project folder
              </Button>
            </>
          }
          footnote={<span id="home-add-unavailable">{ADD_PROJECT_UNAVAILABLE}</span>}
        />
      </PageBody>
    </>
  );
}
