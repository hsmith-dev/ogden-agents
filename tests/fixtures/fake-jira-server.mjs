// @ts-nocheck
// The fake Jira Cloud REST server (epic 18, CAP-26): no real Jira, no network. Answers
// `GET /rest/api/3/myself` (the pre-save test call, AD-29), `GET /rest/api/3/search`
// (a fixture board's issues) and `POST /rest/api/3/issue/:key/transitions` (recorded, not
// applied to anything real), matching this repo's fake-server convention
// (tests/fixtures/fake-openai-server.mjs, fake-release-server/serve.mjs).
//
// Auth: Jira Cloud's own shape, `Authorization: Basic base64(email:token)`. The fixture's
// own `email`/`token` are the only credential that answers 200; anything else is 401,
// unless `tamper` says otherwise:
//   unauthorized    every call answers 401, as if the token were revoked
//   rate-limited    every call answers 429 with `Retry-After`
//   malformed       `/search` answers 200 with a body that is not valid Jira JSON
import http from 'node:http';

/** `Basic base64(email:token)` for the fixture's own credential, so a test can build the header it expects to send. */
export function basicAuthHeader(email, token) {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

export function startFakeJiraServer({ port = 0, host = '127.0.0.1', email = 'dev@example.com', token = 'fake-jira-token', accountId = 'fake-account-1', issues = [], tamper = null } = {}) {
  const log = [];
  const transitions = [];
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    res.on('error', () => {});
    req.on('error', () => {});
    let body = '';
    req.on('data', (d) => {
      body += d;
    });
    req.on('end', () => {
      let json = null;
      try {
        json = body ? JSON.parse(body) : null;
      } catch {
        // left null; a route that needs a body answers its own error.
      }
      const auth = req.headers.authorization ?? '';
      const path = req.url.split('?')[0];
      const authorized = auth === basicAuthHeader(email, token);
      log.push({ t: Date.now(), method: req.method, path, auth: auth ? 'basic-present' : 'none', authorized });
      const send = (code, obj, headers = {}) => {
        res.writeHead(code, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(obj));
      };

      if (path === '/__log') return send(200, { log, transitions });

      if (tamper === 'rate-limited') return send(429, { errorMessages: ['Rate limit exceeded'] }, { 'retry-after': '1' });
      if (tamper === 'unauthorized') return send(401, { errorMessages: ['Unauthorized'] });

      if (req.method === 'GET' && path === '/rest/api/3/myself') {
        if (!authorized) return send(401, { errorMessages: ['Unauthorized; scope does not match'] });
        return send(200, { accountId, emailAddress: email, displayName: 'Fake Jira User' });
      }

      if (req.method === 'GET' && path === '/rest/api/3/search') {
        if (!authorized) return send(401, { errorMessages: ['Unauthorized; scope does not match'] });
        if (tamper === 'malformed') return send(200, { not: 'the shape Jira search actually returns' });
        return send(200, { startAt: 0, maxResults: issues.length, total: issues.length, issues });
      }

      const transitionMatch = /^\/rest\/api\/3\/issue\/([^/]+)\/transitions$/.exec(path);
      if (req.method === 'POST' && transitionMatch) {
        if (!authorized) return send(401, { errorMessages: ['Unauthorized; scope does not match'] });
        transitions.push({ issueKey: transitionMatch[1], transitionId: json?.transition?.id, at: Date.now() });
        res.writeHead(204);
        return res.end();
      }

      return send(404, { errorMessages: [`fake Jira server: no route for ${req.method} ${path}`] });
    });
  });
  server.on('connection', (socket) => {
    socket.on('error', () => {});
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(port, host, () =>
      resolve({
        port: server.address().port,
        host,
        url: `http://${host}:${server.address().port}`,
        log,
        transitions,
        close: () => new Promise((r) => {
          for (const socket of sockets) socket.destroy();
          server.close(() => r());
        }),
      }),
    );
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('fake-jira-server.mjs')) {
  const s = await startFakeJiraServer({ port: Number(process.env.PORT ?? 0) });
  console.log(`fake Jira server on ${s.url}`);
}
