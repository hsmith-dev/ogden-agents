/**
 * Turning the Unattended builds piece back on starts the runs that queued while it was off
 * (story 5.8 review): the settings route asks the builds to start what the free slots allow,
 * and only when the saved pieces include builds.
 */
import type { BuildsUseCases, Permissions } from '@ogden-agents/core';
import { API_ROUTES, apiPath, type WorkspaceSettings } from '@ogden-agents/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerWorkspaceRoutes } from '../src/workspace-routes.js';

const WS = 'ws_01HZZZZZZZZZZZZZZZZZZZZZZZ';

function routes(pieces: string[]) {
  const calls: string[] = [];
  const settings = { cautionLevel: 'ask_every_time', bmadPieces: pieces, bmadScriptsTrusted: false } as unknown as WorkspaceSettings;
  const permissions = { updateSettings: () => settings, getSettings: () => settings } as unknown as Permissions;
  const builds = { dispatchQueued: async () => void calls.push('dispatch') } as unknown as Pick<BuildsUseCases, 'dispatchQueued'>;
  const app = new Hono();
  registerWorkspaceRoutes(app, { permissions, builds, log: { info() {}, warn() {}, error() {}, debug() {} } as never });
  const patch = () => app.request(apiPath(API_ROUTES.workspaceSettings, { wsId: WS }), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bmadPieces: pieces }) });
  return { calls, patch };
}

describe('saving a project\'s pieces starts its queued builds', () => {
  it('asks the builds to dispatch when builds is on, and not when it is off', async () => {
    const on = routes(['board', 'builds']);
    expect((await on.patch()).status).toBe(200);
    expect(on.calls).toEqual(['dispatch']);
    const off = routes(['board']);
    expect((await off.patch()).status).toBe(200);
    expect(off.calls).toEqual([]);
  });
});
