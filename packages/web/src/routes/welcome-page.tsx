import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';

/**
 * `/welcome`: the first-run Welcome (onboarding 9.5): pick an agent,
 * install it, sign in or paste an API key, add a first project. Story 2.3
 * registers the route; 9.5 fills this file.
 */
export function WelcomePage() {
  return (
    <>
      <WorkspaceHeader title="Welcome" />
      <PageBody data-testid="welcome-page" />
    </>
  );
}
