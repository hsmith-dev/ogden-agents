/**
 * Claude Code's session record read back (story 3.3): the turns of the
 * JSONL file under a temp `CLAUDE_CONFIG_DIR`, written by hand and by the
 * fake CLI (`tests/fixtures/fake-claude-cli.mjs`). Never the user's own
 * `~/.claude`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentError } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeConfigDir, MASKED, MAX_TRANSCRIPT_BYTES, parseClaudeTranscript, projectSlug, readClaudeTranscript } from '../src/index.js';

const FAKE_CLI = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-claude-cli.mjs');
const SESSION = '0b7c1e52-4d0a-4b8e-9a51-3c2f1d6e7a90';
const SECRET = 'sk-test-transcript-secret-91c2';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

/** A config folder and a working folder, and where the session's record goes. */
function setup() {
  const config = tempDir('ogden-agents-claude-');
  const cwd = tempDir('ogden-agents-repo-');
  const folder = join(config, 'projects', projectSlug(cwd));
  mkdirSync(folder, { recursive: true });
  return { config, cwd, folder, file: join(folder, `${SESSION}.jsonl`), env: { CLAUDE_CONFIG_DIR: config } };
}

let counter = 0;
/** A record as Claude Code writes one: chained to `parent`. */
const rec = (type: string, parent: string | null, content: unknown, extra: Record<string, unknown> = {}) => {
  const uuid = `r${++counter}`;
  return { parentUuid: parent, isSidechain: false, sessionId: SESSION, type, uuid, timestamp: '2026-10-01T00:00:00Z', message: { role: type === 'user' ? 'user' : 'assistant', content }, ...extra };
};
const jsonl = (...records: unknown[]) => records.map((record) => (typeof record === 'string' ? record : JSON.stringify(record))).join('\n') + '\n';

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AgentError);
    return (error as AgentError).details.code;
  }
  throw new Error('expected a rejection');
};

describe('parseClaudeTranscript', () => {
  it('keeps the user’s text and the joined reply text of each exchange, nothing else', () => {
    const u1 = rec('user', null, 'hello there');
    const meta = rec('user', u1.uuid, [{ type: 'text', text: 'Caveat: meta' }], { isMeta: true });
    const think = rec('assistant', meta.uuid, [{ type: 'thinking', thinking: 'hmm', signature: 's' }]);
    const t1 = rec('assistant', think.uuid, [{ type: 'text', text: 'Let me look.' }]);
    const tool = rec('assistant', t1.uuid, [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]);
    const result = rec('user', tool.uuid, [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'files' }]);
    const side = { ...rec('assistant', result.uuid, [{ type: 'text', text: 'sidechain' }]), isSidechain: true };
    const t2 = rec('assistant', result.uuid, [{ type: 'text', text: 'Found them.' }]);
    const command = rec('user', t2.uuid, '<command-name>/model</command-name>\n<command-message>model</command-message>');
    const output = rec('user', command.uuid, '<local-command-stdout>Set model</local-command-stdout>');
    const u2 = rec('user', output.uuid, [
      { type: 'text', text: '<system-reminder>internal</system-reminder>' },
      { type: 'text', text: 'second <system-reminder>x</system-reminder>question' },
      { type: 'image', source: {} },
    ]);
    const interrupted = rec('user', u2.uuid, [{ type: 'text', text: '[Request interrupted by user]' }]);
    const api = rec('assistant', interrupted.uuid, [{ type: 'text', text: 'API Error' }], { isApiErrorMessage: true });
    const t3 = rec('assistant', api.uuid, [{ type: 'text', text: 'Answer.' }]);
    const text = jsonl(
      { type: 'summary', summary: 'old', leafUuid: 'x' },
      u1,
      meta,
      'not json {',
      think,
      t1,
      tool,
      result,
      side,
      t2,
      { type: 'file-history-snapshot', messageId: 'm', snapshot: {} },
      command,
      output,
      u2,
      interrupted,
      api,
      t3,
      side,
    );
    expect(parseClaudeTranscript(text, [])).toEqual([
      { id: u1.uuid, role: 'user', text: 'hello there' },
      { id: u1.uuid, role: 'agent', text: 'Let me look.\n\nFound them.' },
      { id: u2.uuid, role: 'user', text: 'second question' },
      { id: u2.uuid, role: 'agent', text: 'Answer.' },
    ]);
  });

  it('follows the main chain from the newest record back, so a rewound branch is dropped', () => {
    const u1 = rec('user', null, 'one');
    const a1 = rec('assistant', u1.uuid, [{ type: 'text', text: 're one' }]);
    const abandoned = rec('user', a1.uuid, 'abandoned');
    const abandonedReply = rec('assistant', abandoned.uuid, [{ type: 'text', text: 're abandoned' }]);
    const u2 = rec('user', a1.uuid, 'two');
    const turns = parseClaudeTranscript(jsonl(u1, a1, abandoned, abandonedReply, u2), []);
    expect(turns.map((turn) => turn.text)).toEqual(['one', 're one', 'two']);
  });

  it('crosses a compaction boundary by its logical parent, and survives a cycle', () => {
    const u1 = rec('user', null, 'before');
    const boundary = rec('system', null, undefined, { subtype: 'compact_boundary', logicalParentUuid: u1.uuid });
    const u2 = rec('user', boundary.uuid, 'after');
    expect(parseClaudeTranscript(jsonl(u1, boundary, u2), []).map((turn) => turn.text)).toEqual(['before', 'after']);
    const a = { ...rec('user', 'cycle-b', 'a'), uuid: 'cycle-a' };
    const b = { ...rec('user', 'cycle-a', 'b'), uuid: 'cycle-b' };
    expect(parseClaudeTranscript(jsonl(a, b), []).map((turn) => turn.text)).toEqual(['a', 'b']);
  });

  it('masks the secrets in every text, and returns nothing for an empty or garbage record', () => {
    const u1 = rec('user', null, `my key is ${SECRET}`);
    const a1 = rec('assistant', u1.uuid, [{ type: 'text', text: `echo ${SECRET}` }]);
    expect(parseClaudeTranscript(jsonl(u1, a1), [SECRET]).map((turn) => turn.text)).toEqual([`my key is ${MASKED}`, `echo ${MASKED}`]);
    // Anthropic keys are redacted even when not in the environment, as the log's backstop does (review F4).
    const u2 = rec('user', null, 'try sk-ant-api03-AbC_dEf-123 please');
    expect(parseClaudeTranscript(jsonl(u2), []).map((turn) => turn.text)).toEqual([`try ${MASKED} please`]);
    expect(parseClaudeTranscript('', [])).toEqual([]);
    expect(parseClaudeTranscript('null\n42\n"text"\n{"type":"user"}\n[1]\n', [])).toEqual([]);
  });
});

describe('readClaudeTranscript', () => {
  it('reads the record the fake CLI wrote as the real one does: text only, chained, masked', async () => {
    const { config, cwd } = setup();
    const child = spawn(process.execPath, [FAKE_CLI, '--resume', SESSION], { cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: config }, stdio: ['pipe', 'pipe', 'ignore'] });
    child.on('error', () => {});
    let out = '';
    child.stdout.on('data', (data: Buffer) => (out += data.toString()));
    const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
    child.stdin.write(`first line\nkey ${SECRET}\n`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the fake CLI did not answer')), 15_000);
      const poll = setInterval(() => {
        if (out.includes(`echo:key ${SECRET}`)) {
          clearTimeout(timer);
          clearInterval(poll);
          resolve();
        }
      }, 20);
    });
    child.stdin.write('/exit\n');
    await exited;
    const turns = await readClaudeTranscript({ agentSessionId: SESSION, cwd, env: { CLAUDE_CONFIG_DIR: config, SOME_API_KEY: SECRET } });
    expect(turns.map(({ role, text }) => [role, text])).toEqual([
      ['user', 'first line'],
      ['agent', 'echo:first line'],
      ['user', `key ${MASKED}`],
      ['agent', `echo:key ${MASKED}`],
    ]);
    expect(turns[0]!.id).toBe(turns[1]!.id);
    expect(turns[2]!.id).not.toBe(turns[0]!.id);
  }, 30_000);

  it('is empty when the session, its project folder or the config folder has no record', async () => {
    const { cwd, env } = setup();
    expect(await readClaudeTranscript({ agentSessionId: SESSION, cwd, env })).toEqual([]);
    expect(await readClaudeTranscript({ agentSessionId: SESSION, cwd: join(cwd, 'elsewhere'), env })).toEqual([]);
    expect(await readClaudeTranscript({ agentSessionId: SESSION, cwd, env: { CLAUDE_CONFIG_DIR: join(cwd, 'missing') } })).toEqual([]);
  });

  it('refuses a session id that is not one, never reaching outside the project folder', async () => {
    const { cwd, env, folder } = setup();
    writeFileSync(join(folder, '..', 'escape.jsonl'), jsonl(rec('user', null, 'outside')));
    for (const id of ['../escape', '..', 'a/b', 'a\\b', '', '-rf', 'x'.repeat(200)]) {
      expect(await codeOf(readClaudeTranscript({ agentSessionId: id, cwd, env }))).toBe('transcript_bad_session_id');
    }
  });

  it('does not read a record over the size cap', async () => {
    const { cwd, env, file } = setup();
    writeFileSync(file, '');
    truncateSync(file, MAX_TRANSCRIPT_BYTES + 1);
    expect(await codeOf(readClaudeTranscript({ agentSessionId: SESSION, cwd, env }))).toBe('transcript_too_large');
  });

  it.skipIf(process.platform === 'win32')('refuses a symlinked record, or a project folder leading outside the projects folder, naming no path', async () => {
    const { cwd, env, file, config } = setup();
    const outside = tempDir('ogden-agents-outside-');
    const target = join(outside, 'secret.jsonl');
    writeFileSync(target, jsonl(rec('user', null, 'outside')));
    symlinkSync(target, file);
    const error = await readClaudeTranscript({ agentSessionId: SESSION, cwd, env }).catch((caught: unknown) => caught as AgentError);
    expect((error as AgentError).details.code).toBe('transcript_unsafe_path');
    expect(String((error as AgentError).message)).not.toContain(outside);

    const other = tempDir('ogden-agents-repo-');
    writeFileSync(join(outside, `${SESSION}.jsonl`), jsonl(rec('user', null, 'outside')));
    symlinkSync(outside, join(config, 'projects', projectSlug(other)));
    expect(await codeOf(readClaudeTranscript({ agentSessionId: SESSION, cwd: other, env }))).toBe('transcript_unsafe_path');
  });

  it.skipIf(process.platform === 'win32')('refuses a FIFO in place of the record without blocking on it (review F3)', async () => {
    const { cwd, env, file } = setup();
    execFileSync('mkfifo', [file]);
    expect(await codeOf(readClaudeTranscript({ agentSessionId: SESSION, cwd, env }))).toBe('transcript_unsafe_path');
  });

  it('finds a long folder’s record under the shortened slug Claude Code gives it', async () => {
    const { config } = setup();
    const cwd = `/${'deep-folder/'.repeat(20)}repo`;
    const folder = join(config, 'projects', `${projectSlug(cwd).slice(0, 200)}-abc123`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${SESSION}.jsonl`), jsonl(rec('user', null, 'long')));
    const turns = await readClaudeTranscript({ agentSessionId: SESSION, cwd, env: { CLAUDE_CONFIG_DIR: config } });
    expect(turns.map((turn) => turn.text)).toEqual(['long']);
  });

  it('uses CLAUDE_CONFIG_DIR, else .claude in the environment’s home folder', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/x/config', HOME: '/home/u', USERPROFILE: 'C:\\Users\\u' })).toBe('/x/config');
    const home = process.platform === 'win32' ? 'C:\\Users\\u' : '/home/u';
    const env: Record<string, string> = process.platform === 'win32' ? { USERPROFILE: home } : { HOME: home };
    expect(claudeConfigDir(env)).toBe(join(home, '.claude'));
  });
});
