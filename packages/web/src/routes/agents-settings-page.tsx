import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';

/**
 * `/settings/agents`: installed agents, sign-in state, API keys, install
 * more (onboarding 9.1; CAP-15, CAP-16). Story 2.3 registers the route; 9.1
 * fills this file.
 */
export function AgentsSettingsPage() {
  return (
    <>
      <WorkspaceHeader title="Agents" />
      <PageBody data-testid="agents-settings-page" />
    </>
  );
}
