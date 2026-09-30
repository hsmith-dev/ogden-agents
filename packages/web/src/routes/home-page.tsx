import { FolderPlus, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { StartChatForm } from '@/chat/start-chat-form';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { EmptyState, PageBody } from '@/ui/page';
import { AddProjectDialog } from '@/workspaces/add-project-dialog';

/**
 * `/`: the workspace area with no workspace open (EXPERIENCE.md State
 * Patterns: No workspaces). Add project opens the folder browser; Start a
 * new project folder opens it with the cursor in the new folder's name. The
 * typed-path form stays until story 2.12's sweep.
 */
export function HomePage() {
  const [adding, setAdding] = useState<'pick' | 'new' | undefined>(undefined);
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
        <StartChatForm />
      </PageBody>
    </>
  );
}
