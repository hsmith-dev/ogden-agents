import { PROBLEMS_HIDE_OUTPUT_LABEL, PROBLEMS_SHOW_OUTPUT_LABEL, WORKTREE_SETUP_OUTPUT_TITLE, worktreePortText, worktreePortTooltip, worktreeSetupStateText, type WorktreeSetupRun } from '@ogden-agents/shared';
import { useState } from 'react';
import { useSessionLocation } from '@/chat/chat-api';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { Text } from '@/ui/typography';
import { useProjectCommandRun } from '@/workbench/problems-api';

/**
 * Beside a worktree chat's branch badge (27.7): its copy's own port ("Port
 * 41000", the tooltip saying the copy runs there) and, once the project's
 * setup command ran in the copy, its state with Show output (the run's
 * masked output, read only while shown).
 */
export function WorktreeCopyStatusView({
  port,
  setup,
  output,
  open,
  onOpenChange,
}: {
  port: number | null;
  setup: WorktreeSetupRun | null;
  /** The setup run's masked output while it is shown; `undefined` while it loads. */
  output: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (port === null && setup === null) return null;
  return (
    <span className="flex min-w-0 shrink items-center gap-2" data-testid="worktree-copy-status">
      {port === null ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" tabIndex={0} className="font-mono text-mono-compact" data-testid="worktree-port" data-port={port}>
              {worktreePortText(port)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent data-testid="worktree-port-hint">{worktreePortTooltip(port)}</TooltipContent>
        </Tooltip>
      )}
      {setup === null ? null : (
        <Popover open={open} onOpenChange={onOpenChange}>
          <span className="flex min-w-0 items-center gap-1">
            <Text as="span" variant="caption" role="status" className="min-w-0 truncate max-sm:sr-only" data-testid="worktree-setup" data-state={setup.state}>
              {worktreeSetupStateText(setup.state)}
            </Text>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" data-testid="worktree-setup-output" aria-label={`${open ? PROBLEMS_HIDE_OUTPUT_LABEL : PROBLEMS_SHOW_OUTPUT_LABEL}: ${worktreeSetupStateText(setup.state)}`}>
                {open ? PROBLEMS_HIDE_OUTPUT_LABEL : PROBLEMS_SHOW_OUTPUT_LABEL}
              </Button>
            </PopoverTrigger>
          </span>
          <PopoverContent align="end" data-testid="worktree-setup-panel">
            <Text as="span" variant="label">
              {WORKTREE_SETUP_OUTPUT_TITLE}
            </Text>
            {output === undefined ? (
              <Text variant="caption">Loading...</Text>
            ) : (
              <pre
                tabIndex={0}
                role="group"
                aria-label={WORKTREE_SETUP_OUTPUT_TITLE}
                className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-mono-compact"
                data-testid="worktree-setup-text"
              >
                {output === '' ? 'No output.' : output}
              </pre>
            )}
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

/** The chat's copy port and setup state, from its Location (followed through the event log). */
export function WorktreeCopyStatus({ wsId, sesId }: { wsId: string; sesId: string }) {
  const location = useSessionLocation(wsId, sesId);
  const [open, setOpen] = useState(false);
  const worktree = location.data?.kind === 'worktree' ? location.data : undefined;
  const run = useProjectCommandRun(wsId, worktree?.setup?.runId, open);
  if (worktree === undefined || worktree.putAway) return null;
  return <WorktreeCopyStatusView port={worktree.port} setup={worktree.setup} output={run.data?.output} open={open} onOpenChange={setOpen} />;
}
