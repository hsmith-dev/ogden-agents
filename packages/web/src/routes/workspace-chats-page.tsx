import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';

/**
 * `/w/:wsId`: the workspace's Chats list (story 2.5), the session list for
 * this project. Story 2.3 registers the route; 2.5 fills this file.
 */
export function WorkspaceChatsPage() {
  return (
    <>
      <WorkspaceHeader title="Chats" />
      <PageBody data-testid="workspace-chats-page" />
    </>
  );
}
