import { useParams } from '@tanstack/react-router';
import { useAppearance } from '@/appearance/appearance-provider';
import { TerminalsView } from '@/terminal/terminals-view';
import { WorkspaceHeader } from '@/shell/workspace-header';

/**
 * `/w/:wsId/terminals`: the project's terminal panes (epic 16, story 16.2),
 * for Developer mode. Without it the page says so in one sentence and asks
 * the server for nothing; the server refuses every pane request without it
 * all the same (E16-R3).
 */
export function WorkspaceTerminalsPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  const { appearance } = useAppearance();
  return (
    <>
      <WorkspaceHeader title="Terminals" wsId={wsId} tab="terminals" />
      <TerminalsView wsId={wsId} developerMode={appearance.developerMode} screenReaderMode={appearance.terminalScreenReader} />
    </>
  );
}
