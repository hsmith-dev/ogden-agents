/**
 * `core.agentLinkedCommands` (epic 12, entry 12): stores and retrieves each
 * agent's already-validated linked command, the same pattern as
 * `agent-models.ts`'s `defaultModel`.
 */
import type { LinkedCommandSpec } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { ValidationError } from '../src/index.js';
import { openTestCore, tempDir, TEST_AGENT_ID } from './helpers.js';

const SPEC: LinkedCommandSpec = { command: '/usr/local/bin/codex-acp' };

describe('core.agentLinkedCommands', () => {
  it('has none set for an agent that was never linked', () => {
    const core = openTestCore();
    expect(core.agentLinkedCommands.get(TEST_AGENT_ID)).toBeUndefined();
  });

  it('sets a linked command, reporting it changed, and reads it back', () => {
    const core = openTestCore();
    expect(core.agentLinkedCommands.set(TEST_AGENT_ID, SPEC)).toEqual({ linked: true, changed: true });
    expect(core.agentLinkedCommands.get(TEST_AGENT_ID)).toEqual(SPEC);
  });

  it('setting the same spec again reports unchanged', () => {
    const core = openTestCore();
    core.agentLinkedCommands.set(TEST_AGENT_ID, SPEC);
    expect(core.agentLinkedCommands.set(TEST_AGENT_ID, { ...SPEC })).toEqual({ linked: true, changed: false });
  });

  it('keeps the cwd and env fields exactly as given', () => {
    const core = openTestCore();
    const withExtras: LinkedCommandSpec = { command: 'grok agent --no-leader stdio', cwd: '/home/user/project', env: { FOO: 'bar' } };
    core.agentLinkedCommands.set(TEST_AGENT_ID, withExtras);
    expect(core.agentLinkedCommands.get(TEST_AGENT_ID)).toEqual(withExtras);
  });

  it('clears a linked command with null, reporting it changed; clearing again is a no-op', () => {
    const core = openTestCore();
    core.agentLinkedCommands.set(TEST_AGENT_ID, SPEC);
    expect(core.agentLinkedCommands.set(TEST_AGENT_ID, null)).toEqual({ linked: false, changed: true });
    expect(core.agentLinkedCommands.get(TEST_AGENT_ID)).toBeUndefined();
    expect(core.agentLinkedCommands.set(TEST_AGENT_ID, null)).toEqual({ linked: false, changed: false });
  });

  it('clearing an agent that was never linked is a no-op', () => {
    const core = openTestCore();
    expect(core.agentLinkedCommands.set(TEST_AGENT_ID, null)).toEqual({ linked: false, changed: false });
  });

  it('rejects a malformed agent id', () => {
    const core = openTestCore();
    expect(() => core.agentLinkedCommands.set('Not An Id!', SPEC)).toThrow(ValidationError);
  });

  it('keeps one agent\'s linked command separate from another\'s', () => {
    const core = openTestCore();
    core.agentLinkedCommands.set('codex', SPEC);
    expect(core.agentLinkedCommands.get('grok')).toBeUndefined();
    expect(core.agentLinkedCommands.get('codex')).toEqual(SPEC);
  });

  it('appends settings.agent_linked_command_changed only when it actually changed', () => {
    const core = openTestCore();
    core.agentLinkedCommands.set(TEST_AGENT_ID, SPEC);
    core.agentLinkedCommands.set(TEST_AGENT_ID, { ...SPEC });
    core.agentLinkedCommands.set(TEST_AGENT_ID, null);
    const events = core.events.readAfter(0).filter((event) => event.type === 'settings.agent_linked_command_changed');
    expect(events.map((event) => event.payload)).toEqual([
      { agentId: TEST_AGENT_ID, linked: true },
      { agentId: TEST_AGENT_ID, linked: false },
    ]);
  });

  it('survives reopening the database', () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir);
    core.agentLinkedCommands.set(TEST_AGENT_ID, SPEC);
    core.close();
    const again = openTestCore(dataDir);
    expect(again.agentLinkedCommands.get(TEST_AGENT_ID)).toEqual(SPEC);
  });

  it('a stored value that is valid JSON but not a LinkedCommandSpec reads as none, never throwing', () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir);
    core.agentLinkedCommands.set(TEST_AGENT_ID, SPEC);
    // Written directly, as a bug or a damaged row would leave it (core itself only ever writes a valid spec).
    const db = openDatabase(dataDir);
    try {
      db.sqlite.prepare('UPDATE agent_settings SET linked_command = ? WHERE agent_id = ?').run(JSON.stringify({ not: 'a linked command' }), TEST_AGENT_ID);
    } finally {
      db.close();
    }
    expect(core.agentLinkedCommands.get(TEST_AGENT_ID)).toBeUndefined();
  });
});
