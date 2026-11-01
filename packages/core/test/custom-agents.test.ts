/**
 * `core.customAgents` (epic 21, story 21.2; E21-R1, E21-R3): the custom
 * agents the user brings are kept install-wide, their key only in the secret
 * store, never in a row or an event; a variable name of every forbidden kind
 * is refused before anything is kept.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CustomAgentKeyEnvName } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { NotFoundError, SecretsUnavailableError, ValidationError, apiKeySecretName, type SecretStorePort } from '../src/index.js';
import { openDatabase } from '../src/db/database.js';
import { openTestCore, tempDir } from './helpers.js';

const KEY = 'sk-custom-dummy-key-7d41aa';
const AGENT = 'custom-my-agent';
const BODY = { displayName: 'My Agent', commandLine: '/usr/local/bin/my-agent --acp' };

function memorySecrets(): SecretStorePort & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    backend: 'memory',
    get: async (name) => values.get(name),
    set: async (name, value) => void values.set(name, value),
    delete: async (name) => void values.delete(name),
  };
}

const broken: SecretStorePort = {
  backend: 'broken',
  get: async () => Promise.reject(new SecretsUnavailableError()),
  set: async () => Promise.reject(new SecretsUnavailableError()),
  delete: async () => Promise.reject(new SecretsUnavailableError()),
};

const setUp = (secrets: SecretStorePort = memorySecrets()) => {
  const dataDir = tempDir();
  const core = openTestCore(dataDir);
  return { core, secrets, agents: core.customAgents(secrets), dataDir };
};

/** Every file under `dir`, the database included, as text. */
function allText(dir: string): string {
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .map((path) => (statSync(path).isDirectory() ? allText(path) : readFileSync(path).toString('latin1')))
    .join('\n');
}

const changes = (core: ReturnType<typeof openTestCore>) =>
  core.events.readAfter(0).flatMap((event) => (event.type === 'settings.custom_agent_changed' ? [event.payload] : []));

describe('core.customAgents', () => {
  it('creates, lists, updates and removes one, appending a change event for each', async () => {
    const { core, agents } = setUp();
    expect(agents.list()).toEqual([]);
    const created = await agents.create(AGENT, BODY);
    expect(created).toEqual({ agentId: AGENT, ...BODY, keyEnvName: null, hasKey: false });
    expect(agents.list()).toEqual([created]);
    expect(agents.get(AGENT)).toEqual(created);

    const renamed = await agents.update(AGENT, { displayName: 'Renamed' });
    expect(renamed).toEqual({ ...created, displayName: 'Renamed' });
    await agents.remove(AGENT);
    expect(agents.list()).toEqual([]);
    expect(changes(core)).toEqual([
      { agentId: AGENT, change: 'added' },
      { agentId: AGENT, change: 'updated' },
      { agentId: AGENT, change: 'removed' },
    ]);
  });

  it('keeps its key only in the secret store, never in the database or an event, and drops it on removal', async () => {
    const { core, agents, secrets, dataDir } = setUp();
    const created = await agents.create(AGENT, { ...BODY, apiKey: { envName: 'MY_AGENT_API_KEY', value: KEY } });
    expect(created).toMatchObject({ keyEnvName: 'MY_AGENT_API_KEY', hasKey: true });
    expect((secrets as ReturnType<typeof memorySecrets>).values.get(apiKeySecretName(AGENT))).toBe(KEY);
    expect(await agents.key(AGENT)).toEqual({ envName: 'MY_AGENT_API_KEY', value: KEY });

    await agents.update(AGENT, { apiKey: { envName: 'OTHER_API_KEY', value: `${KEY}-2` } });
    expect(await agents.key(AGENT)).toEqual({ envName: 'OTHER_API_KEY', value: `${KEY}-2` });
    await agents.update(AGENT, { apiKey: null });
    expect(await agents.key(AGENT)).toBeUndefined();
    expect((secrets as ReturnType<typeof memorySecrets>).values.size).toBe(0);

    await agents.update(AGENT, { apiKey: { envName: 'MY_AGENT_API_KEY', value: KEY } });
    await agents.remove(AGENT);
    expect((secrets as ReturnType<typeof memorySecrets>).values.size).toBe(0);
    expect(JSON.stringify(core.events.readAfter(0))).not.toContain(KEY);
    core.close();
    expect(allText(dataDir)).not.toContain(KEY);
  });

  it('refuses a key shorter than 8 characters, which output masking would miss', async () => {
    const { agents } = setUp();
    await expect(agents.create(AGENT, { ...BODY, apiKey: { envName: 'MY_AGENT_API_KEY', value: 'abc' } })).rejects.toBeInstanceOf(ValidationError);
    expect(agents.list()).toEqual([]);
  });

  it('refuses a bad body or an id already kept, keeping nothing', async () => {
    const { agents, secrets } = setUp();
    await expect(agents.create(AGENT, { displayName: '', commandLine: 'x' })).rejects.toBeInstanceOf(ValidationError);
    await expect(agents.create(AGENT, { ...BODY, apiKey: { envName: 'PATH', value: KEY } })).rejects.toBeInstanceOf(ValidationError);
    expect((secrets as ReturnType<typeof memorySecrets>).values.size).toBe(0);
    await agents.create(AGENT, BODY);
    await expect(agents.create(AGENT, BODY)).rejects.toBeInstanceOf(ValidationError);
    await expect(agents.update(AGENT, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(agents.update('custom-gone', { displayName: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(agents.remove('custom-gone')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('stores nothing when the keychain can not hold the key, and keeps an agent whose key can not be removed', async () => {
    const { agents } = setUp(broken);
    await expect(agents.create(AGENT, { ...BODY, apiKey: { envName: 'MY_AGENT_API_KEY', value: KEY } })).rejects.toBeInstanceOf(SecretsUnavailableError);
    expect(agents.list()).toEqual([]);

    const dataDir = tempDir();
    const core = openTestCore(dataDir);
    const secrets = memorySecrets();
    await core.customAgents(secrets).create(AGENT, { ...BODY, apiKey: { envName: 'MY_AGENT_API_KEY', value: KEY } });
    await expect(core.customAgents(broken).remove(AGENT)).rejects.toBeInstanceOf(SecretsUnavailableError);
    expect(core.customAgents(secrets).get(AGENT)).toBeDefined();
  });
});

describe('an id something still names stays reserved (epic 21 audit)', () => {
  it("is in use while a project's build default or team roster names it", () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    expect(core.entities.isAgentIdInUse('custom-reviewer')).toBe(false);
    core.close();
    const db = openDatabase(dataDir);
    db.sqlite.prepare('UPDATE workspaces SET orchestration_roster = ? WHERE id = ?').run(JSON.stringify({ reviewer: { kind: 'agent', agentId: 'custom-reviewer' } }), workspace.id);
    db.sqlite.prepare('INSERT INTO workspace_build_settings (workspace_id, default_build_agent_id) VALUES (?, ?)').run(workspace.id, 'custom-builder');
    db.close();
    const reopened = openTestCore(dataDir);
    expect(reopened.entities.isAgentIdInUse('custom-reviewer')).toBe(true);
    expect(reopened.entities.isAgentIdInUse('custom-builder')).toBe(true);
    // A longer id containing it is not the same id.
    expect(reopened.entities.isAgentIdInUse('custom-review')).toBe(false);
    expect(reopened.entities.isAgentIdInUse('custom-other')).toBe(false);
  });
});

describe('the key variable-name rule (E21-R3)', () => {
  it.each([
    ['allowlisted for every child', 'PATH'],
    ['allowlisted for every child', 'HOME'],
    ['a loader variable', 'NODE_OPTIONS'],
    ['a loader prefix', 'LD_PRELOAD_API_KEY'],
    ['a loader prefix', 'DYLD_INSERT_API_KEY'],
    ['lower case', 'my_agent_api_key'],
    ['not a key name', 'MY_AGENT_TOKEN'],
    ['starts with a digit', '1_API_KEY'],
    ['too long', `${'A'.repeat(60)}_API_KEY`],
  ])('refuses %s (%s)', (_kind, name) => {
    expect(CustomAgentKeyEnvName.safeParse(name).success).toBe(false);
  });

  it.each(['MY_AGENT_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY'])('takes %s', (name) => {
    expect(CustomAgentKeyEnvName.safeParse(name).success).toBe(true);
  });
});
