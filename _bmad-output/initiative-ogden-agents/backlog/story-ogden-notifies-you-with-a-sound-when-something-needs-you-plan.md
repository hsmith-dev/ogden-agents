---
title: 'Ogden notifies you, with a sound, when something needs you'
type: 'feature'
ticket: '8'
created: '2026-10-04'
status: 'built'
baseline_revision: '0d6255ad3da4197287744c7bc676bf794f6f6c04'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-ogden-notifies-you-with-a-sound-when-something-needs-you.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A permission request, a question, a quiet agent or a sign-in need sits unseen while the user is in another app or tab; Ogden only shows it in the sidebar and the tab title.

**Approach:** Widen the Needs you model with the two missing kinds (agent check-in, sign in needed), then add a browser-only notifier that watches that model and, for each new need, shows one desktop notification (one tab across all, chosen by a Web Locks leader) and plays a short synthesized chime, under a new Settings, Notifications page stored in this browser.

## Boundaries & Constraints

**Always:** Notification text names project, chat and kind only. Permission asked only from the Settings switch's click. Needs already present when a tab catches up are never notified. Sound never the only signal (the Needs you row and title count change too). User text plain, no dashes. Tests mock Notification, AudioContext and navigator.locks; no real agents, keychain or network.

**Never:** No server change or new event; no polling; no webhooks; no favicon; no quiet hours; no audio data URL (CSP `default-src 'self'` blocks media from data:).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New permission request, Ogden in background | leader tab, enabled, permission granted | one Notification ("Approval needed", "<project>: <chat>"), tag = need id, chime | none |
| Same need on re-render, other tab, reload | id already seen / not leader / present at catch-up | nothing | none |
| Ogden focused, "only when not focused" on | any Ogden tab visible and focused | no notification, no sound; Needs you still counts | none |
| Kind turned off | need of that kind | nothing for it | none |
| Permission denied or API missing | switch pressed | switch stays off, one sentence why; sound and Test sound still work | no throw |
| AudioContext missing or suspended | chime due | silent | caught |
| Click on notification | notification shown | window.focus(), route to /w/:wsId/s/:sesId, close | none |

</frozen-after-approval>

## Code Map

- `packages/web/src/shell/sidebar-model.ts` -- `NeedsYouEntry`, `buildSidebar`, `pendingRequests` fold (WeakMap per stream). Add `kind`, `chatTitle`; fold also `checkIn` and `errorCode` from `sessionView`. Keep `diffForAnnouncements` (new kinds have no `request`: never assertive), `holdOrder` unchanged.
- `packages/web/src/chat/transcript.ts` -- `sessionView` gives `checkIn`, `errorCode`, `state`. Read only.
- `packages/web/src/routes/session-page.tsx:53` -- check-in words ("has been quiet for 10 minutes"); reuse wording, never `waitingOn` (may hold a command).
- `packages/web/src/shell/live-announcer.tsx` -- tab title count from `model.needsYou.length`, `openSession`; pattern for a shell-mounted watcher that starts after `caughtUp`.
- `packages/web/src/shell/app-shell.tsx` -- mount the notifier beside `LiveAnnouncer`.
- `packages/web/src/shell/status-sidebar.tsx` `SettingsMenu` -- add Notifications item (Bell icon), fix its comment.
- `packages/web/src/router.tsx` -- add `/settings/notifications` lazily.
- `packages/web/src/appearance/appearance.ts` -- pattern for browser-saved preferences with parse/load/save and try/catch.
- `packages/web/src/routes/appearance-page.tsx` -- page layout with `Field`, `Switch`, `Notice`, `PageBody`.
- `packages/web/src/ui/*` -- only UI source; add `ui/slider.tsx` (native range, tokens) if no slider exists.
- `packages/server/src/gate.ts` CSP -- unchanged; reason for synthesized sound.
- `tests/e2e/sidebar.spec.ts`, `tests/e2e/chat-server.ts`, `tests/e2e/tab.ts` -- e2e helpers (`withChatServer`, `startChat`, `send` with 'permission').
- `_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md` -- Settings: Notifications row and Notifications settings row.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/web/src/shell/sidebar-model.ts` -- add `kind: 'permission'|'waiting'|'check_in'|'sign_in'` and `chatTitle` to `NeedsYouEntry`; add check-in entries (working, view.checkIn, id `check_in:<sesId>:<at>`) and sign-in entries (state error, errorCode `auth_required`, id `sign_in:<sesId>:<updatedAt>`) -- one Needs you source.
- [ ] `packages/web/src/notifications/notification-settings.ts` -- prefs type, defaults (enabled false, sound true, volume 0.6, all kinds, onlyWhenAway true), parse/load/save under one localStorage key, `useNotificationSettings` following `storage` events -- AC 8.
- [ ] `packages/web/src/notifications/notifier.ts` -- pure `notificationText(entry)` and `createNotifier(deps)`: seen set seeded at catch-up, kind filter, away rule, leader gate; deps inject Notification, chime, focus state, navigate -- AC 3, 4, 7.
- [ ] `packages/web/src/notifications/tab-presence.ts` -- leader via `navigator.locks` (fallback: leader), BroadcastChannel focus reports so the leader knows if any tab is focused -- AC 3, 4.
- [ ] `packages/web/src/notifications/chime.ts` -- two-note sine chime via AudioContext with gain = volume; no-op when missing -- AC 5.
- [ ] `packages/web/src/notifications/attention-notifier.tsx` -- shell component wiring model, caughtUp, settings, router -- AC 6.
- [ ] `packages/web/src/routes/notifications-page.tsx`, `router.tsx`, `status-sidebar.tsx` -- Settings, Notifications page and menu item -- AC 2, 5.
- [ ] `packages/web/test/*` -- unit tests (sidebar kinds, settings parse, notifier rules, text privacy), DOM test of the page with mocked Notification and AudioContext.
- [ ] `tests/e2e/notifications.spec.ts` -- stub Notification in an init script; turn on in Settings, a permission request in a background chat makes exactly one recorded notification across two tabs with safe text.
- [ ] `EXPERIENCE.md` -- record the page and behaviour.

**Acceptance Criteria:**
- Given the story's criteria 1 to 8, when the suites run, then each has a test.

## Implementation Notes

- Implemented directly in the build session (it already held the investigation), not by a separate implementation subagent.
- Needs you: `NeedsYouEntry` gained `kind` and `chatTitle`; `foldStream` replaces the permissions-only fold. A check-in stands while it is the session's latest event in the window and REST says `working` (sessionView drops `checkIn` when the window has no `working`). Sign in needed uses the `seq` of the latest move to `error` in its id, so a second expiry is a new need.
- Files: `packages/web/src/notifications/` (notification-settings, notifier, tab-presence, chime, desktop, attention-notifier), `routes/notifications-page.tsx`, `ui/slider.tsx` (Radix slider), router, Settings menu (Bell), app shell mount, EXPERIENCE.md.
- Surprise: the design-tokens test flags numeric JSX props (`min={0}`); the slider scale is a constant.
- Privacy: chat titles are null unless set at creation (no title is derived from message text on this branch), so "<project>: <chat>" carries no agent output.
- Tests: `packages/web/test/notifier.test.ts` (rules, privacy, settings parse, presence leader and focus, chime), `notifications.dom.test.tsx` (page, permission only from the switch, refusal, unsupported, cross-tab settings, click opens chat, quiet while in front), `sidebar-model.test.ts` (check-in and sign-in kinds), `tests/e2e/notifications.spec.ts` (two tabs, one notification and one chime, safe text, no repeat).

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, UX/a11y and privacy focus): high 2, medium 5, low 4, false 0, maybe-false 0; privacy check clean.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | pagehide reports a reloading focused tab as still focused; leader suppresses forever | high | patch | pagehide now reports `focused: false`; a new leader clears its map before `hello`; unit test added |
| 2 | needs in session lists that load after catch-up get notified | high | patch | notifier only notifies needs in chats the previous update already had (as `diffForAnnouncements`); unit test added |
| 3 | check-in trimmed from the live window past 2000 events drops the need | medium | defer | needs `trimWorkspaces` to keep a session's latest check-in; event-store change outside this story |
| 4 | `waiting` id is the bare session id, so a second wait is never notified | low | patch | id now `waiting:<sesId>:<updatedAt>` |
| 5 | Needs you rows of new kinds don't name the chat | low | reject | existing rows never name the chat and every title is null on this branch; the chat names story sets titles |
| 6 | every notification body says "Chat" | medium | reject | titles are null in core today (pre-existing); the body names the chat as soon as titles exist (chat names story) |
| 7 | check-in and sign-in had no screen reader announcement; sound could be the only signal | medium | patch | `diffForAnnouncements` says new check-in and sign-in needs assertively; unit test added |
| 8 | switch disabled while asking drops keyboard focus | medium | patch | no longer disabled while asking; presses ignored meanwhile; DOM assertion added |
| 9 | refusal notice mounted with its live region, not announced | medium | patch | `role="status"` wrapper always present; switch `aria-describedby` names the notice |
| 10 | page's permission state stale across tabs | low | patch | permission read on every render |
| 11 | leader may lack sticky activation, so the chime is silent | medium | patch (copy) + defer | copy now says sound plays only in a tab clicked since it opened; choosing an activated leader deferred |
| 12 | `sessionView` folded for every session on every delta | medium | patch | full fold only for waiting chats; working and error read the last events |

## Design Notes

Leader: `navigator.locks.request('ogden-agents-notify', () => new Promise(() => {}))` held for the tab's life; the next tab takes over when it closes. Each tab only notifies needs it saw arrive after its own catch-up, so a new leader never replays. "Focused" = `document.visibilityState === 'visible' && document.hasFocus()`, broadcast on focus, blur, visibilitychange and pagehide.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run pack && pnpm smoke` -- expected: pass
