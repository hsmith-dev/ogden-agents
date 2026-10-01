import type { Workspace } from '@ogden-agents/shared';
import { ArrowRight, FolderPlus, Plus } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AgentCard } from '@/agents/agent-card';
import { useAgents } from '@/agents/agent-setup-api';
import { shortcutLocation, useAppShortcut, useAppShortcutActions } from '@/appearance/app-shortcut-api';
import { useCompleteWelcome } from '@/onboarding/onboarding-api';
import { advancesOnReady, agentReady, exitTarget, selectedAgent, stepAfterProject, type WelcomeStep } from '@/onboarding/welcome-model';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { PageBody } from '@/ui/page';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { AddProjectDialog } from '@/workspaces/add-project-dialog';

/**
 * `/welcome`: the first-run Welcome (onboarding 9.5; EXPERIENCE.md Key Flow
 * 1): pick the agent (install it, sign in or use an API key, through the same
 * card and hooks as Settings: Agents), add a first project, and, while the
 * server still offers it, the app shortcut. Finishing marks Welcome done and
 * opens the new project's Chats. The steps are this page's state, not
 * routes. **Skip for now** on every step marks it done too; Settings →
 * Welcome brings it back.
 */
export function WelcomePage() {
  const navigate = useNavigate();
  const complete = useCompleteWelcome();
  const shortcut = useAppShortcut();
  const [step, setStep] = useState<WelcomeStep>('agent');
  const [workspace, setWorkspace] = useState<Workspace | undefined>(undefined);

  /** Marks Welcome done, then leaves for the project's Chats (or Projects). A failure stays here, said in place. */
  const exit = (opened: Workspace | undefined = workspace) => {
    if (complete.isPending) return;
    complete.mutate(undefined, { onSuccess: () => void navigate(exitTarget(opened?.id)) });
  };

  const toProject = useCallback(() => setStep('project'), []);

  const onProject = (opened: Workspace) => {
    setWorkspace(opened);
    const next = stepAfterProject(shortcut.data?.offerPending);
    if (next === 'finish') exit(opened);
    else setStep(next);
  };

  const skip = (
    <Button variant="ghost" aria-disabled={complete.isPending} onClick={() => exit()}>
      Skip for now
    </Button>
  );

  return (
    <>
      <WorkspaceHeader title="Welcome" />
      <PageBody data-testid="welcome-page" data-step={step}>
        {step === 'agent' ? <AgentStep onContinue={toProject} skip={skip} /> : null}
        {step === 'project' ? <ProjectStep workspace={workspace} onOpened={onProject} onContinue={() => exit()} skip={skip} /> : null}
        {step === 'shortcut' ? <ShortcutStep platform={shortcut.data?.platform} onDone={() => exit()} skip={skip} /> : null}
        {complete.isError ? (
          <Text variant="caption" role="alert" data-testid="welcome-error">
            {complete.error.message}
          </Text>
        ) : null}
      </PageBody>
    </>
  );
}

/** A step's display headline, which takes focus when the step appears. */
function StepHeadline({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Text as="h2" variant="display" ref={ref} tabIndex={-1} className="pt-(--space-12)" data-testid="welcome-headline">
      {children}
    </Text>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/** Pick the agent: its card, and on the change to ready the step moves on by itself. */
function AgentStep({ onContinue, skip }: { onContinue(): void; skip: ReactNode }) {
  const query = useAgents();
  const agent = selectedAgent(query.data);
  const seen = agent !== undefined;
  const ready = agentReady(agent);
  const previous = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!seen) return;
    const was = previous.current;
    previous.current = ready;
    if (advancesOnReady(was, ready)) onContinue();
  }, [seen, ready, onContinue]);

  return (
    <section aria-label="Agent" className="flex max-w-(--space-chat-column) flex-col gap-4">
      <StepHeadline>Pick the agent that will do the work.</StepHeadline>
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
        query.data.map((each) => <AgentCard key={each.agentId} agent={each} selected={each.agentId === agent?.agentId} />)
      )}
      <Actions>
        {ready ? (
          <Button onClick={onContinue}>
            Continue
            <ArrowRight aria-hidden />
          </Button>
        ) : null}
        {skip}
      </Actions>
    </section>
  );
}

/** Add a first project, through the same dialog as `/`, which hands the project back here. */
function ProjectStep({
  workspace,
  onOpened,
  onContinue,
  skip,
}: {
  workspace: Workspace | undefined;
  onOpened(workspace: Workspace): void;
  onContinue(): void;
  skip: ReactNode;
}) {
  const [adding, setAdding] = useState<'pick' | 'new' | undefined>(undefined);
  // A project added while the step stays (finishing is under way or failed): focus goes to Continue, not the removed Add project.
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (workspace !== undefined) continueRef.current?.focus();
  }, [workspace]);
  return (
    <section aria-label="Project" className="flex max-w-(--space-chat-column) flex-col gap-4">
      <StepHeadline>Add a project to get started.</StepHeadline>
      <Text variant="body" tone="muted">
        A project is a folder on this computer. Your agents plan and build inside it, and every conversation stays with its project.
      </Text>
      <Actions>
        {workspace === undefined ? (
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
        ) : (
          <Button ref={continueRef} onClick={onContinue}>
            Continue
            <ArrowRight aria-hidden />
          </Button>
        )}
        {skip}
      </Actions>
      <AddProjectDialog
        open={adding !== undefined}
        startNew={adding === 'new'}
        onOpenChange={(open) => setAdding(open ? adding : undefined)}
        onOpened={onOpened}
      />
    </section>
  );
}

/**
 * The app shortcut, offered here once: showing it answers the server's offer
 * (as Not now does), so the shell's notice never makes it again; **Add
 * shortcut** still adds it. A failed Add says why in place, and Not now
 * still goes on. A failed answer is sent again quietly, after the step is
 * left too (9.6), so the notice doesn't make the offer again.
 */
function ShortcutStep({ platform, onDone, skip }: { platform: string | undefined; onDone(): void; skip: ReactNode }) {
  const { add, dismiss } = useAppShortcutActions({ retryAnswer: true });
  const answered = useRef(false);
  const answer = dismiss.mutate;
  useEffect(() => {
    if (answered.current) return;
    answered.current = true;
    answer();
  }, [answer]);
  const busy = add.isPending;
  return (
    <section aria-label="App shortcut" className="flex max-w-(--space-chat-column) flex-col gap-4" data-testid="welcome-shortcut">
      <StepHeadline>Open Ogden Agents from {shortcutLocation(platform ?? '')} next time.</StepHeadline>
      <Text variant="body" tone="muted">
        Add a shortcut, and Ogden Agents starts without a terminal.
      </Text>
      <Actions>
        <Button aria-disabled={busy} onClick={busy ? undefined : () => add.mutate(undefined, { onSuccess: onDone })}>
          {busy ? 'Adding...' : 'Add shortcut'}
        </Button>
        <Button variant="outline" aria-disabled={busy} onClick={busy ? undefined : onDone}>
          Not now
        </Button>
        {skip}
      </Actions>
      {add.isError ? (
        <Text variant="caption" role="alert" data-testid="welcome-shortcut-error">
          {add.error.message}
        </Text>
      ) : null}
    </section>
  );
}
