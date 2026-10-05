/**
 * Story 5.3's contracts for epics 5 and 11: every new shape, request,
 * error code and event parses a valid sample and refuses an invalid one,
 * the events 5.2 stored still parse, every blocked code has its plain
 * sentence, the run's phase is derived from its own fields, and the new
 * routes sit where the guard expects them.
 */
import { describe, expect, it } from 'vitest';
import * as shared from '../src/index.js';
import {
  AddWebhookRequest,
  AllReadyBuildsResponse,
  API_BASE,
  API_ERROR_CODES,
  API_ROUTES,
  ApproveBuildRequest,
  BLOCKED_CODES,
  BLOCKED_SENTENCES,
  blockedSentence,
  BuildRunResult,
  CheckAgainRequest,
  CoreEvent,
  NewCoreEvent,
  NotificationSettings,
  RejectBuildRequest,
  RetryRunRequest,
  ReviewResponse,
  Run,
  RUN_DECISIONS,
  RUN_LIMIT_DEFAULTS,
  RUN_OUTCOMES,
  RUN_PHASE_LABELS,
  RUN_PHASES,
  RunLimitSettings,
  runPhase,
  RunResponse,
  RunsResponse,
  SANDBOX_CHOICE_LABELS,
  SANDBOX_CHOICES,
  ServerMessage,
  StartBuildRequest,
  StopRunRequest,
  testsFailedDetail,
  UpdateRunLimitSettingsRequest,
  UpdateWebhookRequest,
  UpdateWorkspaceBuildSettingsRequest,
  VERIFICATION_CHECKS,
  VerificationResult,
  WebhookPayload,
  WebhookTestResult,
  WorkspaceBuildSettings,
  type RunPhase,
} from '../src/index.js';

const wsId = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const sesId = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const runId = 'run_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const hookId = 'hook_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const at = '2026-10-04T12:00:00.000Z';
const commit = 'a'.repeat(40);
const assigned = { id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W3', seq: 7, at };
const onSession = { workspaceId: wsId, streamId: sesId };
const onWorkspace = { workspaceId: wsId, streamId: wsId };
const onSettings = { workspaceId: null, streamId: 'settings' };

/** A run as story 5.2 stored it: none of story 5.3's fields. */
const run52 = {
  id: runId,
  sessionId: sesId,
  workspaceId: wsId,
  ticketRef: '1.1',
  worktreePath: '/data/w/abcdefgh',
  sandbox: 'seatbelt',
  deadline: null,
  outcome: 'blocked',
  branch: 'ogden/abcdefgh/1.1-build-the-thing',
  baseRevision: commit,
  reason: 'interrupted',
  createdAt: at,
  updatedAt: at,
};

const checks = (results: Array<'pass' | 'fail' | 'not_run'>) => VERIFICATION_CHECKS.map((id, index) => ({ id, result: results[index]!, detail: results[index] === 'fail' ? testsFailedDetail(3) : null }));
const verified = { outcome: 'verified', checks: checks(['pass', 'pass', 'pass']), testCommand: 'npm test', testOutputTail: 'Tests: 5 passed', checkedAt: at };

const DASHES = /[–—]/;

describe('runs (story 5.3)', () => {
  it("a run 5.2 stored parses, with no agent, code, queue position or decision; a new run's fields parse and refuse bad values", () => {
    // Story 5.5 adds `baseBranch`, `null` for runs from before it.
    expect(Run.parse(run52)).toMatchObject({ agent: null, blockedCode: null, queuePosition: null, decision: null, baseBranch: null });
    const full = { ...run52, agent: 'claude-code', blockedCode: 'interrupted', queuePosition: null, decision: null, baseBranch: 'main' };
    expect(Run.parse(full)).toEqual(full);
    expect(Run.safeParse({ ...full, agent: 'Not An Id' }).success).toBe(false);
    expect(Run.safeParse({ ...full, blockedCode: 'tired' }).success).toBe(false);
    expect(Run.safeParse({ ...full, queuePosition: 0 }).success).toBe(false);
    expect(Run.safeParse({ ...full, decision: 'maybe' }).success).toBe(false);
  });

  it('every blocked code has one plain sentence with no em or en dash; the time limit names its minutes', () => {
    for (const code of BLOCKED_CODES) {
      const sentence = blockedSentence(code);
      expect(sentence.length, code).toBeGreaterThan(10);
      expect(sentence, code).not.toMatch(DASHES);
      expect(sentence.endsWith('.'), code).toBe(true);
    }
    expect(Object.keys(BLOCKED_SENTENCES).sort()).toEqual(BLOCKED_CODES.filter((code) => code !== 'time_limit').sort());
    expect(blockedSentence('time_limit')).toBe('Stopped after 45 minutes without finishing.');
    expect(blockedSentence('time_limit', { minutes: 30 })).toBe('Stopped after 30 minutes without finishing.');
    // EXPERIENCE.md Voice and Tone's own sentences.
    expect(blockedSentence('unclear_intent')).toBe('The story was not clear enough to build. Add detail and retry.');
    expect(blockedSentence('verification_failed')).toBe('The code did not pass its own checks.');
    expect(blockedSentence('review_loop_exceeded')).toBe('It could not fix the review findings after 5 tries.');
    expect(blockedSentence('merge_conflict')).toBe('This story needs to be updated with the latest changes before it can merge.');
  });

  it('a run shows as exactly one phase, from its outcome, blocked code, queue position and decision', () => {
    const table: Array<[Parameters<typeof runPhase>[0], RunPhase]> = [
      [{ outcome: 'running' }, 'running'],
      [{ outcome: 'running', queuePosition: 2 }, 'queued'],
      [{ outcome: 'blocked', blockedCode: 'checkpoint_plan' }, 'checkpoint'],
      [{ outcome: 'blocked', blockedCode: 'checkpoint_done' }, 'checkpoint'],
      [{ outcome: 'blocked', blockedCode: 'interrupted' }, 'interrupted'],
      [{ outcome: 'blocked', blockedCode: 'intent_gap' }, 'needs_you'],
      [{ outcome: 'blocked', blockedCode: null }, 'needs_you'],
      [{ outcome: 'verified' }, 'built'],
      [{ outcome: 'verified', decision: 'approved' }, 'approved'],
      [{ outcome: 'failed' }, 'failed'],
      [{ outcome: 'stopped' }, 'stopped'],
      [{ outcome: 'stopped', decision: 'rejected' }, 'rejected'],
    ];
    for (const [fields, phase] of table) expect(runPhase(fields), JSON.stringify(fields)).toBe(phase);
    // Every combination lands on a phase with a label.
    const seen = new Set<RunPhase>();
    for (const outcome of RUN_OUTCOMES) {
      for (const blockedCode of [null, ...BLOCKED_CODES]) {
        for (const queuePosition of [null, 1]) {
          for (const decision of [null, ...RUN_DECISIONS]) {
            const phase = runPhase({ outcome, blockedCode, queuePosition, decision });
            expect(RUN_PHASES).toContain(phase);
            seen.add(phase);
          }
        }
      }
    }
    expect([...seen].sort()).toEqual([...RUN_PHASES].sort());
    for (const phase of RUN_PHASES) expect(RUN_PHASE_LABELS[phase]).not.toMatch(DASHES);
    for (const choice of SANDBOX_CHOICES) expect(SANDBOX_CHOICE_LABELS[choice].length).toBeGreaterThan(0);
  });

  it('the per-run JSON result parses, and refuses a missing field or a bad status', () => {
    const result = {
      version: 1,
      runId,
      ticketRef: '1.1',
      status: 'blocked',
      commit,
      baseRevision: commit,
      blockedCondition: 'intent gap',
      blockedReason: 'What should it say?',
      intentGapPatch: '_bmad-output/x/story-plan.patch',
      networkFailure: false,
      endedAt: at,
    };
    expect(BuildRunResult.parse(result)).toEqual(result);
    expect(BuildRunResult.safeParse({ ...result, status: 'finished' }).success).toBe(false);
    expect(BuildRunResult.safeParse({ ...result, version: 2 }).success).toBe(false);
    // The saved fix is a .patch under _bmad-output, never a path that climbs out or is absolute.
    for (const intentGapPatch of ['../../etc/passwd.patch', '/etc/x.patch', '_bmad-output/../x.patch', '_bmad-output/x.md', 'src/x.patch', '_bmad-output\\..\\x.patch']) {
      expect(BuildRunResult.safeParse({ ...result, intentGapPatch }).success, intentGapPatch).toBe(false);
    }
    // A code the file names is never taken: only the runner maps a condition (AD-12).
    expect(BuildRunResult.parse({ ...result, blockedCode: 'checkpoint_plan' })).not.toHaveProperty('blockedCode');
    const { endedAt: _, ...withoutEnd } = result;
    expect(BuildRunResult.safeParse(withoutEnd).success).toBe(false);
  });
});

describe('requests and responses (story 5.3)', () => {
  it('the build request: one ticket (agent left to the build runner) or every ready one; nothing else', () => {
    expect(StartBuildRequest.parse({ ref: '1.1' })).toEqual({ mode: 'unattended', ref: '1.1' });
    expect(StartBuildRequest.parse({ ref: '1.1', mode: 'attended' }).mode).toBe('attended');
    expect(StartBuildRequest.safeParse({ ref: '1.1', mode: 'sandboxless' }).success).toBe(false);
    expect(StartBuildRequest.parse({ all: true })).toEqual({ mode: 'unattended', all: true });
    expect(StartBuildRequest.parse({ agent: 'codex', ref: '1.1' })).toEqual({ agent: 'codex', mode: 'unattended', ref: '1.1' });
    expect(StartBuildRequest.safeParse({ agent: 'Not An Id', ref: '1.1' }).success).toBe(false);
    expect(StartBuildRequest.safeParse({ ref: '1.1', all: true }).success).toBe(false);
    expect(StartBuildRequest.safeParse({ all: false }).success).toBe(false);
    expect(StartBuildRequest.safeParse({ ref: 'not a ref' }).success).toBe(false);
    expect(StartBuildRequest.safeParse({}).success).toBe(false);
  });

  it('approve, reject, retry, stop and check again', () => {
    expect(ApproveBuildRequest.safeParse({ revision: commit }).success).toBe(true);
    expect(ApproveBuildRequest.safeParse({ revision: 'HEAD' }).success).toBe(false);
    expect(RejectBuildRequest.parse({})).toEqual({});
    expect(RejectBuildRequest.parse({ note: '  Use the blue one.  ' })).toEqual({ note: 'Use the blue one.' });
    expect(RejectBuildRequest.safeParse({ note: 'x'.repeat(4001) }).success).toBe(false);
    expect(RetryRunRequest.parse({})).toEqual({ mode: 'resume' });
    for (const mode of ['resume', 'rebase', 'apply_fix']) expect(RetryRunRequest.parse({ mode })).toEqual({ mode });
    expect(RetryRunRequest.safeParse({ mode: 'force' }).success).toBe(false);
    expect(StopRunRequest.safeParse({}).success).toBe(true);
    expect(StopRunRequest.safeParse({ force: true }).success).toBe(false);
    expect(CheckAgainRequest.safeParse({}).success).toBe(true);
    expect(CheckAgainRequest.safeParse({ testCommand: 'rm -rf /' }).success).toBe(false);
  });

  it('a review 5.2 answered still parses, with no summary, verification, findings or stats; the full review parses', () => {
    const review52 = { run: run52, outcome: 'verified', reason: null, diff: '', truncated: false, files: [], merged: false, headRevision: commit };
    expect(ReviewResponse.parse(review52)).toMatchObject({ summary: null, verification: null, findings: [], diffStats: null });
    const full = {
      ...review52,
      summary: 'Adds the thing.',
      verification: verified,
      findings: [
        { kind: 'finding', severity: 'medium', text: 'A check was missing.' },
        { kind: 'deferred', severity: null, text: 'Later.' },
      ],
      diffStats: { files: 2, insertions: 10, deletions: 1 },
    };
    expect(ReviewResponse.parse(full)).toMatchObject({ summary: 'Adds the thing.', diffStats: { files: 2 } });
    expect(ReviewResponse.safeParse({ ...full, diffStats: { files: -1, insertions: 0, deletions: 0 } }).success).toBe(false);
    expect(ReviewResponse.safeParse({ ...full, findings: [{ kind: 'nit', severity: null, text: 'x' }] }).success).toBe(false);
  });

  it('runs, a run, and all ready', () => {
    const queue = [{ runId, ticketRef: '1.2', position: 1 }];
    expect(RunsResponse.parse({ runs: [run52], queue }).queue).toEqual(queue);
    expect(RunsResponse.safeParse({ runs: [run52], queue: [{ runId, ticketRef: '1.2', position: 0 }] }).success).toBe(false);
    expect(RunResponse.parse({ run: run52 })).toMatchObject({ verification: null });
    expect(RunResponse.parse({ run: run52, verification: verified }).verification?.outcome).toBe('verified');
    expect(AllReadyBuildsResponse.parse({ runs: [], queue }).queue).toHaveLength(1);
  });

  it('verification: exactly the three checks in order, verified only when all pass', () => {
    expect(VerificationResult.parse(verified)).toEqual(verified);
    const failed = { ...verified, outcome: 'failed', checks: checks(['pass', 'fail', 'pass']) };
    expect(VerificationResult.parse(failed).checks[1]).toEqual({ id: 'tests_pass', result: 'fail', detail: '3 tests failed when re-run' });
    expect(VerificationResult.safeParse({ ...verified, checks: checks(['pass', 'fail', 'pass']) }).success).toBe(false);
    expect(VerificationResult.safeParse({ ...failed, checks: checks(['pass', 'pass', 'pass']) }).success).toBe(false);
    expect(VerificationResult.safeParse({ ...verified, checks: [...verified.checks].reverse() }).success).toBe(false);
    expect(VerificationResult.safeParse({ ...verified, checks: verified.checks.slice(1) }).success).toBe(false);
    expect(VerificationResult.parse({ ...failed, checks: checks(['fail', 'not_run', 'not_run']) }).outcome).toBe('failed');
    expect(testsFailedDetail(1)).toBe('1 test failed when re-run');
  });

  it('run limits: defaults 2 per project, 3 per install, 45 minutes; changes within bounds only', () => {
    expect(RUN_LIMIT_DEFAULTS).toEqual({ maxConcurrentRunsPerWorkspace: 2, maxConcurrentRunsPerInstall: 3, maxRunMinutes: 45 });
    expect(RunLimitSettings.parse({})).toEqual({ maxConcurrentRunsPerInstall: 3, maxRunMinutes: 45 });
    expect(WorkspaceBuildSettings.parse({})).toEqual({ maxConcurrentRuns: 2, testCommand: null });
    expect(UpdateRunLimitSettingsRequest.safeParse({ maxRunMinutes: 30 }).success).toBe(true);
    expect(UpdateRunLimitSettingsRequest.safeParse({ maxRunMinutes: 1 }).success).toBe(false);
    expect(UpdateRunLimitSettingsRequest.safeParse({ maxConcurrentRunsPerInstall: 2.5 }).success).toBe(false);
    expect(UpdateRunLimitSettingsRequest.safeParse({}).success).toBe(false);
    expect(UpdateWorkspaceBuildSettingsRequest.parse({ testCommand: ' pnpm test ' })).toEqual({ testCommand: 'pnpm test' });
    expect(UpdateWorkspaceBuildSettingsRequest.parse({ testCommand: null })).toEqual({ testCommand: null });
    expect(UpdateWorkspaceBuildSettingsRequest.safeParse({ testCommand: 'npm test\nrm -rf /' }).success).toBe(false);
    expect(UpdateWorkspaceBuildSettingsRequest.safeParse({ maxConcurrentRuns: 0 }).success).toBe(false);
  });

  it('notifications: a webhook is listed by host, never URL; https only (http to this computer); the payload carries no code', () => {
    const target = { id: hookId, host: 'hooks.example.com', events: ['blocked'], createdAt: at };
    expect(NotificationSettings.parse({})).toEqual({ webhooks: [], browserNotifications: false });
    expect(NotificationSettings.parse({ webhooks: [target], browserNotifications: true }).webhooks[0]).toEqual(target);
    expect(AddWebhookRequest.safeParse({ url: 'https://hooks.example.com/x', events: ['blocked', 'ready_for_review'] }).success).toBe(true);
    expect(AddWebhookRequest.safeParse({ url: 'http://127.0.0.1:9999/hook', events: ['blocked'] }).success).toBe(true);
    for (const url of ['http://hooks.example.com/x', 'https://user:secret@hooks.example.com/', 'ftp://x', 'not a url', 'file:///etc/passwd']) {
      expect(AddWebhookRequest.safeParse({ url, events: ['blocked'] }).success, url).toBe(false);
    }
    expect(AddWebhookRequest.safeParse({ url: 'https://hooks.example.com/x', events: [] }).success).toBe(false);
    expect(UpdateWebhookRequest.safeParse({ events: ['ready_for_review'] }).success).toBe(true);
    expect(UpdateWebhookRequest.safeParse({ events: ['merged'] }).success).toBe(false);
    expect(WebhookTestResult.parse({ ok: false, status: 500, failure: 'http', message: 'The webhook answered with HTTP 500.' }).status).toBe(500);
    expect(WebhookTestResult.safeParse({ ok: false, status: 99, failure: 'http', message: 'x' }).success).toBe(false);
    const payload = {
      version: 1,
      event: 'blocked',
      workspace: { id: wsId, name: 'Deposit checkout' },
      ticket: { ref: '1.1', title: 'Build the thing' },
      run: { id: runId, phase: 'needs_you', blockedCode: 'intent_gap' },
      text: 'Build the thing is blocked.',
      sentAt: at,
    };
    expect(WebhookPayload.parse(payload)).toEqual(payload);
    expect(WebhookPayload.parse({ ...payload, event: 'test', workspace: null, ticket: null, run: null })).toMatchObject({ event: 'test' });
    expect(WebhookPayload.safeParse({ ...payload, diff: 'diff --git' }).success).toBe(false);
    expect(WebhookPayload.safeParse({ ...payload, run: { ...payload.run, worktreePath: '/data/w/x' } }).success).toBe(true);
    expect(WebhookPayload.parse({ ...payload, run: { ...payload.run, worktreePath: '/data/w/x' } }).run).not.toHaveProperty('worktreePath');
  });

  it('error codes: every builds refusal and run_not_active', () => {
    for (const code of ['prerequisite_unmet', 'not_ready', 'run_active', 'sandbox_unavailable', 'merge_conflict', 'checkout_dirty', 'checks_failed', 'feature_off', 'run_not_active', 'not_implemented']) {
      expect(API_ERROR_CODES, code).toContain(code);
    }
  });
});

/** Story 5.3's events: a valid sample and an invalid one each. */
const EVENTS: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
  ['run.created', { ...onSession, payload: { run: run52 } }, { ...onSession, payload: { run: { ...run52, agent: 'Not An Id' } } }],
  [
    'run.outcome_changed',
    { ...onSession, payload: { runId, outcome: 'blocked', previous: 'running', reason: 'It stopped.', blockedCode: 'time_limit' } },
    { ...onSession, payload: { runId, outcome: 'blocked', previous: 'running', blockedCode: 'bored' } },
  ],
  [
    'run.dispatched',
    { ...onSession, payload: { runId, worktreePath: '/data/w/abcdefgh', branch: 'ogden/abcdefgh/1.1-x', baseRevision: commit, sandbox: 'seatbelt', deadline: at } },
    { ...onSession, payload: { runId, worktreePath: '', branch: 'b', baseRevision: commit, sandbox: 'seatbelt', deadline: at } },
  ],
  ['run.queue_changed', { ...onWorkspace, payload: { queue: [{ runId, ticketRef: '1.2', position: 1 }] } }, { ...onSession, payload: { queue: [{ runId, ticketRef: '1.2', position: 1 }] } }],
  ['run.verification_completed', { ...onSession, payload: { runId, verification: verified } }, { ...onSession, payload: { runId, verification: { ...verified, outcome: 'failed' } } }],
  ['run.decided', { ...onSession, payload: { runId, decision: 'approved', mergeRevision: commit, reviewedRevision: commit } }, { ...onSession, payload: { runId, decision: 'merged' } }],
  [
    'workspace.build_settings_changed',
    { ...onWorkspace, payload: { settings: { maxConcurrentRuns: 1, testCommand: 'pnpm test' }, previous: { maxConcurrentRuns: 2, testCommand: null } } },
    { ...onWorkspace, payload: { settings: { maxConcurrentRuns: 0, testCommand: null }, previous: { maxConcurrentRuns: 2, testCommand: null } } },
  ],
  [
    'settings.run_limits_changed',
    { ...onSettings, payload: { settings: { maxConcurrentRunsPerInstall: 4, maxRunMinutes: 60 }, previous: { maxConcurrentRunsPerInstall: 3, maxRunMinutes: 45 } } },
    { ...onWorkspace, payload: { settings: { maxConcurrentRunsPerInstall: 4, maxRunMinutes: 60 }, previous: { maxConcurrentRunsPerInstall: 3, maxRunMinutes: 45 } } },
  ],
  ['settings.notifications_changed', { ...onSettings, payload: { webhooks: 2, browserNotifications: true } }, { ...onSettings, payload: { webhooks: -1, browserNotifications: true } }],
];

describe('run events (story 5.3)', () => {
  for (const [type, valid, invalid] of EVENTS) {
    it(`${type}: parses a valid sample in CoreEvent, NewCoreEvent and ServerMessage, and refuses an invalid one`, () => {
      expect(NewCoreEvent.parse({ type, ...valid })).toMatchObject({ type });
      expect(CoreEvent.parse({ type, ...valid, ...assigned })).toMatchObject({ type, seq: 7 });
      expect(ServerMessage.parse({ type, ...valid, ...assigned })).toMatchObject({ type });
      expect(NewCoreEvent.safeParse({ type, ...invalid }).success).toBe(false);
    });
  }

  it('the run events 5.2 stored still parse: run.created without the new fields, run.outcome_changed without a code', () => {
    expect(CoreEvent.parse({ type: 'run.created', ...onSession, ...assigned, payload: { run: run52 } })).toMatchObject({ payload: { run: { agent: null, decision: null } } });
    const changed = CoreEvent.parse({ type: 'run.outcome_changed', ...onSession, ...assigned, payload: { runId, outcome: 'blocked', previous: 'running', reason: 'interrupted' } });
    expect(changed.type === 'run.outcome_changed' ? changed.payload.blockedCode : 'missing').toBeUndefined();
  });

  it('the notifications event never carries an address', () => {
    const parsed = NewCoreEvent.parse({ type: 'settings.notifications_changed', ...onSettings, payload: { webhooks: 1, browserNotifications: false, url: 'https://hooks.example.com/secret' } });
    expect(JSON.stringify(parsed)).not.toContain('hooks.example.com');
  });
});

describe('routes (story 5.3)', () => {
  const workspaceRoutes = [API_ROUTES.workspaceRuns, API_ROUTES.workspaceRun, API_ROUTES.runStop, API_ROUTES.runRetry, API_ROUTES.runCheckAgain, API_ROUTES.workspaceBuildSettings];
  const installRoutes = [API_ROUTES.runLimits, API_ROUTES.notificationSettings, API_ROUTES.notificationWebhooks, API_ROUTES.notificationWebhook, API_ROUTES.notificationWebhookTest];

  it("builds' routes are inside a workspace; the install's are under settings and name no BMad piece", () => {
    for (const route of workspaceRoutes) expect(route.startsWith(`${API_BASE}/workspaces/:wsId/`), route).toBe(true);
    for (const route of installRoutes) {
      expect(route.startsWith(`${API_BASE}/settings/`), route).toBe(true);
      for (const segment of route.split('/')) expect(['bmad', 'plan', 'planning', 'board', 'tickets', 'builds', 'runs', 'retrospectives', 'catalog'], route).not.toContain(segment);
    }
  });
});

describe('UI text (story 5.3)', () => {
  it('no exported string of the builds modules holds an em or en dash', () => {
    for (const [name, value] of Object.entries(shared)) {
      if (typeof value === 'string') expect(value, name).not.toMatch(DASHES);
      if (typeof value === 'object' && value !== null && !Array.isArray(value) && !('safeParse' in value)) {
        for (const [key, text] of Object.entries(value)) if (typeof text === 'string') expect(text, `${name}.${key}`).not.toMatch(DASHES);
      }
    }
  });
});
