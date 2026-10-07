import { afterEach, expect, it } from 'vitest';
import { API_ROUTES, apiPath } from '@ogden-agents/shared';
import { startTestServer, signIn, type TestServer } from './helpers.js';
let server: TestServer;
afterEach(async () => { await server?.close(); });
it('round trips validated global MCP and skills behind the tab gate', async () => {
  server = await startTestServer();
  const tab = await signIn(server);
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  expect((await fetch(`${server.url}${API_ROUTES.globalSkills}`)).status).toBe(401);
  const servers = [{ name: 'local', command: 'node', args: [], env: [] }];
  expect((await request(API_ROUTES.globalMcpServers, 'PUT', { servers })).status).toBe(200);
  expect(await (await request(API_ROUTES.globalMcpServers)).json()).toEqual({ servers });
  expect((await request(API_ROUTES.globalMcpServers, 'PUT', { servers: [{}] })).status).toBe(400);
  for (const value of ['Token private-value', 'Digest private-value']) {
    const invalid = [{ name: 'remote', type: 'http', url: 'https://example.com/mcp', headers: [{ name: 'aUtHoRiZaTiOn', value }] }];
    const response = await request(API_ROUTES.globalMcpServers, 'PUT', { servers: invalid });
    expect(response.status).toBe(400);
    const error = await response.json();
    expect(JSON.stringify(error)).toContain('Bearer or Basic');
    expect(JSON.stringify(error)).not.toContain('private-value');
    expect(await (await request(API_ROUTES.globalMcpServers)).json()).toEqual({ servers });
  }
  const skill = { name: 'helper', content: 'Read carefully.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const path = apiPath(API_ROUTES.globalSkill, { name: skill.name });
  expect((await request(path, 'PUT', skill)).status).toBe(200);
  expect((await request(path, 'PUT', { ...skill, name: 'other' })).status).toBe(400);
  expect(await (await request(API_ROUTES.globalSkills)).json()).toMatchObject({ skills: [{ name: 'helper', content: 'Read carefully.' }] });
  expect((await request(path, 'DELETE')).status).toBe(200);
  expect(await (await request(API_ROUTES.globalSkills)).json()).toEqual({ skills: [] });
});
