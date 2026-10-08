// @ts-nocheck
// The fake Jira Cloud REST server (epic 18, CAP-26): no real Jira, no network. Answers
// `GET /rest/api/3/myself` (the pre-save test call, AD-29), `GET /rest/api/3/search`
// (a fixture board's issues, paginated, reflecting any transition applied since),
// `GET`/`POST /rest/api/3/issue/:key/transitions` (lists and applies, mutating the
// fixture issue's own status so a later `/search` sees it), and `GET /_edge/tenant_info`
// plus the `/ex/jira/<cloudId>/...` scoped-token gateway prefix (AD-29's base-URL
// resolution), matching this repo's fake-server convention
// (tests/fixtures/fake-openai-server.mjs, fake-release-server/serve.mjs).
//
// Auth: Jira Cloud's own shape, `Authorization: Basic base64(email:token)`. The fixture's
// own `email`/`token` are the only credential that answers 200; anything else is 401,
// unless `tamper` says otherwise:
//   unauthorized    every call answers 401, as if the token were revoked
//   rate-limited    every call answers 429 with `Retry-After`
//   malformed       `/search` answers 200 with a body that is not valid Jira JSON
//
// `scopedOnly: true` simulates a scoped token: every direct `/rest/api/3/...` call
// (not under the `/ex/jira/<cloudId>` gateway prefix) answers 401 regardless of auth,
// `/_edge/tenant_info` still answers with `cloudId`, and only the gateway-prefixed path
// accepts the real credential — exercising the scoped-token fallback in jira-client.ts.
//
// `transitions` (default: one shared set offered on every issue) maps either an issue
// key or, with no per-issue override, every issue, to the Jira transitions it may take;
// applying one updates that issue's own `fields.status.name` for every later `/search`
// or `/issue/:key/transitions` GET, as real Jira would. `setIssueField(key, patch)` on
// the returned server is a test-only backdoor (not a real Jira endpoint) for simulating
// a change made directly in Jira, independent of this adapter.
import http from 'node:http';

/** `Basic base64(email:token)` for the fixture's own credential, so a test can build the header it expects to send. */
export function basicAuthHeader(email, token) {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

const DEFAULT_TRANSITIONS = [
  { id: '11', name: 'Start Progress', to: { name: 'In Progress' } },
  { id: '21', name: 'Start Review', to: { name: 'In Review' } },
  { id: '31', name: 'Mark Done', to: { name: 'Done' } },
  { id: '41', name: 'Block', to: { name: 'Blocked' } },
  { id: '51', name: 'Back to Backlog', to: { name: 'To Do' } },
];

export function startFakeJiraServer({ port = 0, host = '127.0.0.1', email = 'dev@example.com', token = 'fake-jira-token', accountId = 'fake-account-1', issues = [], transitions: transitionsByIssue = {}, tamper = null, scopedOnly = false, cloudId = 'fake-cloud-id-1234' } = {}) {
  const log = [];
  const transitionCalls = [];
  const fieldUpdates = [];
  const issueLinks = [];
  const sockets = new Set();
  // A mutable working copy: applying a transition changes an issue's own status for every later read.
  const live = new Map(issues.map((issue) => [issue.key, JSON.parse(JSON.stringify(issue))]));

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
      const fullPath = req.url.split('?')[0];
      const query = new URL(req.url, 'http://x').searchParams;
      const gatewayMatch = /^\/ex\/jira\/([^/]+)(\/.*)$/.exec(fullPath);
      const gateway = gatewayMatch !== null;
      const path = gateway ? gatewayMatch[2] : fullPath;
      const authorized = auth === basicAuthHeader(email, token) && (gateway ? gatewayMatch[1] === cloudId : !scopedOnly);
      log.push({ t: Date.now(), method: req.method, path: fullPath, query: req.url.split('?')[1] ?? '', auth: auth ? 'basic-present' : 'none', authorized, gateway });
      const send = (code, obj, headers = {}) => {
        res.writeHead(code, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(obj));
      };

      if (fullPath === '/__log') return send(200, { log, transitions: transitionCalls, fieldUpdates, issueLinks });
      if (req.method === 'GET' && fullPath === '/_edge/tenant_info') {
        if (tamper === 'tenant-info-down') return send(404, { errorMessages: ['not found'] });
        return send(200, { cloudId });
      }

      if (tamper === 'rate-limited') return send(429, { errorMessages: ['Rate limit exceeded'] }, { 'retry-after': '1' });
      if (tamper === 'unauthorized') return send(401, { errorMessages: ['Unauthorized'] });

      if (req.method === 'GET' && path === '/rest/api/3/myself') {
        if (!authorized) return send(401, { errorMessages: ['Unauthorized; scope does not match'] });
        return send(200, { accountId, emailAddress: email, displayName: 'Fake Jira User' });
      }

      if (req.method === 'GET' && path === '/rest/api/3/search') {
        if (!authorized) return send(401, { errorMessages: ['Unauthorized; scope does not match'] });
        if (tamper === 'malformed') return send(200, { not: 'the shape Jira search actually returns' });
        const all = [...live.values()];
        const startAt = Number(query.get('startAt') ?? '0') || 0;
        const maxResults = Number(query.get('maxResults') ?? '50') || 50;
        const page = all.slice(startAt, startAt + maxResults);
        return send(200, { startAt, maxResults, total: all.length, issues: page });
      }

      const transitionsListMatch = /^\/rest\/api\/3\/issue\/([^/]+)\/transitions$/.exec(path);
      if (req.method === 'GET' && transitionsListMatch) {
        if (!authorized) return send(401, { errorMessages: ['Unauthorized; scope does not match'] });
        const key = transitionsListMatch[1];
        if (!live.has(key)) return send(404, { errorMessages: [`no issue ${key}`] });
        return send(200, { transitions: transitionsByIssue[key] ?? DEFAULT_TRANSITIONS });
      }
      if (req.method === 'POST' && transitionsListMatch) {
        if (!authorized) return send(401, { errorMessages: ['Unauthorized; scope does not match'] });
        const key = transitionsListMatch[1];
        const transitionId = json?.transition?.id;
        transitionCalls.push({ issueKey: key, transitionId, at: Date.now() });
        const issue = live.get(key);
        const available = transitionsByIssue[key] ?? DEFAULT_TRANSITIONS;
        const applied = available.find((t) => t.id === transitionId);
        if (issue && applied) issue.fields.status = { name: applied.to.name };
        res.writeHead(204);
        return res.end();
      }

      const issueMatch = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(path);
      if (req.method === 'PUT' && issueMatch) {
        if (!authorized) return send(401, { errorMessages: ['Unauthorized; scope does not match'] });
        const key = issueMatch[1];
        const issue = live.get(key);
        if (!issue) return send(404, { errorMessages: [`no issue ${key}`] });
        fieldUpdates.push({ issueKey: key, fields: json?.fields ?? {}, at: Date.now() });
        if (json?.fields?.summary !== undefined) issue.fields.summary = json.fields.summary;
        if (json?.fields?.description !== undefined) {
          // Jira Cloud v3 ADF in, plain text out for the fixture's own bookkeeping (real Jira keeps ADF; this fixture
          // only ever needs to answer with what it was given, so storing the plain text extracted here is enough).
          const adf = json.fields.description;
          issue.fields.description = (adf?.content ?? []).flatMap((block) => (block.content ?? []).map((n) => n.text ?? '')).join('');
        }
        res.writeHead(204);
        return res.end();
      }

      if (req.method === 'POST' && path === '/rest/api/3/issueLink') {
        if (!authorized) return send(401, { errorMessages: ['Unauthorized; scope does not match'] });
        issueLinks.push({ type: json?.type?.name, inward: json?.inwardIssue?.key, outward: json?.outwardIssue?.key, at: Date.now() });
        res.writeHead(201);
        return res.end();
      }

      return send(404, { errorMessages: [`fake Jira server: no route for ${req.method} ${fullPath}`] });
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
        transitions: transitionCalls,
        fieldUpdates,
        issueLinks,
        /** Test-only: simulates a change made directly in Jira (never a real Jira endpoint). `patch` is shallow-merged into the issue's `fields`. */
        setIssueField: (key, patch) => {
          const issue = live.get(key);
          if (issue) Object.assign(issue.fields, patch);
        },
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
