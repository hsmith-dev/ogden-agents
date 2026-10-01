/**
 * The chat browser tests' shared setup: each test runs its own server with
 * the fake agent (`startServer`'s default) on a fresh data folder and project
 * folder, with the page connected through the server's launch link. A chat is
 * started the way the app's REST client starts one, with the tab's own token,
 * and then opened at its URL.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
// The shared routes' own file (it has no imports), as support.ts reads it.
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, makeDataDir, removeDataDir, startServer, type RunningServer, type StartOptions } from '../support.js';
import { openConnected, storedToken } from './tab.js';

export interface ChatServer {
  server: RunningServer;
  dataDir: string;
  /** The project folder (`ogden-agents-e2e-repo-…`). */
  repo: string;
  /** Another temp folder, removed with the rest when the test ends. */
  tempFolder(prefix: string): string;
}

export interface ChatServerOptions {
  /** Server options (such as `checkInDelayMs`). */
  extra?: StartOptions;
  /** Slows the fake agent's reply chunks, so the browser sees a reply stream in. */
  chunkDelayMs?: number;
  /** Files to write in the project folder, by `/`-separated relative path. */
  files?: Record<string, string>;
}

/**
 * Starts a server for this test, connects `page` at 1440×900, runs `body`,
 * then closes the server and removes every folder it made.
 */
export async function withChatServer(page: Page, body: (chat: ChatServer) => Promise<void>, options: ChatServerOptions = {}): Promise<void> {
  const folders = [makeDataDir()];
  const tempFolder = (prefix: string) => {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    folders.push(folder);
    return folder;
  };
  try {
    const dataDir = folders[0]!;
    const repo = tempFolder('ogden-agents-e2e-repo-');
    for (const [path, content] of Object.entries(options.files ?? {})) {
      const file = join(repo, ...path.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    const agentEnv = options.chunkDelayMs === undefined ? {} : { extraAgentEnv: { FAKE_ACP_CHUNK_DELAY_MS: String(options.chunkDelayMs) } };
    const server = await startServer(dataDir, 0, { ...agentEnv, ...options.extra });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openConnected(page, '/', server.launchUrl);
      await body({ server, dataDir, repo, tempFolder });
    } finally {
      await server.close();
    }
  } finally {
    for (const folder of folders) removeDataDir(folder);
  }
}

export interface StartedChat {
  wsId: string;
  sesId: string;
  /** The chat's page, `<origin>/w/:wsId/s/:sesId`. */
  url: string;
}

/**
 * Opens the project at `repo` and starts a chat in it through the REST API,
 * with the token of the connected tab `page`, then opens the chat there and
 * waits for it to be idle.
 */
export async function startChat(page: Page, repo: string): Promise<StartedChat> {
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token; connect it first');
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`POST ${path} returned ${response.status}: ${await response.text()}`);
    return response.json() as Promise<Record<string, { id: string }>>;
  };
  const wsId = (await post(API_ROUTES.workspaces, { path: repo })).workspace!.id;
  const sesId = (await post(apiPath(API_ROUTES.workspaceSessions, { wsId }), { kind: 'chat' })).session!.id;
  const url = `${origin}/w/${wsId}/s/${sesId}`;
  await page.goto(url);
  await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
  return { wsId, sesId, url };
}

/** The session view's composer. */
export const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Claude Code' });

/**
 * Sends `text` from the composer, as Enter does, and waits until the server
 * has taken it (the composer clears). Without that wait the next `send` can
 * land while this one is still on its way: the session can show `working`
 * before the POST returns, and an Enter while a send is in flight is ignored.
 */
export async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('');
}
