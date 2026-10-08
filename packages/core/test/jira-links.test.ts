/**
 * Linking a Jira board (epic 18, stories 3-4; CAP-26, AD-29): the token
 * alone goes to the keychain under `jira-credential/<workspaceId>`, the
 * site URL/email/base URL/project key are an ordinary settings row, the
 * site URL is checked (https, no redirect, no private-range target) before
 * any save, and only one board may be linked per workspace at a time.
 * Unlinking deletes the keychain entry immediately. No test reaches a real
 * keychain or the network.
 */
import { jiraCredentialName, type WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createJiraLinks, JiraAlreadyLinkedError, JiraUnauthorizedError, JiraUnreachableError, JiraUrlRejectedError, SecretsUnavailableError, ValidationError, type JiraLinkPort, type SecretStorePort } from '../src/index.js';
import { openDatabase } from '../src/db/database.js';
import { workspaces } from '../src/db/schema.js';
import { createEventLog } from '../src/event-log.js';
import { tempDir } from './helpers.js';

const WS1 = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W1' as WorkspaceId;
const WS2 = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W2' as WorkspaceId;

function memorySecrets(initial: Record<string, string> = {}): SecretStorePort & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    backend: 'memory',
    get: async (name) => values.get(name),
    set: async (name, value) => void values.set(name, value),
    delete: async (name) => void values.delete(name),
  };
}

function fakeJira(overrides: Partial<JiraLinkPort> = {}): JiraLinkPort {
  return { testConnection: async () => ({ baseUrl: 'https://my-team.atlassian.net' }), ...overrides };
}

const PUBLIC_LOOKUP = async () => [{ address: '8.8.8.8', family: 4 as const }];
const PRIVATE_LOOKUP = async () => [{ address: '10.0.0.5', family: 4 as const }];
const REQUEST = { siteUrl: 'https://my-team.atlassian.net', email: 'dev@example.com', token: 'fake-token-123', projectKey: 'ENG' };

const setUp = (jira: JiraLinkPort = fakeJira(), secrets: SecretStorePort = memorySecrets(), lookup = PUBLIC_LOOKUP) => {
  const db = openDatabase(tempDir());
  // The jira_link_changed event is workspace-scoped (a real foreign key): both workspaces this suite uses must exist first.
  for (const id of [WS1, WS2]) db.orm.insert(workspaces).values({ id, path: `/tmp/${id}`, createdAt: new Date().toISOString() }).run();
  const events = createEventLog(db);
  return { secrets, links: createJiraLinks({ db, events, secrets, jira, lookup }) };
};

describe('linking a Jira board', () => {
  it('saves the token to the keychain alone and the rest as a settings row', async () => {
    const { links, secrets } = setUp(fakeJira(), memorySecrets());
    const settings = await links.link(WS1, REQUEST);
    expect(settings).toMatchObject({ siteUrl: 'https://my-team.atlassian.net', email: 'dev@example.com', baseUrl: 'https://my-team.atlassian.net', projectKey: 'ENG', lastSyncedAt: null, lastSyncError: null });
    expect(await secrets.get(jiraCredentialName(WS1))).toBe('fake-token-123');
    expect(JSON.stringify(settings)).not.toContain('fake-token-123');
  });

  it('is read back by get()', async () => {
    const { links } = setUp();
    await links.link(WS1, REQUEST);
    expect(links.get(WS1)).toMatchObject({ siteUrl: REQUEST.siteUrl });
    expect(links.get(WS2)).toBeNull();
  });

  it('rejects a malformed request and saves nothing', async () => {
    const { links, secrets } = setUp();
    await expect(links.link(WS1, { siteUrl: 'https://x.com' })).rejects.toBeInstanceOf(ValidationError);
    expect(links.get(WS1)).toBeNull();
    expect(await secrets.get(jiraCredentialName(WS1))).toBeUndefined();
  });

  it('rejects a site URL the outbound guard refuses, before any test call or save', async () => {
    let called = false;
    const jira = fakeJira({
      testConnection: async () => {
        called = true;
        return { baseUrl: 'https://x' };
      },
    });
    const { links, secrets } = setUp(jira);
    await expect(links.link(WS1, { ...REQUEST, siteUrl: 'http://my-team.atlassian.net' })).rejects.toBeInstanceOf(JiraUrlRejectedError);
    expect(called).toBe(false);
    expect(links.get(WS1)).toBeNull();
    expect(await secrets.get(jiraCredentialName(WS1))).toBeUndefined();
  });

  it('rejects a site URL resolving to a private address, before any test call', async () => {
    const { links } = setUp(fakeJira(), memorySecrets(), PRIVATE_LOOKUP);
    await expect(links.link(WS1, REQUEST)).rejects.toBeInstanceOf(JiraUrlRejectedError);
  });

  it('saves nothing when the test call is unauthorized', async () => {
    const jira = fakeJira({
      testConnection: async () => {
        throw new JiraUnauthorizedError();
      },
    });
    const { links, secrets } = setUp(jira);
    await expect(links.link(WS1, REQUEST)).rejects.toBeInstanceOf(JiraUnauthorizedError);
    expect(links.get(WS1)).toBeNull();
    expect(await secrets.get(jiraCredentialName(WS1))).toBeUndefined();
  });

  it('saves nothing when the test call cannot be reached', async () => {
    const jira = fakeJira({
      testConnection: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const { links } = setUp(jira);
    await expect(links.link(WS1, REQUEST)).rejects.toBeInstanceOf(JiraUnreachableError);
  });

  it('refuses a second link for the same workspace', async () => {
    const { links } = setUp();
    await links.link(WS1, REQUEST);
    await expect(links.link(WS1, REQUEST)).rejects.toBeInstanceOf(JiraAlreadyLinkedError);
  });

  it('saves nothing in the settings row when the keychain refuses the token', async () => {
    const failingSecrets: SecretStorePort = {
      backend: 'memory',
      get: async () => undefined,
      set: async () => {
        throw new SecretsUnavailableError(undefined, { cause: 'no_access' });
      },
      delete: async () => {},
    };
    const { links } = setUp(fakeJira(), failingSecrets);
    await expect(links.link(WS1, REQUEST)).rejects.toBeInstanceOf(SecretsUnavailableError);
    expect(links.get(WS1)).toBeNull();
  });
});

describe('unlinking a Jira board', () => {
  it('deletes the keychain entry immediately and the settings row', async () => {
    const { links, secrets } = setUp();
    await links.link(WS1, REQUEST);
    await links.unlink(WS1);
    expect(links.get(WS1)).toBeNull();
    expect(await secrets.get(jiraCredentialName(WS1))).toBeUndefined();
  });

  it('does nothing for a workspace with no linked board', async () => {
    const { links } = setUp();
    await expect(links.unlink(WS1)).resolves.toBeUndefined();
  });
});
