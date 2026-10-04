import {
  BMAD_COMING_SOON_LABEL,
  BMAD_METHOD_SENTENCE,
  FIRST_PROJECT_CHOICE_LABELS,
  FIRST_PROJECT_CHOICES,
  FIRST_PROJECT_QUESTION,
  FIRST_PROJECT_QUESTION_HINT,
  SIMPLE_CHATS_SENTENCE,
  type BmadPiece,
  type FirstProjectChoice,
  type Workspace,
} from '@ogden-agents/shared';
import { ArrowRight, FolderPlus, Plus } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AgentCard } from '@/agents/agent-card';
import { useAgents } from '@/agents/agent-setup-api';
import { shortcutLocation, useAppShortcut, useAppShortcutActions } from '@/appearance/app-shortcut-api';
import { useCompleteWelcome, useOnboarding } from '@/onboarding/onboarding-api';
import { NEW_PROJECT_DEFAULTS_QUERY_KEY, updateNewProjectsAgent, useNewProjectDefaults } from '@/settings/new-project-defaults';
import {
  advancesOnReady,
  agentReady,
  agentSetupWords,
  asksAgentChoice,
  asksFirstProjectChoice,
  bmadMethodPieces,
  firstProjectPieces,
  resolveExitTarget,
  selectedAgent,
  stepAfterProject,
  type WelcomeStep,
} from '@/onboarding/welcome-model';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { PageBody } from '@/ui/page';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { AddProjectDialog } from '@/workspaces/add-project-dialog';
import { useWorkspaces } from '@/workspaces/workspace-api';
import { fetchWorkspaceSettings, useBmadPieces } from '@/workspaces/workspace-settings-api';

/**
 * `/welcome`: the first-run Welcome (onboarding 9.5; EXPERIENCE.md Key Flow
 * 1): pick the agent (install it, sign in or use an API key, through the same
 * card and hooks as Settings: Agents), add a first project, and, while the
 * server still offers it, the app shortcut. Finishing marks Welcome done and
 * opens the new project's Chats (its Plan when it was added with Planning
 * on, story 4.6). The steps are this page's state, not
 * routes. **Skip for now** on every step marks it done too; Settings →
 * Welcome brings it back.
 *
 * The project step asks "Simple chats or BMad Method?" once (10.4): only
 * while no answer is kept and no project exists. The answer sets the pieces
 * of the project added with it (never the app-wide default) and is kept with
 * Welcome done.
 */
export function WelcomePage() {
  const navigate = useNavigate();
  const complete = useCompleteWelcome();
  const shortcut = useAppShortcut();
  const [step, setStep] = useState<WelcomeStep>('agent');
  const [workspace, setWorkspace] = useState<Workspace | undefined>(undefined);
  /** The first-project answer the added project was created with (10.4), kept when Welcome is done. */
  const [answered, setAnswered] = useState<FirstProjectChoice | undefined>(undefined);

  /** Marks Welcome done, then leaves for the project's Plan or Chats (or Projects). A failure stays here, said in place. */
  const exit = (opened: Workspace | undefined = workspace, choice: FirstProjectChoice | undefined = answered) => {
    if (complete.isPending) return;
    // The pieces the project actually got (Welcome's answer, or the New-project defaults): with Planning, its Plan (story 4.6).
    const leave = async () => navigate(await resolveExitTarget(opened?.id, async (wsId) => (await fetchWorkspaceSettings(wsId)).bmadPieces));
    complete.mutate(choice, { onSuccess: () => void leave() });
  };

  const toProject = useCallback(() => setStep('project'), []);

  const onProject = (opened: Workspace, choice: FirstProjectChoice | undefined) => {
    setWorkspace(opened);
    setAnswered(choice);
    const next = stepAfterProject(shortcut.data?.offerPending);
    if (next === 'finish') exit(opened, choice);
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

/**
 * Pick the agent: with more than one, which one (epic 6, entry 6: kept as
 * the default for new projects); then its card, and on the change to ready
 * the step moves on by itself.
 */
function AgentStep({ onContinue, skip }: { onContinue(): void; skip: ReactNode }) {
  const query = useAgents();
  const defaults = useNewProjectDefaults();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const choosing = asksAgentChoice(query.data);
  const agent = selectedAgent(query.data, picked ?? defaults.data?.defaultAgentId);
  const choose = (agentId: string) => {
    setPicked(agentId);
    setSaveError(undefined);
    // The chosen agent becomes the default for new projects, beside the default pieces (10.4).
    updateNewProjectsAgent(agentId).then(
      (saved) => queryClient.setQueryData(NEW_PROJECT_DEFAULTS_QUERY_KEY, saved),
      (failure: unknown) => setSaveError(failure instanceof Error ? failure.message : "The agent couldn't be kept for new projects. Try again."),
    );
  };
  const seen = agent !== undefined;
  const ready = agentReady(agent);
  const agentId = agent?.agentId;
  // Per agent: choosing another agent that is ready already is not a sign-in finishing, so it never moves on.
  const previous = useRef<{ agentId: string | undefined; ready: boolean | undefined }>({ agentId: undefined, ready: undefined });
  useEffect(() => {
    if (!seen) return;
    const was = previous.current.agentId === agentId ? previous.current.ready : undefined;
    previous.current = { agentId, ready };
    if (advancesOnReady(was, ready)) onContinue();
  }, [seen, ready, agentId, onContinue]);

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
      ) : choosing && agent !== undefined ? (
        <>
          <RadioGroup aria-label="Agent" data-testid="welcome-agent-choice" value={agent.agentId} onValueChange={choose}>
            {query.data.map((each) => (
              <RadioGroupOption key={each.agentId} id={`welcome-agent-${each.agentId}`} value={each.agentId} data-testid={`welcome-agent-${each.agentId}`} label={each.displayName} description={agentSetupWords(each)} />
            ))}
          </RadioGroup>
          {saveError === undefined ? null : (
            <Text variant="caption" role="alert" data-testid="welcome-agent-error">
              {saveError}
            </Text>
          )}
          <AgentCard key={agent.agentId} agent={agent} selected />
        </>
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
export function ProjectStep({
  workspace,
  onOpened,
  onContinue,
  skip,
}: {
  workspace: Workspace | undefined;
  /** The project added, with the first-project answer it was created with when the question was asked. */
  onOpened(workspace: Workspace, choice: FirstProjectChoice | undefined): void;
  onContinue(): void;
  skip: ReactNode;
}) {
  const [adding, setAdding] = useState<'pick' | 'new' | undefined>(undefined);
  const onboarding = useOnboarding();
  const projects = useWorkspaces();
  const pieces = useBmadPieces();
  const [choice, setChoice] = useState<FirstProjectChoice>('simple_chats');
  // Once asked, the question stays for this visit: the project it adds (or one added elsewhere) doesn't take back the answer.
  const [asks, setAsks] = useState(false);
  if (!asks && asksFirstProjectChoice(onboarding.data, projects.data?.length)) setAsks(true);
  // The question can't be bypassed: adding waits until it is known whether it is asked.
  const settled = (onboarding.data !== undefined || onboarding.isError) && (projects.data !== undefined || projects.isError);
  // BMad Method needs at least one of its pieces shipped; otherwise it is greyed and marked Coming soon
  // (greyed without the mark while that is loading or couldn't be checked).
  const bmadOffered = bmadMethodPieces(pieces.data).length > 0;
  const comingSoon = pieces.data !== undefined && !bmadOffered;
  const chosen: FirstProjectChoice = choice === 'bmad_method' && !bmadOffered ? 'simple_chats' : choice;
  const bmadPieces: readonly BmadPiece[] | undefined = asks ? firstProjectPieces(chosen, pieces.data) : undefined;
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
      {asks && workspace === undefined ? (
        <FirstProjectQuestion value={chosen} bmadOffered={bmadOffered} comingSoon={comingSoon} onChange={setChoice} />
      ) : null}
      <Actions>
        {workspace === undefined ? (
          <>
            <Button aria-disabled={!settled} onClick={settled ? () => setAdding('pick') : undefined}>
              <Plus aria-hidden />
              Add project
            </Button>
            <Button variant="outline" aria-disabled={!settled} onClick={settled ? () => setAdding('new') : undefined}>
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
        onOpened={(opened) => onOpened(opened, asks ? chosen : undefined)}
        bmadPieces={bmadPieces}
      />
    </section>
  );
}

/** "Simple chats or BMad Method?" (10.4): Simple chats preselected; BMad Method greyed and marked Coming soon when none of its features ships. */
function FirstProjectQuestion({
  value,
  bmadOffered,
  comingSoon,
  onChange,
}: {
  value: FirstProjectChoice;
  bmadOffered: boolean;
  comingSoon: boolean;
  onChange(choice: FirstProjectChoice): void;
}) {
  const sentences: Record<FirstProjectChoice, ReactNode> = {
    simple_chats: SIMPLE_CHATS_SENTENCE,
    bmad_method: !comingSoon ? (
      BMAD_METHOD_SENTENCE
    ) : (
      <>
        {BMAD_METHOD_SENTENCE}{' '}
        <Badge variant="outline" data-testid="first-project-bmad-coming-soon">
          {BMAD_COMING_SOON_LABEL}
        </Badge>
      </>
    ),
  };
  return (
    <div className="flex flex-col gap-2" data-testid="first-project-question">
      <Text as="h3" variant="heading" id="first-project-question">
        {FIRST_PROJECT_QUESTION}
      </Text>
      <Text variant="caption" id="first-project-question-hint">
        {FIRST_PROJECT_QUESTION_HINT}
      </Text>
      <RadioGroup
        aria-labelledby="first-project-question"
        aria-describedby="first-project-question-hint"
        value={value}
        onValueChange={(next) => {
          if ((FIRST_PROJECT_CHOICES as readonly string[]).includes(next)) onChange(next as FirstProjectChoice);
        }}
      >
        {FIRST_PROJECT_CHOICES.map((each) => (
          <RadioGroupOption
            key={each}
            id={`first-project-${each}`}
            value={each}
            data-testid={`first-project-${each}`}
            label={FIRST_PROJECT_CHOICE_LABELS[each]}
            description={sentences[each]}
            disabled={each === 'bmad_method' && !bmadOffered}
          />
        ))}
      </RadioGroup>
    </div>
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
