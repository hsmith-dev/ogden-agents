import { GlobalSkillsSection } from '@/chat/global-skills-section';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody, PageSection } from '@/ui/page';
import { GlobalMcpServersSection } from '@/chat/global-mcp-servers-section';

export function McpSettingsPage() {
  return (
    <>
      <WorkspaceHeader title="Shared tools and skills" />
      <PageBody data-testid="mcp-settings-page">
        <PageSection>
          <GlobalMcpServersSection />
        </PageSection>
        <PageSection><GlobalSkillsSection /></PageSection>
      </PageBody>
    </>
  );
}
