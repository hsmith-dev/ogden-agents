---
title: 'New chat in one step: g n, Cmd/Ctrl+N and header buttons'
type: 'feature'
ticket: '2'
created: '2026-10-31'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '147801c01aefefe089eee8e28dcc699229a9dc09'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-everyday-polish/epic-everyday-polish.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In a project that has chats, starting one takes two clicks (project name, then New chat), a chat's header has no New chat, there is no key for it, and New chat makes an empty chat at once even if nothing is ever sent (audit Project and chat list, top 10 #2; E26-R2).

**Approach:** A new-chat draft at `/w/:wsId/new` (empty area, composer focused, agent and machine pickers in the composer footer) that becomes a chat only on its first message; `g n` inside a project, the desktop app's File > New Chat (Cmd/Ctrl+N), a New chat icon button in every chat header and the Chats list's New chat all open it through one function.

## Boundaries & Constraints

**Always:** one opener (`openNewChat(wsId, pick?)`) that entry 3's palette can call; single-letter keys through `useGoKeys` (never while typing, in a dialog or menu); the draft's unsent text uses `newChatDraftKey(wsId)` (shared with the empty project's composer); a failed first send reuses the chat it made on retry (2.5 F6); existing DESIGN.md tokens, styling only in `src/ui`; no em or en dashes in UI strings; the page gets no Tauri IPC (AD-15): the shell only runs one fixed script that dispatches a DOM event.

**Never:** a server or core change; the composer setup row, permission-mode or model choice in the draft, Location (epic 27); `g n` or Cmd/Ctrl+N outside a project (entry 3's palette); a Help list (entry 5); intercepting Cmd/Ctrl+N in a browser tab; changing the empty project's Start a chat (still starts at once).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| g n in a chat | on `/w/W/s/S` | `/w/W/new`, composer focused | No error expected |
| g n on the draft | already on `/w/W/new`, focus elsewhere | composer focused again | No error expected |
| g n outside a project | on `/` or `/settings/...` | nothing | No error expected |
| Left unsent | draft opened, nothing sent, navigate away | no chat created; typed text kept as the draft | No error expected |
| First send | text in the draft, Enter | chat created with the picked agent and machine, message sent, chat opens | send fails: error shown, retry reuses that chat |
| Chats list New chat | agent B and machine M picked | `/w/W/new?agent=B&machine=M`, pickers show B and M | agent unavailable: reason shown, no navigation (as today) |
| Desktop menu | File > New Chat or Cmd/Ctrl+N in the app, inside a project | draft opens, window shown | outside a project: nothing |

</frozen-after-approval>

## Code Map

- `packages/web/src/router.tsx` -- add `workspaceNewChatRoute` (`/w/$wsId/new`, lazy, `validateSearch` keeps string `agent` and `machine`), register in `routeTree`.
- `packages/web/src/routes/workspace-chats-page.tsx` -- agent/machine/blocked logic (lines ~44-70), the unavailable status line and `ScriptTrustPrompt` (~145-175), empty composer `onSend` with `firstChat` ref (~218-228). Header New chat (`onNewChat`) navigates to the draft with the picks instead of `start()`. Keep `useStartChat` for Start a chat.
- `packages/web/src/chat/composer.tsx` -- `footer` prop (pickers), `autoFocus` on mount; `focusComposer` in `terminal/use-session-driver.ts:12`.
- `packages/web/src/chat/agent-picker.tsx` `AgentPicker`, `remote-machines/machine-picker.tsx` `MachinePicker` (value `RemoteMachineId | null`).
- `packages/web/src/shell/use-go-shortcuts.ts` -- `useGoKeys(bindings)`; `shell/needs-you-keys.tsx` is the pattern; `shell/app-shell.tsx` mounts it.
- `packages/web/src/routes/session-page.tsx` -- header children (~464-507); add the button before `SessionMenu`.
- `packages/desktop/src-tauri/src/ui.rs` -- `build_menu`, `on_menu`, `show_main`; `main.rs` test hooks (`OGDEN_DESKTOP_TEST_QUIT_FILE` pattern); `packages/desktop/scripts/smoke.mjs` (`readReport`, `waitFor`), `app-harness.mjs` `launchApp` env. No cargo here: Rust is checked in CI only.
- e2e specs that click `new-chat` and expect `/s/`: `workspaces.spec.ts` (113, 151, 161), `simple-project.spec.ts:44`, `agent-picker.spec.ts:82`, `agent-choice.spec.ts:36`, `remote-target.spec.ts:85`, `agent-trust-and-fixed-mode.spec.ts:55`; installed (not run): `tests/e2e-installed/{codex,agents,bmad,grok}-journey.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/chat/new-chat.ts` (new) -- `NEW_CHAT_EVENT`, `newChatTarget(wsId, pick?)`, `useOpenNewChat()` (navigate, then focus the composer).
- [x] `packages/web/src/chat/new-chat-agent.tsx` (new) -- extract `useNewChatAgent(wsId, initial?)` and `NewChatAgentStatus` (status line, trust prompt) from the Chats page; use in both pages.
- [x] `packages/web/src/routes/new-chat-page.tsx` (new) + `router.tsx` -- the draft: header "New chat" (Chats tab current), hint "Ask <agent> about this project.", composer with pickers in its footer, first send creates and opens the chat.
- [x] `packages/web/src/routes/workspace-chats-page.tsx` -- New chat opens the draft with the picks.
- [x] `packages/web/src/chat/new-chat-button.tsx` (new) + `session-page.tsx` -- outline icon button "New chat", tooltip `g n` in Developer mode.
- [x] `packages/web/src/shell/new-chat-keys.tsx` (new) + `app-shell.tsx` -- `g n` and `NEW_CHAT_EVENT` inside a project.
- [x] `packages/desktop/src-tauri/src/ui.rs`, `main.rs` -- File > New Chat (CmdOrCtrl+N); `new_chat` shows the window and evals `window.dispatchEvent(new Event('<NEW_CHAT_EVENT>'))`, reports `menu_new_chat`; test hook `OGDEN_DESKTOP_TEST_MENU_FILE`. `smoke.mjs` triggers it and waits for the report.
- [x] `packages/web/test/new-chat.test.ts` (new) -- target with and without picks; `ui.rs` dispatches exactly `NEW_CHAT_EVENT` and binds `CmdOrCtrl+N`.
- [x] `tests/e2e/new-chat.spec.ts` (new) -- the verify; update the specs in the Code Map to the draft (send the first message to create the chat; the fixed-mode test creates its chat by API).

**Acceptance Criteria:**
- Given an existing chat, when the user presses `g n`, clicks the header's New chat, or clicks the Chats list's New chat, then the draft opens with the composer focused, and leaving it unsent creates no chat.
- Given the draft, when the user sends "hello", then exactly one chat exists, opens, and shows the message.
- Given the page receives `NEW_CHAT_EVENT` inside a project, then the draft opens (the desktop accelerator's path).

## Implementation Notes

- `focusComposer` moved to `chat/focus-composer.ts` (re-exported from `terminal/use-session-driver.ts`), so the shell's `new-chat.ts` stays out of the session page's chunk.
- The header button's test id is `header-new-chat` (the Chats list keeps `new-chat`); its icon is `NotePencil`.
- `useNewChatAgent` falls back to the project default when the draft's `?agent=` names an agent the list doesn't have. The draft reuses the chat a failed first send made only while the agent and machine are unchanged.
- Desktop test hook: `OGDEN_DESKTOP_TEST_MENU_FILE` names a menu item id; the shell runs it through `on_menu`. The harness writes it with a rename (`chooseMenu`). Rust was not compiled here (no cargo); CI checks it.
- The e2e spec dispatches the event by its literal name (the root tsconfig can't import web sources); `new-chat.test.ts` pins `NEW_CHAT_EVENT` to that value and to `ui.rs`'s script.

- Review patch 3 first read the router's location with `useRouter`, which the mocked router in `session-page.dom.test.tsx` lacks (13 failures); it reads `window.location.pathname` instead (browser history, same value).
- Verification: `pnpm typecheck` clean; `pnpm test` 5129+ passed, the only failures were 5-second timeouts in adapters/server tests this change doesn't touch (load average ~260 from parallel builds): rerun alone, 11 files 166 tests passed, then `local-failures.test.ts` "slow first token" and one `build-worktrees.test.ts` case still timed out alone under that load; Playwright: new-chat, workspaces, simple-project, agent-picker, agent-choice, remote-target, agent-trust-and-fixed-mode, route-stubs, empty-project, composer-drafts, needs-you-rows: 26 passed, 2 (empty-project:56, workspaces:131) failed under load and passed on rerun alone; new-chat and simple-project rerun after the last fix: 5 passed; provenance passes. Rust not compiled (no cargo); the Desktop CI smoke runs File > New Chat.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, fresh subagent given the diff and code): 9 findings; medium 2, low 7, false 0, maybe-false 0.

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| 1 | A failed first send's chat is kept only in a ref: leaving and coming back, changing agent or machine, or a failed chat from the Chats page's composer leaves an empty chat behind | medium | defer: the same ref pattern predates this change on the Chats page (2.5 F6); keeping it across visits needs stored state (see Deferred) |
| 2 | `onSend` navigates to the new chat even after the user left the draft mid-send | medium | patch: navigate only while the draft is mounted |
| 3 | `useOpenNewChat` focuses the composer after every open, which can take focus from a dialog | low | patch: focus only when that draft was already open |
| 4 | `?agent=`/`?machine=` read once; picker changes don't update the URL | low | reject: by design (the picks it opened with); a reload restores the Chats list's pick, rare and harmless |
| 5 | The smoke's `ok` means the script was queued, not handled, and no project is open there | low | reject: recorded in Design Notes; Playwright covers the page's side and a unit test ties the strings |
| 6 | Windows WebView2 Ctrl+N unverified; the menu test hook ships in release builds and re-fires if remove fails | low | patch the re-fire (run only after removal); the release hook matches the existing quit-file hook; Windows is checked by the Desktop CI smoke |
| 7 | Outside-a-project e2e check fires the event and `g n` together, then sleeps | low | patch: separate checks, each with its own assertion |
| 8 | `chatCount` reads rows with a one-off `count()` | low | patch: a retrying count |
| 9 | Coverage gaps (404 draft, project switch reset, agent change after failure, fixed-mode via UI, regex over ui.rs) | low | reject: regex over the source is the only check without cargo; the rest are minor paths |

## Design Notes

Shell to page: AD-15 forbids IPC for the page, so the menu cannot call into it, and a page-handled Cmd/Ctrl+N would race the webview's own (WebView2 opens a window). The shell instead evaluates one constant script, `window.dispatchEvent(new Event('ogden-agents:new-chat'))`: one way, no capability, no data. The page listens always (inert in a browser, which never fires it). Any page script could fire it too; it only opens a draft.

The verify's "smoke opens the draft with the accelerator" is split: the desktop smoke drives the menu item through a test hook and checks the shell evaluated the script (no project exists there and the smoke cannot read the DOM); Playwright dispatches the same event and sees the draft; a unit test ties the Rust string to `NEW_CHAT_EVENT`.

## Deferred (for the sweep)

- Help lists Cmd/Ctrl+N as desktop only (entry 5 builds Help). (26.9: done by 26.3.)
- `g n` and Cmd/Ctrl+N outside a project open the palette on "New chat in..." (entry 3). (26.9: done by 26.3.)
- A failed first send's chat is remembered only while the draft (or the Chats page) stays open, so leaving and returning, or changing agent or machine, can leave that empty chat (review 1; pre-existing pattern). (26.9: logged in `deferred-work.md`, epic 27.)
- Choosing the permission mode before the first message in the draft (epic 27's setup row); until then the project's default applies. (26.9: logged in `deferred-work.md`, epic 27.)

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: full suite passes
- `pnpm run build && pnpm exec playwright test tests/e2e/new-chat.spec.ts tests/e2e/workspaces.spec.ts tests/e2e/simple-project.spec.ts tests/e2e/agent-picker.spec.ts tests/e2e/agent-choice.spec.ts tests/e2e/remote-target.spec.ts tests/e2e/agent-trust-and-fixed-mode.spec.ts tests/e2e/route-stubs.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
