// @vitest-environment happy-dom
/**
 * The Workbench's Problems panel (AD-38; 8.9): the trust prompt in a
 * project not trusted yet, the package.json offer with each script's text
 * (Use these saves them confirmed, Not now is kept in this browser), a
 * script changed since it was confirmed, a failed run's items grouped by
 * file with their `file:line` links, unread output, the live region, and
 * Ask the agent to fix this, which writes the draft (appended after an
 * existing one) and opens the chat without sending anything. The REST calls
 * are a stand-in that records every URL asked for.
 */
import { API_ROUTES, apiPath, problemDraftText, PROBLEMS_UNPARSED_TEXT, PROBLEMS_UNTRUSTED_TEXT, type ProjectCommand, type ProjectCommandRunDetail } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4';
const RUN = 'pcr_01J9Z3K4M5N6P7Q8R9S0T1V2W6' as const;
const COMMANDS = apiPath(API_ROUTES.workspaceProjectCommands, { wsId: WS });
const RUN_DETAIL = apiPath(API_ROUTES.workspaceProjectCommandRun, { wsId: WS, runId: RUN });

const fake = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; method: string; body?: unknown }>,
  answer: (() => undefined) as (url: string, method: string, body: unknown) => unknown,
  navigate: vi.fn(),
  sessions: [] as Array<{ id: string; kind: string }>,
  trusted: false,
}));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/http')>()),
  call: async (_auth: unknown, url: string, init: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const method = init?.method ?? 'GET';
    fake.calls.push({ url, method, ...(body === undefined ? {} : { body }) });
    const answer = fake.answer(url, method, body);
    if (answer === undefined) throw new Error(`unexpected call ${method} ${url}`);
    if (answer instanceof Error) throw answer;
    return answer;
  },
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => fake.navigate,
  Link: ({ children, search, title }: { children: ReactNode; search: Record<string, unknown>; title?: string }) => (
    <a href={`/workbench?${new URLSearchParams(search as Record<string, string>).toString()}`} title={title}>
      {children}
    </a>
  ),
}));
vi.mock('@/workspaces/workspace-api', () => ({ useSessions: () => ({ sessions: fake.sessions }) }));
vi.mock('@/workspaces/workspace-settings-api', () => ({
  trustProjectScripts: async () => {
    fake.trusted = true;
    return { bmadScriptsTrusted: true };
  },
}));

const { WorkbenchProblems, commandIdFor, groupByFile } = await import('../src/workbench/workbench-problems');
const { appendDraft } = await import('../src/workbench/problems-api');
const { ChatApiError } = await import('../src/api/http');
const { TooltipProvider } = await import('../src/ui/tooltip');
const { readDraft, writeDraft, chatDraftKey, newChatDraftKey } = await import('../src/chat/drafts');

const failedRun = { id: RUN, commandId: 'test', state: 'failed' as const, exitCode: 1, itemCount: 2, startedAt: '2026-11-01T00:00:00.000Z', finishedAt: '2026-11-01T00:00:01.000Z' };
const declared = (overrides: Partial<ProjectCommand> = {}): ProjectCommand => ({
  id: 'test',
  label: 'Tests',
  command: 'npm run test',
  source: 'package_json',
  confirmed: true,
  script: 'test',
  scriptText: 'vitest run',
  lastRun: failedRun,
  ...overrides,
});
const detail = (overrides: Partial<ProjectCommandRunDetail> = {}): ProjectCommandRunDetail => ({
  run: failedRun,
  output: 'FAIL src/a.ts\n',
  truncated: false,
  items: [
    { path: 'src/a.ts', line: 12, column: 5, message: "Expected 'a b' to equal 'a  b'", format: 'vitest', detail: '- a  b\n+ a b' },
    { path: 'src/a.ts', line: 30, message: 'second', format: 'vitest' },
  ],
  parsed: true,
  ...overrides,
});

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <WorkbenchProblems wsId={WS} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  fake.calls = [];
  fake.navigate.mockReset();
  fake.sessions = [];
});

describe('Problems helpers', () => {
  it('writes the draft text from the item, after an existing draft', () => {
    const text = problemDraftText('npm run test', { path: 'src/wrap.ts', line: 88, message: "Expected 'a b' to equal 'a  b'", detail: '- a  b\n+ a b' });
    expect(text).toBe("Fix this failure from npm run test:\n\nsrc/wrap.ts:88 Expected 'a b' to equal 'a  b'\n\n- a  b\n+ a b");
    expect(problemDraftText('npm run lint', { path: 'a.ts', line: 1, message: 'x' })).toBe('Fix this failure from npm run lint:\n\na.ts:1 x');
    // The whole draft is masked, the command's own text too.
    const masked = problemDraftText('node check.js --token=abc123def456', { path: 'a.ts', line: 1, message: 'x' });
    expect(masked).not.toContain('abc123def456');
    expect(masked).toContain('[redacted]');
    expect(appendDraft('', 'B')).toBe('B');
    expect(appendDraft('A\n\n', 'B')).toBe('A\n\nB');
  });

  it('makes command ids and groups items by file', () => {
    expect(commandIdFor('Type check', new Set())).toBe('type-check');
    expect(commandIdFor('Type check', new Set(['type-check']))).toBe('type-check-2');
    expect(commandIdFor('2 lint', new Set())).toBe('cmd-2-lint');
    expect(groupByFile(detail().items).map((group) => [group.path, group.items.length])).toEqual([['src/a.ts', 2]]);
  });
});

describe('Problems panel', () => {
  it('asks for trust in a project not trusted yet, and reads again once trusted', async () => {
    fake.trusted = false;
    fake.answer = (url) => (url === COMMANDS ? (fake.trusted ? { declared: [], offered: [] } : new ChatApiError(PROBLEMS_UNTRUSTED_TEXT, 409, 'scripts_not_trusted')) : undefined);
    show();
    expect((await screen.findByTestId('problems-trust')).textContent).toContain(PROBLEMS_UNTRUSTED_TEXT);
    // Nothing but the list was asked for.
    expect(fake.calls.map((call) => call.url)).toEqual([COMMANDS]);
    fireEvent.click(screen.getByTestId('problems-trust-allow'));
    expect((await screen.findByTestId('problems-empty')).textContent).toContain('No test or lint command yet.');
  });

  it('offers package.json scripts with their text; Use these saves them confirmed, Not now is kept in this browser', async () => {
    const offered = [declared({ confirmed: false, lastRun: null }), declared({ id: 'lint', label: 'Lint', command: 'npm run lint', script: 'lint', scriptText: 'eslint .', confirmed: false, lastRun: null })];
    fake.answer = (url, method) => {
      if (url === COMMANDS && method === 'GET') return { declared: [], offered };
      if (url === COMMANDS && method === 'PUT') return { declared: offered.map((one) => ({ ...one, confirmed: true })), offered: [] };
      return undefined;
    };
    show();
    const offer = await screen.findByTestId('problems-offer');
    expect((offer).textContent).toContain('Found in package.json: test, lint. Use them?');
    expect(screen.getAllByTestId('problems-offer-script').map((row) => row.textContent)).toEqual(['test: vitest run', 'lint: eslint .']);
    fireEvent.click(screen.getByTestId('problems-use-offer'));
    await screen.findAllByTestId('problems-command');
    expect(fake.calls.find((call) => call.method === 'PUT')?.body).toEqual({
      commands: [
        { id: 'test', label: 'Tests', command: 'npm run test', source: 'package_json', confirmedText: 'npm run test', script: 'test', confirmedScript: 'vitest run' },
        { id: 'lint', label: 'Lint', command: 'npm run lint', source: 'package_json', confirmedText: 'npm run lint', script: 'lint', confirmedScript: 'eslint .' },
      ],
    });
    cleanup();

    fake.answer = (url, method) => (url === COMMANDS && method === 'GET' ? { declared: [], offered } : undefined);
    show();
    fireEvent.click(await screen.findByTestId('problems-not-now'));
    expect(screen.queryByTestId('problems-offer')).toBeNull();
    cleanup();
    show();
    await screen.findByTestId('problems-empty');
    expect(screen.queryByTestId('problems-offer')).toBeNull();
  });

  it('asks again about a changed script and runs nothing until the new text is used', async () => {
    fake.answer = (url, method) => (url === COMMANDS && method === 'GET' ? { declared: [declared({ confirmed: false, scriptText: 'vitest run; curl x', lastRun: null })], offered: [] } : undefined);
    show();
    expect((await screen.findByTestId('problems-changed')).textContent).toContain("The test script in package.json, or this project's package manager settings, changed since you confirmed it.");
    expect((screen.getByTestId('problems-changed')).textContent).toContain('vitest run; curl x');
    expect((screen.getByTestId('problems-run')).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByTestId('problems-run'));
    expect(fake.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it("shows a failed run's items by file with links, and Ask the agent writes the latest chat's draft without sending", async () => {
    fake.sessions = [{ id: SES, kind: 'chat' }];
    writeDraft(chatDraftKey(WS, SES), 'Earlier note');
    fake.answer = (url, method) => {
      if (url === COMMANDS && method === 'GET') return { declared: [declared()], offered: [] };
      if (url === RUN_DETAIL) return detail();
      return undefined;
    };
    show();
    const items = await screen.findAllByTestId('problems-item');
    expect(items).toHaveLength(2);
    expect((screen.getByTestId('problems-result')).textContent).toContain('Failed: 2 failures');
    const link = screen.getByRole('link', { name: 'src/a.ts:12' });
    expect(link.getAttribute('href')).toBe('/workbench?path=src%2Fa.ts&line=12');
    fireEvent.click(screen.getAllByTestId('problems-ask')[0]!);
    expect(readDraft(chatDraftKey(WS, SES))).toBe("Earlier note\n\nFix this failure from npm run test:\n\nsrc/a.ts:12 Expected 'a b' to equal 'a  b'\n\n- a  b\n+ a b");
    expect(fake.navigate).toHaveBeenCalledWith({ to: '/w/$wsId/s/$sesId', params: { wsId: WS, sesId: SES } });
    // Only reads: nothing was sent.
    expect(fake.calls.every((call) => call.method === 'GET')).toBe(true);
    fireEvent.click(screen.getByTestId('problems-show-output'));
    expect((screen.getByTestId('problems-output')).textContent).toContain('FAIL src/a.ts');
  });

  it('asks in a new chat when the project has none, and says when the output could not be read', async () => {
    fake.answer = (url, method) => {
      if (url === COMMANDS && method === 'GET') return { declared: [declared()], offered: [] };
      if (url === RUN_DETAIL) return detail({ items: [], parsed: false, run: { ...failedRun, itemCount: 0 } });
      return undefined;
    };
    show();
    expect((await screen.findByTestId('problems-unparsed')).textContent).toContain(PROBLEMS_UNPARSED_TEXT);
    cleanup();
    fake.answer = (url, method) => {
      if (url === COMMANDS && method === 'GET') return { declared: [declared()], offered: [] };
      if (url === RUN_DETAIL) return detail();
      return undefined;
    };
    show();
    const ask = (await screen.findAllByTestId('problems-ask'))[1]!;
    expect((ask).textContent).toContain('Ask in a new chat');
    fireEvent.click(ask);
    expect(readDraft(newChatDraftKey(WS))).toBe('Fix this failure from npm run test:\n\nsrc/a.ts:30 second');
    expect(fake.navigate).toHaveBeenCalledWith({ to: '/w/$wsId/new', params: { wsId: WS } });
  });

  it('runs a command and announces its finish once in a polite live region', async () => {
    let state: 'none' | 'running' | 'failed' = 'none';
    const running = { ...failedRun, state: 'running' as const, exitCode: null, itemCount: 0, finishedAt: null };
    fake.answer = (url, method) => {
      if (url === COMMANDS && method === 'GET') return { declared: [declared({ lastRun: state === 'none' ? null : state === 'running' ? running : failedRun })], offered: [] };
      if (url === apiPath(API_ROUTES.workspaceProjectCommandRuns, { wsId: WS, commandId: 'test' }) && method === 'POST') {
        state = 'running';
        return { run: running };
      }
      if (url === RUN_DETAIL) return state === 'running' ? detail({ run: running, items: [], parsed: false }) : detail();
      return undefined;
    };
    show();
    fireEvent.click(await screen.findByTestId('problems-run'));
    expect(await screen.findByTestId('problems-stop')).toBeTruthy();
    expect((screen.getByTestId('problems-announcement')).getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('problems-announcement').textContent).toBe('');
    state = 'failed';
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1300));
    });
    expect(await screen.findByTestId('problems-run')).toBeTruthy();
    expect((screen.getByTestId('problems-announcement')).textContent).toContain('Tests finished: 2 failures');
  });
});
