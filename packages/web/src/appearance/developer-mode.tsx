import { API_ROUTES, DeveloperModeResponse, type CoreEvent, type DeveloperModeResponse as DeveloperModeState } from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { call, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useEventInvalidation } from '@/events/use-event-invalidation';
import { useAppearance } from './appearance-provider';

/**
 * Developer mode (permission modes): an install setting the server keeps, so
 * it can gate a chat's Skip all and so turning it off drops every Skip-all
 * chat to Ask. The browser's appearance record keeps only a copy, for the
 * pre-paint boot script (`data-developer`) and the first render; the server's
 * value wins once it arrives, and every tab follows
 * `settings.developer_mode_changed`.
 */

export const DEVELOPER_MODE_QUERY_KEY = ['developer-mode'] as const;

/** Where this browser remembers that it already carried its old Developer mode over to the server (once). */
export const DEVELOPER_MODE_CARRIED_KEY = 'ogden-agents.developer-mode-carried';

const LOAD_FAILED = "Ogden Agents couldn't read Developer mode";
const SAVE_FAILED = "Ogden Agents couldn't save Developer mode";

/** `GET /api/v1/settings/developer-mode`: whether it is on, and whether it was ever set on this install. */
export async function fetchDeveloperMode(auth: Auth = tabAuth): Promise<DeveloperModeState> {
  return DeveloperModeResponse.parse(await call(auth, API_ROUTES.developerMode, {}, LOAD_FAILED));
}

/** `PUT /api/v1/settings/developer-mode`: turning it off drops every Skip-all chat to Ask. */
export async function saveDeveloperMode(developerMode: boolean, auth: Auth = tabAuth): Promise<boolean> {
  const json = await call(auth, API_ROUTES.developerMode, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ developerMode }) }, SAVE_FAILED);
  return DeveloperModeResponse.parse(json).developerMode;
}

/** The server's Developer mode (`undefined` while it loads). */
export function useServerDeveloperMode() {
  return useQuery({ queryKey: DEVELOPER_MODE_QUERY_KEY, queryFn: () => fetchDeveloperMode(), retry: false });
}

/** The query keys a Developer mode change makes stale: its own, and every open chat (its mode and picker). */
export const developerModeKeys = (event: CoreEvent) => (event.type === 'settings.developer_mode_changed' ? [DEVELOPER_MODE_QUERY_KEY, ['session']] : []);

/** Whether this browser has carried its old Developer mode over; a blocked storage reads as done (nothing to carry). */
function carried(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(DEVELOPER_MODE_CARRIED_KEY) === '1';
  } catch {
    return true;
  }
}

function markCarried(storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(DEVELOPER_MODE_CARRIED_KEY, '1');
  } catch {
    // Storage blocked: nothing was kept to carry anyway.
  }
}

const browserStorage = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/**
 * Keeps the appearance copy of Developer mode in step with the server's
 * (mounted once, inside the event stream). The first time a browser that had
 * it on before the server kept it meets a server that has it off, it turns it
 * on there (a one-time carry-over); after that the server alone decides.
 */
export function DeveloperModeSync({ auth = tabAuth, storage = browserStorage() }: { auth?: Auth; storage?: Storage | undefined }) {
  const { appearance, update } = useAppearance();
  const queryClient = useQueryClient();
  const server = useQuery({ queryKey: DEVELOPER_MODE_QUERY_KEY, queryFn: () => fetchDeveloperMode(auth), retry: false });
  useEventInvalidation(developerModeKeys);
  const carrying = useRef(false);
  const local = useRef(appearance.developerMode);
  local.current = appearance.developerMode;
  const density = useRef(appearance.density);
  density.current = appearance.density;
  /** Takes the server's value, keeping this tab's density (only the user's own switch moves it). */
  const follow = useCallback((developerMode: boolean) => update({ developerMode, density: density.current }), [update]);

  useEffect(() => {
    if (server.data === undefined) return;
    const { developerMode, everSet } = server.data;
    if (!carried(storage)) {
      // Once per browser, and only to an install where Developer mode was never set: an old browser-only
      // "on" is carried over, never an "off" over a server's "on", nor an "on" over a choice made elsewhere.
      if (local.current && !developerMode && everSet !== true && !carrying.current) {
        carrying.current = true;
        saveDeveloperMode(true, auth).then(
          (saved) => {
            markCarried(storage);
            carrying.current = false;
            queryClient.setQueryData(DEVELOPER_MODE_QUERY_KEY, { developerMode: saved, everSet: true });
          },
          () => {
            // Not carried (the server refused or is gone): the server's value stands.
            carrying.current = false;
            if (server.data !== undefined && local.current !== server.data.developerMode) follow(server.data.developerMode);
          },
        );
        return;
      }
      if (!carrying.current) markCarried(storage);
    }
    if (carrying.current) return;
    if (local.current !== developerMode) follow(developerMode);
  }, [server.data, storage, auth, queryClient, follow]);

  return null;
}
