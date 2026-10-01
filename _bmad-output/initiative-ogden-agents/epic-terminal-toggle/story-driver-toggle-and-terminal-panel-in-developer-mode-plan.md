---
title: 'Driver toggle and terminal panel in Developer mode'
type: 'feature'
ticket: '6'
created: '2026-09-30'
status: 'built'
baseline_revision: 'fd31d93'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-terminal-toggle/epic-terminal-toggle.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 3.1 left a bare button and unstyled xterm panel: no designed toggle, availability reason, banner, `⌘.`, caption or peek, and the panel ignores 3.2's `attach`/`size` frames.

**Approach:** Build E3-R6 in the web package only, from 3.2's frozen contracts (`SessionTerminal` on GET session, refusal codes, socket frames, `origin: 'terminal'`).

## Boundaries & Constraints

**Always:** Developer mode is the only gate: with it off, no toggle and no shortcut. The toggle is visible in Developer mode; its Terminal segment is disabled (`aria-disabled`, still focusable so the tooltip shows) with a reason when the session is not `idle` (UI-derived) or `terminal.available === false` (`terminal.reason`, verbatim). The view flips only when `session.driver_changed` arrives; "Switching..." until then. `⌘.`/`Ctrl+.` is caught in the capture phase before xterm and works in both directions. Focus goes into xterm on switch to terminal and back to the composer on switch to chat. Bytes are never logged or stored in the browser. `?driver=terminal` mirrors the driver (replace navigation); opening that URL never switches by itself.

**Never:** Edit `packages/shared`, `server`, `core` (`chat.ts`, `core/src/chat/*` belong to 3.11/3.4/3.5), `adapters`, or `web/src/ui/*` (reuse `ToggleGroup`, `Tooltip`, `Banner`). No availability logic (3.7), no server reattach/buffer/size-follows-last logic (3.5), no Windows work (3.8).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Developer mode off | any | no toggle; `⌘.` does nothing | — |
| Not idle | `working`/`waiting`/queued | Terminal segment disabled, tooltip "Claude Code is busy. Switch when it is idle." | — |
| Unavailable | `terminal.available:false` | disabled, tooltip `terminal.reason` | — |
| Switch | idle, available, click or `⌘.` | "Switching...", then panel, focus in xterm, URL `?driver=terminal` | 409: reason shown, session refetched |
| Switch back | driver terminal, `⌘.` or Switch to Chat | transcript returns, composer focused | error inline |
| Reload while terminal drives | — | panel reattaches (`attach` with size first) | socket closed: "Reload to reconnect" |
| Other tab resized | `size` frame | xterm resizes to it | bad frame ignored |
| Terminal message | user message `origin:'terminal'` | "from terminal" caption | — |

- Decision (2026-10-01, user): screen-reader mode is a "Terminal screen-reader mode" switch in Settings → Appearance, off by default.
- Decision (2026-10-01, user): the read-only transcript peek is closed by default behind a "Show conversation" button (xl only); the read-only banner sits above the terminal panel.
- Decision (2026-10-01): plan kept whole.

</frozen-after-approval>

## Code Map

- `web/src/routes/session-page.tsx:87-90` driver from latest `session.driver_changed`; `:242-256` `switchTo`; `:266-288` 3.1's header buttons and panel/hidden `PageBody`; `:400-406` composer `blockedReason`; `:479` `Message`.
- `web/src/chat/chat-api.ts:44` `fetchSession` returns only `session` (sole caller session-page `:76`); `:60` `switchDriver`.
- `web/src/chat/transcript.ts:17` `TranscriptMessage` (add `origin`); `:211` leave the retry rule.
- `web/src/terminal/terminal-panel.tsx` 3.1 panel (reconnect on 1013, `onOpen` sends resize); `terminal-socket.ts:58-60` only `exit` handled, `size` TODO.
- `web/src/ui/toggle-group.tsx`, `tooltip.tsx`, `banner.tsx`; tokens `terminal`, `signal`.
- `web/src/appearance/appearance.ts` `developerMode`; `router.tsx:67` session route (add `validateSearch` for `driver`).
- `tests/e2e/terminal.spec.ts` (3.1; `withTerminalChat(page, developerMode, ...)`).
- `ChatApiError` (`web/src/api/http.ts`) has no `code`/`details`: on a 409 refetch the session instead of parsing details.

## Tasks & Acceptance

**Execution:**
- [x] `web/src/chat/chat-api.ts` -- `fetchSession` returns `{ session, terminal? }`.
- [x] `web/src/terminal/driver-toggle.tsx` (new) -- DESIGN.md Driver toggle: `ToggleGroup`, terminal glyph, "Switching...", `Tooltip` reason, `kbd` hint.
- [x] `web/src/terminal/use-driver-shortcut.ts` (new) -- capture-phase `keydown` for meta/ctrl+`.`, stops propagation.
- [x] `web/src/terminal/terminal-socket.ts` -- send `attach{cols,rows}` on open (not `resize`); handle `size` via `onSize`.
- [x] `web/src/terminal/terminal-panel.tsx` -- DESIGN.md Terminal panel; follow `size` frames; `screenReaderMode` per Open Question 1; focusable from the page.
- [x] `web/src/terminal/read-only-banner.tsx` (new) -- `Banner` "The terminal is driving this session." + "Switch to Chat" text button.
- [x] `web/src/chat/transcript.ts` -- carry `origin` onto `TranscriptMessage`.
- [x] `web/src/router.tsx` -- `validateSearch` accepting `driver: 'terminal'`.
- [x] `web/src/routes/session-page.tsx` -- `DriverToggle` replaces 3.1's buttons; refetch session on `driver_changed` and on turning `idle`; banner and peek per Open Question 2; composer reason "The terminal is driving this session" with Switch to Chat; "from terminal" `caption`; focus; URL sync.
- [x] `web/test/driver-toggle.dom.test.tsx`, `transcript.test.ts`, `terminal-socket.test.ts` (new) -- matrix rows; origin; frames.
- [x] `tests/e2e/terminal.spec.ts` -- the ticket's verify, the unavailable reason via a `page.route`-stubbed GET session.

**Acceptance Criteria:**
- Given Developer mode on and the terminal driving, when the user presses `Ctrl+.` with focus inside xterm, then the CLI receives no byte for it and the chat view returns.
- Given a screen reader user, when the terminal drives, then the read-only transcript stays reachable (peek or banner link) so no one depends on xterm.

## Implementation Notes

- Code Map re-checked against fd31d93 (after 3.11's chat split): every web line reference still held; nothing outside `packages/web` and `tests/e2e/terminal.spec.ts` changed.
- Open Question 1 (decided): `Appearance.terminalScreenReader` (`appearance.ts`, default off) with a "Terminal screen-reader mode" switch in Settings → Appearance (`appearance-page.tsx`); the panel passes it to xterm's `screenReaderMode` and updates it live.
- Open Question 2 (decided): `ReadOnlyBanner` above the panel with Switch to Chat and, at `xl` only, Show/Hide conversation (`aria-expanded`, closed by default, closes again on every driver change); the peek is the existing `PageBody` beside the panel.
- `terminal/terminal-pane.tsx` (new) holds the terminal-mode layout classes: `tests/design-tokens.test.ts` forbids visual utilities in `src/routes`.
- The Terminal segment's tooltip trigger is a wrapping `span`: as `asChild` on the item, Radix Tooltip's `data-state` replaced the segment's own `on`/`off`.
- `⌘.` while the Terminal segment is blocked shows the reason inline (`session-action-error`) instead of doing nothing silently.
- `switchingTo` clears on any driver change (including `cli_exited`), not just the requested one; a failed request clears it and, on 409, refetches the session.
- Test ids: segments keep 3.1's `switch-to-terminal` / `switch-to-chat`; the banner and composer buttons are `banner-switch-to-chat` / `composer-switch-to-chat`.

## Plan Change Log

## Review Triage Log

## Design Notes

- **Ownership:** `web/src/terminal/*`, `chat-api.ts`, `transcript.ts` (origin), `session-page.tsx`, `router.tsx` session route, `tests/e2e/terminal.spec.ts`, new web tests. 3.7 later appends to `driver-toggle.dom.test.tsx` only.
- `aria-disabled`, not `disabled`: Radix tooltips never open on a disabled button, and 3.1 already uses `aria-disabled`.
- Peek default: render the existing `PageBody` beside the panel at `xl` (read-only; composer already blocked) rather than a second transcript.


## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: green.
- `pnpm build && pnpm e2e` -- expected: green, `terminal.spec.ts` covers the ticket verify.

**Manual checks (if no CLI):**
- Light and dark themes: panel dark in both, signal top edge, tooltip reason readable; `⌘.` on macOS.
