import { AddToolSection } from '@/dev-tools/add-tool-section';
import { DevToolRow } from '@/dev-tools/dev-tool-row';
import { useDevTools } from '@/dev-tools/dev-tools-api';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { PageBody, PageSection } from '@/ui/page';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';

/**
 * `/settings/dev-tools` (CAP-25, story: generic developer CLI tools detect,
 * install, and sandbox-gate; AC1-3): each tool Ogden knows about (a small
 * seed list, plus any the user named) shows its real installed state, found
 * on PATH or at a known default install location for this OS, never by
 * running it. Install (`@/dev-tools/dev-tool-row`) shows the tool's exact
 * official command and runs it for real only on confirmation, with no
 * terminal anywhere on this page. A declined confirmation or a failed
 * install leaves the tool shown as not installed with a plain reason.
 */
export function DevToolsSettingsPage() {
  const query = useDevTools();
  return (
    <>
      <WorkspaceHeader title="Developer tools" />
      <PageBody data-testid="dev-tools-settings-page">
        <PageSection aria-label="Developer tools" data-state={query.data === undefined ? (query.isError ? 'error' : 'loading') : 'ready'}>
          <Text variant="caption">
            Common developer command-line tools, found on this computer or installed from here. A project's own settings decide, separately, whether an unattended build may use one.
          </Text>
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
                  Checking your developer tools
                </span>
              </>
            )
          ) : (
            query.data.map((tool) => <DevToolRow key={tool.id} tool={tool} />)
          )}
        </PageSection>
        <AddToolSection />
      </PageBody>
    </>
  );
}
