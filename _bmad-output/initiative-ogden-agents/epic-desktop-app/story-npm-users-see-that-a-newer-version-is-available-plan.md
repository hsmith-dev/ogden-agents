---
title: 'npm users see that a newer version is available'
type: 'feature'
ticket: '7'
created: '2026-10-04'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['privacy', 'ux-a11y']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An npm user never learns a newer Ogden Agents exists (E13-R7). Nothing checks the registry.

**Approach:** Once per server start, and on a "Check now" button in Settings, About, the server (never the browser) reads npm's public dist-tags list for `ogden-agents`, compares it with its own version, and exposes the result through a small API and an event. The web shows a dismissible, polite banner with the update command for the install method, remembered per version in this browser. Settings, About shows the version, channel, last check and a switch for the start check, on by default.

## Boundaries & Constraints

**Always:**
- Privacy (AD-15, AD-16): the only request is one `GET https://registry.npmjs.org/-/package/ogden-agents/dist-tags` with `accept: application/json`, a 5 second timeout, no redirects followed, a capped body. No version, id, account, project or path in it. The check runs off the start path and never delays the page.
- Failures are silent: start logs one line with a code only; "Check now" says plainly it could not reach npm.
- Off by the switch (start check only; a click on "Check now" is the user asking) and by `OGDEN_AGENTS_OFFLINE` (any value but empty or `0`; then even Check now makes no request and says so).
- Tests never reach the network: the real client is used only when not a test run and not offline; tests inject a fake client through `StartOptions.updates`. No new `OGDEN_AGENTS_TEST_*` hook.
- A stable version is told only of a newer stable (`latest`). A prerelease version is told of the newest of `latest` and `next` above it. Version order is `compareVersions`.
- The notice is a polite `role="status"` banner, not a modal; no desktop notification, so notification settings are untouched. Plain language, no dashes in user text. The global command is shown, never run.

**Never:**
- Don't build 3's shell-mode service or the Tauri updater; don't add a start-scripts command (the notice says `npx ogden-agents@latest` until it lands).
- Don't send anything from the browser to npm; don't store a dismissal on the server.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stable, newer stable | v0.4.0, `latest` 0.5.0 | `available {0.5.0, latest}`; banner once per version | |
| Equal or older | v0.5.0, `latest` 0.5.0 or 0.4.9 | `available null`; no banner | |
| Prerelease | v0.5.0-rc.1, `latest` 0.5.0, `next` 0.5.0-rc.2 | offers 0.5.0 (the highest) | |
| Prerelease, only newer rc | `latest` 0.4.0, `next` 0.5.0-rc.2 | offers rc.2, tag `next` | |
| Stable ignores next | v0.4.0, `next` 0.5.0-rc.1 | nothing | |
| Switch off | enabled false | no request at start; Check now still works | |
| Offline env | `OGDEN_AGENTS_OFFLINE=1` | no request ever; About says so | |
| Unreachable, slow, bad JSON, huge body | | no banner, start logs a code | Check now: "Ogden could not reach npm. Try again later." |
| Dismissed | banner dismissed for 0.5.0 | stays hidden in this browser; 0.5.1 shows again | storage unavailable: shows each load |

</frozen-after-approval>

## Code Map

- Baseline: worktree `ogden-agents-wt-13.7` on `origin/preview/feedback` (PR #101), plus `origin/docs/epic-desktop-app` merged `--no-ff` (docs only; the merge conflicted in four planning docs, kept both sides).
- `packages/shared/src/semver.ts` -- `compareVersions`; add `decideUpdate(current, tags)` and `channelOf(version)` here (no imports).
- `packages/shared/src/updates.ts` (new), `api.ts`, `index.ts`, `events-settings.ts`, `events.ts` -- `UpdateNoticeResponse`, `SetUpdateCheckRequest`, `API_ROUTES.updates`/`updatesCheck`, event `settings.update_notice_changed`.
- `packages/server/src/update-check.ts` (new) -- the service: state file `<dataDir>/update-check.json` (`enabled`, `lastCheckedAt` only), injectable client, offline, event append.
- `packages/server/src/update-routes.ts` (new), `app.ts`, `start.ts`, `start-types.ts` -- routes behind the gate (tab token, Origin on writes); `StartOptions.updates`; run once after listening, off the start path (`void`). Install method from `launcherEntry` (`_npx` in path: npx; `node_modules`: global; else other).
- `packages/web/src/updates/update-api.ts`, `update-model.ts` (new) -- query + event invalidation, commands, dismissal storage (try/catch).
- `packages/web/src/shell/update-banner.tsx` (new), `app-shell.tsx`; `routes/about-page.tsx` (new), `router.tsx`, `status-sidebar.tsx` (About item).
- Reuse: `Banner`, `Field`, `Switch`, `Button`, `PageSection`, `useEventInvalidation`, `tabAuth`, `call`. Don't change `VersionBanner`, notifications, test-hooks.
- `scripts/smoke-installed.mjs`, `tests/e2e-installed` env -- set `OGDEN_AGENTS_OFFLINE=1` so the packaged server never calls npm in tests.

## Tasks & Acceptance

**Execution:**
- [ ] shared: `decideUpdate`, `channelOf`, schemas, routes, event; unit tests for the matrix
- [ ] server: `update-check.ts`, routes, wiring, `StartOptions.updates`; tests with a fake client (request shape, once per start, switch, offline, failure, timeout, size cap, manual check, event, install method)
- [ ] web: api, model, banner, About page, router, sidebar; vitest for the model, banner (dismiss per version) and About
- [ ] tests/e2e: banner shows, dismiss survives reload, About Check now, switch persists
- [ ] smoke and installed env offline; CHANGELOG line

**Acceptance Criteria:**
- Given a fake registry with a newer version, when the server starts, then `GET /api/v1/updates` reports it and exactly one request was made, with no query, body or identifying header.
- Given the switch is off, when the server starts, then no request is made.
- Given the banner is dismissed for a version, when the page reloads, then it stays hidden until a newer version appears.

## Implementation Notes

Open question from the ticket (timeout): settled by running off the start path with a 5 second timeout. Epic entry 7 depends on 3 (shell mode); this story is standalone and the service is shaped so 3 can gate it later.

## Plan Change Log

## Review Triage Log

Pass 1 (privacy, UX/a11y). Fixed: banner status region was mounted with its content (medium; now always mounted wrapper); comments over-claimed "nothing else" in the request (low; Node default headers and env proxy now stated); `offline` doc said no request at all (low; reworded). Real but accepted: no focus move after Dismiss (low); Check now result text can go stale (low); offline names the env var (low, users set it); no rate limit on the check route (low, token holders only, 5 s cap, concurrent calls coalesce); launcher tests rely on NODE_ENV only (low, safe); dismissal not synced across open tabs (low). False: label-in-name (met); no-dash text (commands excepted); gate on routes (gate test now lists them).

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` -- expected: green
