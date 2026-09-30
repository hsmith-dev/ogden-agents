---
title: 'App shortcut to reopen Ogden Agents'
type: 'feature'
ticket: '2.4'
created: '2026-09-30'
status: 'built'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-epic-contracts-and-stubs-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** With per-tab tokens (AD-15 as amended), a bookmark can't reopen the app. E2-R10 needs a shortcut in the OS app menu.

**Approach:** Add a `shortcut-os` adapter for `AppShortcutPort` with no dependencies. It writes a per-user shortcut that runs `node <install>/bin/ogden.js`, and that launcher opens a fresh `/#c=` link. Fill the 2.3 routes, the first-run offer, the Appearance setting and the shortcut clause on the launch page.

## Boundaries & Constraints

**Always:**
- The shortcut runs only the launcher. It holds no URL, token, code, key or env value (AD-15, AD-16).
- It is per-user, needs no admin, and leaves no terminal open (AD-21):
  - macOS: `~/Applications/Ogden Agents.app`.
  - Windows: a `.lnk` in the user's Start Menu `Programs`, made with `powershell.exe` `WScript.Shell`. Paths go in as env vars and are never put into the script text.
  - Linux: `${XDG_DATA_HOME:-~/.local/share}/applications/ogden-agents.desktop`.
  - Paths are escaped for each format: sh, plist XML and `Exec`.
- `remove` deletes only our own files. On macOS, it checks the bundle's `CFBundleIdentifier` `dev.ogden-agents.launcher` first.
- Tests write only into temp dirs, through injected base dirs. Creating a shortcut on a real machine is hitl: a person approves first.

**Never:**
- New npm dependencies. `create-desktop-shortcuts` 1.12.0 (MIT, maintained) was checked and rejected: it uses VBScript on Windows and makes no `.app`.
- Dock preference or other system edits (the Dock is covered by a hint).
- A branded icon (no icon asset exists yet).
- Edits to `router.tsx`, `app.ts`, `api.ts`, `events.ts` or `chat-api.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Add | `POST /app-shortcut` on darwin, win32 or linux | 201 `installed:true`; the offer is no longer pending | — |
| Unsupported | another OS, or no launcher entry | 422 `shortcut_unsupported` | plain message |
| Add again | already installed | replaced in place, 201 | — |
| Remove | `DELETE /app-shortcut` | 204, files gone | 204 when already missing |
| Foreign bundle | an `Ogden Agents.app` that isn't ours | 422, and nothing is deleted | plain reason |
| Dismiss | `DELETE /app-shortcut/offer` | 204; `offerPending:false` survives a restart | — |
| Stale target | shortcut installed, server starts from another node/bin path | shortcut re-pointed at the current paths | failure logged, start continues |

## Decisions

- The shortcut pins `process.execPath` and this install's `bin/ogden.js`. On every start the server re-points an existing shortcut at the current paths, and never creates one (user, 2026-09-30).
- macOS uses `~/Applications` only, with a one-line hint to drag the app to the Dock. There are no Dock preference edits, and the ticket's "and Dock" is met by the hint (user, 2026-09-30).
- Windows runs `node.exe` with `WindowStyle=7` (minimized). A console sits in the taskbar for about a second (user, 2026-09-30).

</frozen-after-approval>

## Code Map

- `packages/core/src/app-shortcut-port.ts` -- add `offerDismissed` to the state, and `dismissOffer()`. The `shortcut-memory` stub mirrors them.
- `packages/shared/src/setup.ts:65` -- `AppShortcutStatus` stays unchanged. `offerPending` is `supported && !installed && !offerDismissed`.
- `packages/server/src/shortcut-routes.ts` -- four 501 stubs. `app.ts:162` already passes `{appShortcut, log}`.
- `packages/server/src/start.ts:151,361` -- the default wiring. `serve.ts` runs from `dist/`, so `../bin/ogden.js` is its sibling. `bin/ogden.js` `runForeground` calls `start()`.
- `packages/web/src/shell/app-shortcut-offer.tsx` and `appearance/app-shortcut-setting.tsx` -- `null` slots that are already mounted. `shell/open-ogden-agents.tsx` gets the clause (EXPERIENCE.md:108). Use `ui/notice.tsx` and `ui/field.tsx`. The query pattern to follow is in `workspaces/workspace-api.ts`.
- `packages/server/test/stub-routes.test.ts:25-28` -- the shortcut rows to delete. 2.6's rows are already gone. The plan is checked against `b8c3ff4` (2.6 on top of 2.5).

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/app-shortcut-port.ts`, `packages/adapters/src/shortcut-memory/index.ts` -- add `offerDismissed` and `dismissOffer`.
- [x] `packages/adapters/src/shortcut-os/{index,macos,windows,linux,escape}.ts` (new; exported from the index) -- `createOsAppShortcut({platform, launcherEntry, nodePath, stateDir, homeDir?, programsDir?, xdgDataHome?, runPowerShell?})`.
  - macOS writes `Info.plist` (with `LSUIElement`) and a `0755` `MacOS/ogden-agents` sh script: `exec '<node>' '<bin>'`, with output appended to `<dataDir>/logs/launcher.log`.
  - Windows sets `TargetPath=node.exe`, `Arguments="<bin>"` and `WindowStyle=7`.
  - Linux writes `Type=Application`, `Terminal=false` and the escaped `Exec`.
  - The offer flag lives in `<stateDir>/app-shortcut.json`.
- [x] `packages/server/src/shortcut-routes.ts` -- implement the four routes. They return `AppShortcutStatus`, map port errors to 422, and never log paths.
- [x] `packages/server/src/start.ts`, `serve.ts`, `bin/ogden.js` -- add a `launcherEntry?` option. `serve.ts` passes its sibling bin if it exists, and foreground passes its own file. With `launcherEntry` set, use `shortcut-os`; otherwise use the memory stub. After listening, if `status().installed`, call `add()` again to re-point it, off the start path, and log failures without paths.
- [x] `packages/web/src/appearance/app-shortcut-api.ts` (new) -- the query and the add, remove and dismiss mutations.
- [x] `packages/web/src/shell/app-shortcut-offer.tsx` -- an `info` Notice, "Open Ogden Agents from your apps menu next time.", with **Add shortcut** and **Not now**. Both clear the offer.
- [x] `packages/web/src/appearance/app-shortcut-setting.tsx` -- a Field "App shortcut" with Add or Remove, naming the OS location. On macOS, add the hint "To keep it in the Dock, drag Ogden Agents from Applications to the Dock." Hidden when unsupported. Errors show in a blocked Notice.
- [x] `packages/web/src/shell/open-ogden-agents.tsx` -- "Open Ogden Agents from its shortcut, or run … in a terminal."
- [x] Tests:
  - `packages/adapters/test/shortcut-os.test.ts`: all three writers into temp dirs. Cover paths with spaces, `'`, `"`, `$` and `%`, the foreign-bundle case, idempotence, and re-pointing to new paths. Assert path segments. `it.runIf` runs `plutil -lint` (darwin), a real `.lnk` read back through PowerShell (win32), and `desktop-file-validate` (when installed).
  - `packages/server/test/shortcut-routes.test.ts` (new): the matrix on the memory stub, plus gate 401 and 403.
  - `tests/e2e/app-shortcut.spec.ts` (new): offer, then Add, then Remove in Settings.

**Acceptance Criteria:**
- Given a first run on a supported OS, when the shell loads, then the offer shows. After Add or Not now it never shows again.
- Given an added shortcut and every browser window closed, when the shortcut is opened, then the app loads with a valid tab token and no terminal (hitl, on each OS).

## Implementation Notes

- `shortcut-os` has two small extra files: `refusal.ts` (`ShortcutRefusal`, the plain-words error the route shows; any other failure is wrapped in one, the original kept as `cause` so the log gets only its code) and `types.ts` (`ShortcutTarget`, `ShortcutWriter`).
- `POST /app-shortcut` also calls `dismissOffer()`, so after Add the offer never returns, even after a Remove (AC 1).
- Linux ownership: the `.desktop` file carries `X-Ogden-Agents-Launcher=true`; a file of the same name without it is never replaced or removed (422), as the macOS bundle-id check.
- macOS `add` is a no-op when the bundle already has the same plist and script, so the start-up re-point rewrites nothing unless a path moved. The bundle is built in a hidden sibling folder, then swapped in.
- Web: `callNoContent` in `chat-api.ts` is not exported and that file is off-limits, so `app-shortcut-api.ts` has its own small DELETE helper. The launch-page copy check in `tests/e2e/layout.spec.ts` was updated for the new clause.
- The e2e spec starts its own servers (memory stub: no launcher entry), so no test writes a shortcut and the shared server's offer is untouched.
- Verified on macOS: typecheck, test (plutil ran; the win32 `.lnk` and `desktop-file-validate` cases were skipped here), e2e, pack + smoke.

## Plan Change Log

## Review Triage Log

- **F1 (Windows ownership): fixed.** Install sets `Description = 'Open Ogden Agents'`. Before overwriting or removing, a fixed read script reads the link (base64 JSON on stdout, parsed). Any other Description is refused with 422 and the link is left alone. `isInstalled` means our link is there (`ShortcutWriter.isInstalled` is now async).
- **F2 (Windows start-up): fixed.** When TargetPath, Arguments and WorkingDirectory already match, nothing is rewritten. Scripts are one fixed line fed on stdin (`-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command -`), values stay in env vars, the timeout is kept, and PowerShell runs from `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` (fallback `C:\Windows`). The invocation and the skip-when-unchanged logic are unit-tested on every OS with an injected runner.
- **F3 (offer failures): fixed.** The adapter wraps `dismissOffer` failures in plain words. `POST` logs only the code when dismissing fails after a successful add, and still answers 201. `DELETE /offer` answers 422 with the plain message.
- **F4 (macOS swap): fixed.** The old bundle is renamed aside, the staging bundle renamed in, then the old one deleted. If the new one can't be moved in, the old one is moved back; the set-aside copy is kept if even that fails. The failure path is tested with an injected `rename`.
- **F5 (`%VAR%` expansion in the `.lnk`): rejected.** `process.execPath` and an npx cache path don't realistically contain `%NAME%` pairs.
- **Nit (export `callNoContent`): not applied.** The plan's frozen Never list forbids edits to `chat-api.ts`, so `app-shortcut-api.ts` keeps its small DELETE helper.

## Design Notes

- **Why `node <bin>` rather than `npx`.** It needs no registry lookup and no cmd quoting (the AGENTS.md Windows pitfall).
- **Gatekeeper.** A bundle written locally has no quarantine xattr, and a script executable needs no signature. The hitl check confirms this on a Mac.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass on the macOS, Windows and Linux CI legs.
- `pnpm build && pnpm e2e` -- expected: all pass.

**Manual checks (hitl):**
- A person approves before the shortcut is created on their machine. Then, on each OS: add it, close every browser window, open it from the app menu (on macOS: Spotlight or Launchpad, then drag it to the Dock as the hint says and open it from there), see a connected app with no terminal (on Windows, at most a minimized console for about a second), and remove it from Settings.
