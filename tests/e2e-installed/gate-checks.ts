/**
 * The security gate's negative checks (AD-15), one request per check: a
 * request without the tab token, or with a foreign Origin or Host, or to the
 * launcher endpoint without the launcher token. Each check names the status
 * the gate refuses it with, and the status the route answers when nothing
 * stops the request. `gate.spec.ts` requires every check to be refused by the
 * installed server; `bypass.spec.ts` sends every check through a fixture that
 * takes the gate out of the way and requires each to reach its route, so
 * every single check is shown to detect a missing gate.
 *
 * No check ever calls Quit or the uv install, so a gate that lets one through
 * does no harm.
 */
import { request as httpRequest } from 'node:http';
import { WebSocket } from 'ws';
import { API_ROUTES } from '../support.js';

export interface GateTarget {
  /** The base URL requests go to, `http://127.0.0.1:<port>`. */
  url: string;
  /** A valid tab token of the server behind it, for checks that need everything else right. */
  tabToken: string;
}

export interface GateCheck {
  name: string;
  /** The status the gate refuses this request with. */
  refused: 401 | 403;
  /** The status the route answers when the request gets past the gate (101: the upgrade succeeded). */
  open: 101 | 200 | 201 | 204;
  /** Sends the request and resolves with the status it got. */
  send(target: GateTarget): Promise<number>;
}

const LAUNCHER_HELLO = '/launcher/hello';
const LAUNCHER_TOKEN_HEADER = 'x-ogden-launcher-token';
const FOREIGN_ORIGIN = 'http://evil.example';

/**
 * Opens `/ws` offering `protocols` with `headers`; resolves with 101 (and the
 * chosen subprotocol) once the server switches protocols, or the refusal's status.
 */
export function upgrade(url: string, protocols: string[], headers: Record<string, string>): Promise<{ status: number; protocol?: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`, protocols, { headers });
    // `upgrade` fires on the 101 before the client checks the subprotocol, so a
    // server that answers a subprotocol the client didn't offer still counts as open.
    ws.once('upgrade', (res) => {
      const protocol = res.headers['sec-websocket-protocol'];
      resolve({ status: 101, ...(protocol === undefined ? {} : { protocol }) });
      ws.terminate();
    });
    ws.once('unexpected-response', (_req, res) => {
      resolve({ status: res.statusCode ?? 0 });
      res.resume();
      ws.terminate();
    });
    // After a resolve, errors (such as the terminate above) change nothing.
    ws.on('error', reject);
  });
}

/** A GET with a raw `Host` header, which fetch can't set. */
function getWithHost(url: string, path: string, host: string, headers: Record<string, string>): Promise<number> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path, method: 'GET', headers: { ...headers, host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.once('error', reject);
    req.end();
  });
}

const status = async (response: Promise<Response>) => (await response).status;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export const GATE_CHECKS: readonly GateCheck[] = [
  // API requests without the tab token (401).
  {
    name: `GET ${API_ROUTES.tabCheck} without a token`,
    refused: 401,
    open: 204,
    send: ({ url }) => status(fetch(`${url}${API_ROUTES.tabCheck}`)),
  },
  {
    name: `GET ${API_ROUTES.toolchain} without a token`,
    refused: 401,
    open: 200,
    send: ({ url }) => status(fetch(`${url}${API_ROUTES.toolchain}`)),
  },
  {
    name: `POST ${API_ROUTES.launchCodes} without a token, from the page's Origin`,
    refused: 401,
    open: 201,
    send: ({ url }) => status(fetch(`${url}${API_ROUTES.launchCodes}`, { method: 'POST', headers: { origin: url } })),
  },
  {
    name: `GET ${API_ROUTES.tabCheck} with a made-up token`,
    refused: 401,
    open: 204,
    send: ({ url }) => status(fetch(`${url}${API_ROUTES.tabCheck}`, { headers: bearer('A'.repeat(43)) })),
  },
  // WebSocket upgrades without the tab token (401).
  {
    name: 'a /ws upgrade offering only ogden.v1',
    refused: 401,
    open: 101,
    send: async ({ url }) => (await upgrade(url, ['ogden.v1'], { origin: url })).status,
  },
  {
    name: 'a /ws upgrade offering no subprotocol',
    refused: 401,
    open: 101,
    send: async ({ url }) => (await upgrade(url, [], { origin: url })).status,
  },
  // A foreign Origin, even with a valid token (403).
  {
    name: `POST ${API_ROUTES.launchCodes} from ${FOREIGN_ORIGIN}`,
    refused: 403,
    open: 201,
    send: ({ url, tabToken }) =>
      status(fetch(`${url}${API_ROUTES.launchCodes}`, { method: 'POST', headers: { ...bearer(tabToken), origin: FOREIGN_ORIGIN } })),
  },
  {
    name: `POST ${API_ROUTES.launchCodes} from another local port`,
    refused: 403,
    open: 201,
    send: ({ url, tabToken }) => {
      const port = Number(new URL(url).port);
      const origin = `http://127.0.0.1:${port === 65535 ? port - 1 : port + 1}`;
      return status(fetch(`${url}${API_ROUTES.launchCodes}`, { method: 'POST', headers: { ...bearer(tabToken), origin } }));
    },
  },
  {
    name: `POST ${API_ROUTES.launchCodes} with no Origin`,
    refused: 403,
    open: 201,
    send: ({ url, tabToken }) => status(fetch(`${url}${API_ROUTES.launchCodes}`, { method: 'POST', headers: bearer(tabToken) })),
  },
  {
    name: `a /ws upgrade from ${FOREIGN_ORIGIN}`,
    refused: 403,
    open: 101,
    send: async ({ url, tabToken }) => (await upgrade(url, ['ogden.v1', `ogden.auth.${tabToken}`], { origin: FOREIGN_ORIGIN })).status,
  },
  // A foreign Host, even with a valid token (403).
  {
    name: `GET ${API_ROUTES.toolchain} with Host evil.example`,
    refused: 403,
    open: 200,
    send: ({ url, tabToken }) => getWithHost(url, API_ROUTES.toolchain, `evil.example:${new URL(url).port}`, bearer(tabToken)),
  },
  // The launcher endpoint without the launcher token; no tab token opens it (401).
  {
    name: `GET ${LAUNCHER_HELLO} without a launcher token`,
    refused: 401,
    open: 200,
    send: ({ url }) => status(fetch(`${url}${LAUNCHER_HELLO}`)),
  },
  {
    name: `GET ${LAUNCHER_HELLO} with a wrong launcher token`,
    refused: 401,
    open: 200,
    send: ({ url }) => status(fetch(`${url}${LAUNCHER_HELLO}`, { headers: { [LAUNCHER_TOKEN_HEADER]: 'A'.repeat(43) } })),
  },
  {
    name: `GET ${LAUNCHER_HELLO} with a tab token`,
    refused: 401,
    open: 200,
    send: ({ url, tabToken }) => status(fetch(`${url}${LAUNCHER_HELLO}`, { headers: { ...bearer(tabToken), origin: url } })),
  },
];
