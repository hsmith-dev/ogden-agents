import { AgentCard } from '@/agents/agent-card';
import { useAgents } from '@/agents/agent-setup-api';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { PageBody, PageSection } from '@/ui/page';
import { Skeleton } from '@/ui/skeleton';

/**
 * `/settings/agents`: each supported agent, whether it is installed and
 * signed in, signing in with the user's own account (onboarding 9.1), an API
 * key kept in the keychain (9.2) and installing (9.3); CAP-15, CAP-16. The
 * cards follow `agent.auth_changed` through the event log.
 */
export function AgentsSettingsPage() {
  const query = useAgents();
  return (
    <>
      <WorkspaceHeader title="Agents" />
      <PageBody data-testid="agents-settings-page">
        <PageSection aria-label="Agents" data-state={query.data === undefined ? (query.isError ? 'error' : 'loading') : 'ready'}>
          {query.data === undefined ? (
            query.isError ? (
              <Notice
                variant="blocked"
                action={
                  <Button variant="primary" onClick={() => void query.refetch()}>
                    Try again
                  </Button>
                }
              >
                {query.error.message}
              </Notice>
            ) : (
              <>
                <Skeleton />
                <span role="status" className="sr-only">
                  Checking your agents
                </span>
              </>
            )
          ) : (
            query.data.map((agent) => <AgentCard key={agent.agentId} agent={agent} />)
          )}
        </PageSection>
      </PageBody>
    </>
  );
}
