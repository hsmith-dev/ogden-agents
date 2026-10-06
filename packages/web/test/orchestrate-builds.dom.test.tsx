// @vitest-environment happy-dom
/**
 * Builds the manager proposes, on the Orchestrate page (epic 15, story 15.11): a build step shows as "Build ticket N", a proposal with the
 * manager's short reason and no way to approve, edit or send it; its button opens epic 5's Build dialog for that ticket, and nothing starts
 * until a button in the dialog is pressed (closing it starts nothing). The dialog's own start (the board's `POST /builds`) starts the build
 * and the page then tells the plan which run it was. An automatic run waiting at a build says so in plain words. The step shows the run as it
 * stands (running, built with the check counts, failed) and links to Runs and the review page. The server decides every rule; the REST
 * calls, the event stream and the router are stand-ins.
 */
import { BUILD_DIALOG_CONFIRM_BUTTON, BUILD_DIALOG_CONFIRM_TEXT, ORCHESTRATION_BUILD_BUTTON, ORCHESTRATION_BUILD_STEP_NOTE, ORCHESTRATION_WAITING_BUILD_WORDS, orchestrationBuildTitle, type OrchestrationRunView } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const RUN = 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const BUILD_RUN = 'run_01J9Z3K4M5N6P7Q8R9S0T1V2W5';
const BUILD_SESSION = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4';
const NO_DASH = /—|–| - /;

const fake = vi.hoisted(() => ({
  runs: [] as unknown[],
  next: undefined as unknown,
  calls: [] as string[],
  bodies: [] as Array<{ path: string; body: unknown }>,
  sandboxReady: true,
  buildRefused: undefined as undefined | string,
  linkRefused: undefined as undefined | string,
}));

vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], caughtUp: true }), useSessionEvents: () => [] }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ wsId: WS }),
  Link: ({ children, to, params, ...props }: { children: ReactNode; to: string; params: { ref?: string; sesId?: string } }) => (
    <a href={to.replace('$wsId', WS).replace('$ref', params.ref ?? '').replace('$sesId', params.sesId ?? '')} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/shell/workspace-header', () => ({ WorkspaceHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      fake.calls.push(`${method} ${path}`);
      if (init?.body !== undefined) fake.bodies.push({ path, body: JSON.parse(String(init.body)) });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (path.endsWith('/settings') && method === 'GET') return json({ settings: { cautionLevel: 'ask_every_time', bmadPieces: ['board', 'builds'], bmadScriptsTrusted: true, orchestrationEnabled: true } });
      if (path.endsWith('/orchestration')) return json({ settings: { mode: 'approve_each', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 }, roster: { manager: null, planner: null, worker: null, reviewer: null }, managerReady: true } });
      if (path.endsWith('/orchestration/runs') && method === 'GET') return json({ runs: fake.runs });
      if (path.endsWith('/orchestration/activity')) return json({ entries: [] });
      if (path.endsWith('/build-sandbox')) {
        const available = fake.sandboxReady;
        return json({
          status: {
            platform: 'linux',
            available,
            kind: available ? 'native' : null,
            summary: available ? "Claude Code's own sandbox is ready on this computer." : 'No sandbox is ready on this computer.',
            probes: [],
            choices: available ? [] : ['other_agent', 'install_docker', 'attended'],
            installHint: null,
          },
        });
      }
      if (method === 'POST' && path.endsWith('/builds')) {
        if (fake.buildRefused !== undefined) return json({ error: { code: 'not_ready', message: fake.buildRefused } }, 409);
        return json(
          {
            run: { id: BUILD_RUN, sessionId: BUILD_SESSION, workspaceId: WS, ticketRef: '1.1', worktreePath: null, sandbox: 'test', deadline: null, outcome: 'running', reason: null, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' },
            session: { id: BUILD_SESSION, workspaceId: WS, kind: 'build', state: 'working', driver: 'ui', permissionMode: 'ask', title: null, adapterRefs: {}, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' },
          },
          201,
        );
      }
      if (path.endsWith('/steps/b1/link')) {
        if (fake.linkRefused !== undefined) return json({ error: { code: 'invalid_request', message: fake.linkRefused } }, 400);
        fake.runs = [fake.next];
        return json({ run: fake.next });
      }
      return json({}, 404);
    },
  },
}));

const { WorkspaceOrchestratePage } = await import('../src/routes/workspace-orchestrate-page');
const { TooltipProvider } = await import('../src/ui/tooltip');
const { AppearanceProvider } = await import('../src/appearance/appearance-provider');

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
const mount = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AppearanceProvider>
        <TooltipProvider>
          <WorkspaceOrchestratePage />
        </TooltipProvider>
      </AppearanceProvider>
    </QueryClientProvider>,
  );
  await settle();
};

const buildStep = (fields: Record<string, unknown> = {}) => ({
  runId: RUN,
  stepId: 'b1',
  position: 0,
  worker: 'claude-code',
  chat: 'new',
  instruction: 'It is ready and has tests.',
  dependsOn: [],
  state: 'proposed',
  approvedBy: null,
  sessionId: null,
  reviewOf: null,
  review: null,
  build: { ticketRef: '1.1', runId: null },
  buildRun: null,
  workerLabel: 'Claude Code',
  sessionState: null,
  report: null,
  ...fields,
});
const view = (steps: unknown[], extra: Record<string, unknown> = {}, state = 'awaiting_user', mode = 'approve_each'): OrchestrationRunView =>
  ({
    run: { id: RUN, workspaceId: WS, goal: 'Build the first ticket', state, mode, limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 }, stopReason: null, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' },
    steps,
    ...extra,
  }) as unknown as OrchestrationRunView;

const linked = (fields: Record<string, unknown> = {}) =>
  view([buildStep({ state: 'dispatched', approvedBy: 'user', build: { ticketRef: '1.1', runId: BUILD_RUN }, buildRun: { runId: BUILD_RUN, outcome: 'running', decision: null, checks: null }, ...fields })], {}, 'running');
const posts = () => fake.calls.filter((call) => call.startsWith('POST'));
const buildsPosts = () => posts().filter((call) => call.endsWith('/builds'));

beforeEach(() => {
  fake.runs = [];
  fake.next = undefined;
  fake.calls = [];
  fake.bodies = [];
  fake.sandboxReady = true;
  fake.buildRefused = undefined;
  fake.linkRefused = undefined;
});
afterEach(cleanup);

describe('a build step on the page', () => {
  it('is a proposal for the ticket with the manager\'s reason, with no way to approve, edit or send it, and starts nothing', async () => {
    fake.runs = [view([buildStep()])];
    await mount();
    const el = screen.getByTestId('orchestrate-step');
    expect(within(el).getByTestId('orchestrate-step-build-badge').textContent).toBe(orchestrationBuildTitle('1.1'));
    expect(within(el).getByTestId('orchestrate-step-state').textContent).toBe('Waiting for you to start the build');
    expect(within(el).getByTestId('orchestrate-step-instruction').textContent).toBe('Why: It is ready and has tests.');
    expect(within(el).getByTestId('orchestrate-step-build-note').textContent).toBe(ORCHESTRATION_BUILD_STEP_NOTE);
    expect(within(el).queryByTestId('orchestrate-step-worker')).toBeNull();
    expect(within(el).queryByTestId('orchestrate-step-target')).toBeNull();
    expect(within(el).queryByTestId('orchestrate-step-mode')).toBeNull();
    for (const id of ['orchestrate-approve', 'orchestrate-send', 'orchestrate-edit']) expect(within(el).queryByTestId(id), id).toBeNull();
    expect(within(el).getByTestId('orchestrate-build-open').textContent).toBe(ORCHESTRATION_BUILD_BUTTON);
    expect(within(el).getByTestId('orchestrate-skip')).toBeTruthy();
    expect(posts()).toEqual([]);
  });

  it('opens the Build dialog for the ticket and starts nothing until a button in it is pressed; closing it starts nothing', async () => {
    fake.runs = [view([buildStep()])];
    await mount();
    fireEvent.click(screen.getByTestId('orchestrate-build-open'));
    await settle();
    const dialog = screen.getByTestId('build-dialog');
    expect(dialog.getAttribute('data-confirm')).toBe('true');
    expect(screen.getByTestId('build-dialog-confirm-text').textContent).toBe(BUILD_DIALOG_CONFIRM_TEXT);
    expect(screen.getByRole('dialog', { name: 'Build ticket 1.1?' })).toBeTruthy();
    expect(screen.getByTestId('build-dialog-start').textContent).toBe(BUILD_DIALOG_CONFIRM_BUTTON);
    expect(posts()).toEqual([]);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await settle();
    expect(screen.queryByTestId('build-dialog')).toBeNull();
    expect(posts()).toEqual([]);
  });

  it('starts the build only from the dialog\'s own button, then tells the plan which run it was', async () => {
    fake.runs = [view([buildStep()])];
    fake.next = linked();
    await mount();
    fireEvent.click(screen.getByTestId('orchestrate-build-open'));
    await settle();
    fireEvent.click(screen.getByTestId('build-dialog-start'));
    await settle();
    // The board's own start (no mode, so unattended in its sandbox), then the plan is told the run.
    expect(posts()).toEqual([`POST /api/v1/workspaces/${WS}/builds`, `POST /api/v1/workspaces/${WS}/orchestration/runs/${RUN}/steps/b1/link`]);
    expect(fake.bodies.map((entry) => entry.body)).toEqual([{ ref: '1.1' }, { runId: BUILD_RUN }]);
    expect(screen.queryByTestId('build-dialog')).toBeNull();
    expect(screen.getByTestId('orchestrate-step-state').textContent).toBe('Building');
    expect(screen.getByTestId('orchestrate-step-build-state').textContent).toBe('The build is running.');
    expect(screen.queryByTestId('orchestrate-build-open')).toBeNull();
  });

  it('keeps every choice of the dialog: building with you watching starts an attended build, and a refused build shows the reason and links nothing', async () => {
    fake.runs = [view([buildStep()])];
    fake.next = linked();
    await mount();
    fireEvent.click(screen.getByTestId('orchestrate-build-open'));
    await settle();
    // Even with a sandbox ready the attended choice is there.
    expect(screen.getByTestId('build-dialog-attended')).toBeTruthy();
    fake.buildRefused = 'This ticket is not ready to build. Move it to Ready first.';
    fireEvent.click(screen.getByTestId('build-dialog-start'));
    await settle();
    expect(screen.getByTestId('build-dialog-error').textContent).toContain('This ticket is not ready to build. Move it to Ready first.');
    expect(posts()).toEqual([`POST /api/v1/workspaces/${WS}/builds`]);
    fake.buildRefused = undefined;
    fireEvent.click(screen.getByTestId('build-dialog-attended'));
    await settle();
    expect(fake.bodies.map((entry) => entry.body)).toEqual([{ ref: '1.1' }, { ref: '1.1', mode: 'attended' }, { runId: BUILD_RUN }]);
  });

  it('with no sandbox ready offers the dialog\'s own choices, the way a Build on the board does', async () => {
    fake.sandboxReady = false;
    fake.runs = [view([buildStep()])];
    await mount();
    fireEvent.click(screen.getByTestId('orchestrate-build-open'));
    await settle();
    expect(screen.queryByTestId('build-dialog-start')).toBeNull();
    expect(screen.getAllByTestId('build-dialog-choice').map((item) => item.getAttribute('data-choice'))).toEqual(['other_agent', 'install_docker', 'attended']);
    expect(screen.getByTestId('build-dialog-confirm-text').textContent).toBe(BUILD_DIALOG_CONFIRM_TEXT);
    expect(posts()).toEqual([]);
  });

  it('says plainly when the plan could not be told about a build that did start', async () => {
    fake.runs = [view([buildStep()])];
    fake.linkRefused = 'That build is not a build of this ticket in this project, or it was started before this plan, or another step already has it.';
    await mount();
    fireEvent.click(screen.getByTestId('orchestrate-build-open'));
    await settle();
    fireEvent.click(screen.getByTestId('build-dialog-start'));
    await settle();
    expect(screen.getByTestId('orchestrate-error').textContent).toContain('not a build of this ticket');
    expect(screen.getByTestId('orchestrate-step-state').textContent).toBe('Waiting for you to start the build');
  });

  it('shows an automatic run waiting at a build in plain words, with the same dialog button, and says nothing was started', async () => {
    fake.runs = [view([buildStep()], { waiting: { kind: 'build', stepId: 'b1', ticketRef: '1.1' } }, 'awaiting_user', 'automatic')];
    await mount();
    expect(screen.getByTestId('orchestrate-waiting').getAttribute('data-waiting')).toBe('build');
    expect(screen.getByTestId('orchestrate-waiting-words').textContent).toBe(ORCHESTRATION_WAITING_BUILD_WORDS);
    fireEvent.click(screen.getByTestId('orchestrate-waiting-build-open'));
    await settle();
    expect(screen.getByTestId('build-dialog').getAttribute('data-confirm')).toBe('true');
    expect(posts()).toEqual([]);
  });

  it('shows a build that is built with its check counts and the links to Runs and the review page, and never offers to approve it here', async () => {
    fake.runs = [view([buildStep({ state: 'done', approvedBy: 'user', build: { ticketRef: '1.1', runId: BUILD_RUN }, buildRun: { runId: BUILD_RUN, outcome: 'verified', decision: null, checks: { passed: 3, failed: 0, notRun: 0 } } })], {}, 'finished')];
    await mount();
    expect(screen.getByTestId('orchestrate-step-state').textContent).toBe('Built, ready for you to review');
    expect(screen.getByTestId('orchestrate-step-build-checks').textContent).toBe('Checks: 3 passed, 0 failed, 0 not run.');
    expect(screen.getByTestId('orchestrate-step-build-state').textContent).toContain('Nothing is merged until you approve it');
    expect(screen.getByTestId('orchestrate-step-build-runs').getAttribute('href')).toBe(`/w/${WS}/runs`);
    expect(screen.getByTestId('orchestrate-step-build-review').getAttribute('href')).toBe(`/w/${WS}/review/1.1`);
    expect(screen.queryByTestId('orchestrate-step-build-decision')).toBeNull();
    for (const id of ['orchestrate-approve', 'orchestrate-send', 'orchestrate-edit', 'orchestrate-build-open']) expect(screen.queryByTestId(id), id).toBeNull();
    expect(screen.queryByRole('button', { name: /approve|merge/i })).toBeNull();
  });

  it('shows the person\'s own decision on the review page once made, and a failed build as one that did not finish', async () => {
    fake.runs = [view([buildStep({ state: 'done', build: { ticketRef: '1.1', runId: BUILD_RUN }, buildRun: { runId: BUILD_RUN, outcome: 'verified', decision: 'approved', checks: { passed: 3, failed: 0, notRun: 0 } } })], {}, 'finished')];
    await mount();
    expect(screen.getByTestId('orchestrate-step-build-decision').textContent).toBe('You approved and merged this build.');
    cleanup();
    fake.runs = [view([buildStep({ state: 'failed', build: { ticketRef: '1.1', runId: BUILD_RUN }, buildRun: { runId: BUILD_RUN, outcome: 'failed', decision: null, checks: { passed: 2, failed: 1, notRun: 0 } } })], {}, 'failed')];
    await mount();
    expect(screen.getByTestId('orchestrate-step-state').textContent).toBe('The build did not finish');
    expect(screen.getByTestId('orchestrate-step-build-checks').textContent).toBe('Checks: 2 passed, 1 failed, 0 not run.');
  });

  it('offers nothing to start once the run was stopped, and says the build was not sent', async () => {
    fake.runs = [view([buildStep()], {}, 'stopped')];
    await mount();
    expect(screen.getByTestId('orchestrate-step-state').textContent).toBe('Not sent. The run was stopped.');
    expect(screen.queryByTestId('orchestrate-build-open')).toBeNull();
  });

  it('waits for what the build step needs before offering the dialog', async () => {
    fake.runs = [view([buildStep({ stepId: 's1', build: null, worker: 'codex', workerLabel: 'Codex', instruction: 'Write the tests.' }), buildStep({ dependsOn: ['s1'], position: 1 })])];
    await mount();
    expect(screen.queryByTestId('orchestrate-build-open')).toBeNull();
    expect(screen.getByTestId('orchestrate-step-waits').textContent).toBe('Waits for s1 to finish.');
  });

  it('uses plain words with no dash', async () => {
    fake.runs = [view([buildStep()], { waiting: { kind: 'build', stepId: 'b1', ticketRef: '1.1' } }, 'awaiting_user', 'automatic')];
    await mount();
    fireEvent.click(screen.getByTestId('orchestrate-build-open'));
    await settle();
    for (const id of ['orchestrate-step-build-note', 'orchestrate-waiting-words', 'orchestrate-step-state', 'build-dialog-confirm-text']) expect(screen.getByTestId(id).textContent!, id).not.toMatch(NO_DASH);
  });
});
