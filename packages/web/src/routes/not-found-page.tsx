import { House } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { EmptyState, PageBody } from '@/ui/page';

/** Any URL the app doesn't know, inside the shell. */
export function NotFoundPage() {
  return (
    <>
      <WorkspaceHeader title="Page not found" />
      <PageBody>
        <EmptyState
          data-testid="not-found"
          title="There's nothing at this address."
          description="The link may be old, or the page may have moved. Your projects are still where you left them."
          actions={
            <Button asChild variant="outline">
              <Link to="/">
                <House aria-hidden />
                Go to projects
              </Link>
            </Button>
          }
        />
      </PageBody>
    </>
  );
}
