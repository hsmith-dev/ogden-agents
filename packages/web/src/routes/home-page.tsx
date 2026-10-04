import { FolderPlus, Plus } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useOnboarding } from '@/onboarding/onboarding-api';
import { redirectsToWelcome } from '@/onboarding/welcome-model';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { EmptyState, PageBody } from '@/ui/page';
import { Skeleton } from '@/ui/skeleton';
import { AddProjectDialog } from '@/workspaces/add-project-dialog';

/**
 * `/`: the workspace area with no workspace open (EXPERIENCE.md State
 * Patterns: No workspaces). Add project opens the folder browser; Start a
 * new project folder opens it with the cursor in the new folder's name.
 * A first run (Welcome not done, 9.5) goes on to `/welcome` instead; until
 * onboarding is known the body is a skeleton, so Projects never flashes
 * before that redirect. If onboarding can't be read, Projects shows.
 */
export function HomePage() {
  const [adding, setAdding] = useState<'pick' | 'new' | undefined>(undefined);
  const onboarding = useOnboarding();
  const navigate = useNavigate();
  const firstRun = redirectsToWelcome(onboarding.data);
  useEffect(() => {
    if (firstRun) void navigate({ to: '/welcome', replace: true });
  }, [firstRun, navigate]);
  if (onboarding.isPending || firstRun) {
    return (
      <>
        <WorkspaceHeader title="Projects" />
        <PageBody>
          <Skeleton />
          <span role="status" className="sr-only">
            Loading
          </span>
        </PageBody>
      </>
    );
  }
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
              <Button onClick={() => setAdding('pick')}>
                <Plus aria-hidden />
                Add project
              </Button>
              <Button variant="outline" onClick={() => setAdding('new')}>
                <FolderPlus aria-hidden />
                Start a new project folder
              </Button>
            </>
          }
        />
        <AddProjectDialog open={adding !== undefined} startNew={adding === 'new'} onOpenChange={(open) => setAdding(open ? adding : undefined)} />
      </PageBody>
    </>
  );
}
