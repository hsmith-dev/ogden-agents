---
title: 'Problems: declared commands, trusted only, failures as file:line, Ask the agent to fix this'
type: 'feature'
ticket: '9'
created: '2026-11-01'
status: 'built'
baseline_revision: '9a2d544382b264aac548ad75363b6d22fd7c158c'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Problems (E8-R8, AD-38) has only 8.2's contracts: the five project-command routes answer 501, there is no runner, no parser and no panel, so a user can't run the project's test or lint command and jump from a failure to its line.

**Approach:** Core stores the project's declared commands on the workspace row, offers `package.json`'s `test` and `lint` scripts, runs a command only in a trusted project with its confirmed text (a detected script bound to its script text, asked again when it changed), through a new `project-commands-node` runner (argv, no shell, allowlisted env, process-tree kill on Stop and server stop); output is masked and parsed by six known formats into `file:line` items inside the project; a Workbench Problems panel runs, stops, shows output and items, opens an item in the viewer at its line, and "Ask the agent to fix this" fills a chat's composer draft without sending.

## Boundaries & Constraints

**Always:** every `ProjectCommands` method first resolves the workspace and refuses an untrusted one (409 `scripts_not_trusted`, using `bmadScriptTrust.scriptsTrusted`; nothing is detected or run before); a settings command is split with `splitCommandLine` into argv and refused (400 `invalid_request`, plain reason) when it needs a shell: `| & ; < > ( ) $ \``, a newline, a glob `* ? [`, a leading `~`, a `NAME=value` prefix, or `$`/`` ` `` inside double quotes; a program with a path separator that isn't absolute is refused; the program is resolved to an absolute file on the absolute `PATH` entries only and spawned with `shell: false`, `detached` on POSIX, stdin ignored, env = `baseEnvironment()` plus `CI=1`, `NO_COLOR=1`, `FORCE_COLOR=0` (never `process.env`, never a key); a `package_json` command runs `<pm> run <script>` (pm from the lockfile: pnpm, yarn, bun, else npm) and runs only while the script's current text equals the text the user confirmed (else 409 `command_changed`, and `list` shows it unconfirmed with the new text); output keeps the last 1 MiB (a cut first line dropped), ANSI stripped, masked with `redactSecrets` before parsing or answering; items capped at 500, messages and details masked; an item's path is made project-relative (an absolute path only when inside the project's real path), `..` or outside dropped, then `WorkspaceRelativePath`; parsers work line by line on lines cut to 4000 characters with no nested quantifiers; one run per command at a time; Stop and server stop kill the whole tree; a run longer than 30 minutes is killed (`error`); events stay ids, state, exit code and counts; UI strings have no em or en dashes; "Ask the agent to fix this" only writes a draft and navigates, never sends.

**Never:** a shell (`shell: true`, `sh -c`, `cmd /c`); `process.env` to the child; command output, a command's text or a path in an event or a log; running Windows `.cmd`/`.bat` shims (refused with a plain reason; deferred); editing files; the editor launcher (8.10); detectors beyond `test` and `lint`; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Untrusted | any of the five routes | nothing read or run | 409 `scripts_not_trusted` |
| Offer | trusted, `package.json` with `test`, `lint` | `offered` lists both with `script` and its text | none |
| Confirm offer | PUT with `confirmedScript` equal to the current text | stored, `workspace.project_commands_changed` | text differs: 409 `command_changed` |
| Script changed | stored `test`, package.json now different | `list` shows it `confirmed: false` with the new text; run refused, runner never called | 409 `command_changed` |
| Needs a shell | `npm test && npm run deploy`, `FOO=1 x`, `echo $HOME`, `rm *` | not stored | 400 with the plain reason |
| Run and fail | fixture command prints tsc output, exit 1 | `failed`, items `src/a.ts:12:5`; started and finished events, counts only | none |
| Outside paths | `/etc/passwd:1: x`, `../x.ts:3`, absolute path inside project | first two dropped, third made relative | none |
| Unread output | exit 1, no known format | `parsed: false`, raw masked output | none |
| Secret | output with `sk-ant-…` or `TOKEN=abc123` | `[redacted]` in output and messages | none |
| Stop | running, Stop | tree killed (child and grandchild gone), `stopped` | unknown run: 404 |
| Server stop | running | runner closed, tree killed | none |
| Hostile output | one 1 MiB line of `aaaa…(` and nested patterns | parse finishes in under 1 s | none |

</frozen-after-approval>

## Code Map

Project root is the worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/8.9`; run everything there; never `git stash`, push or switch branches, and do not commit (the orchestrator commits). The machine is loaded by parallel builds: re-run a timing failure alone. Other worktrees add migrations in parallel: take the next free number here.

- `packages/shared/src/project-commands.ts` (8.2 contract) -- extend: `ProjectCommand.script?`, `scriptText?`, `lastRun` (nullable); `ProjectCommandInput.script?`, `confirmedScript?`; `ProblemItem.detail?` (masked output lines, at most 20 lines / 2000 chars); texts (needs-shell reasons, changed script, Running, result lines, Ask buttons).
- `packages/shared/src/events-workbench.ts`, `events.ts` -- add `workspace.project_commands_changed` (`{count}` strict); `errors.ts` add `command_changed`.
- `packages/core/src/project-commands.ts` -- the contract (`ProjectCommandRunner.start({cwd, argv})`, add `close()`); implement `createProjectCommands`. Reuse: `bmad-script-trust.ts` (`scriptsTrusted`, `ScriptsNotTrustedError`), `planning.ts` `workspaceRepoPath`, `workspace-files-port.ts` `read`/`list` for `package.json` and lockfiles, `@ogden-agents/shared` `redactSecrets`, `newId`.
- `packages/core/src/project-command-parsers.ts` (new) -- the six formats; `packages/core/test/fixtures/problems/*` (real-looking outputs).
- `packages/core/src/db/schema.ts` workspaces `projectCommands` text `'[]'`, `pnpm --filter @ogden-agents/core db:generate`; `core.ts` option `projectCommandRunner` → `core.projectCommands` (undefined without it).
- `packages/adapters/src/project-commands-node/index.ts` (new) -- pattern of `toolchain-uv/script-runner.ts` (spawn options, `killProcessTree`, `close()`, error handlers); `acp-base/linked-command.ts` export `splitCommandLine` (already) and a `findProgram` wrapper over `resolveProgram`; `child-env.ts` `baseEnvironment`. `project-commands-memory` follows the new `argv` contract.
- `packages/server/src/workspace-files-routes.ts` `workbenchRefusal` -- map `ScriptsNotTrustedError` 409, `CommandChangedError` 409; `start.ts` wire the node runner, `createApp({projectCommands: core.projectCommands})`, close the runner in `shutdown` and on a failed start.
- `packages/web/src/workbench/workbench-problems.tsx`, `problems-api.ts` (new), `routes/workspace-workbench-page.tsx` (third tab), `router.tsx` `panel: 'problems'`; reuse `workspaces/script-trust-prompt.tsx` (`trustProjectScripts`), `chat/drafts.ts` (`chatDraftKey`, `newChatDraftKey`, `readDraft`, `writeDraft`), `workspaces/workspace-api.ts` `useSessions`, path links to `/w/$wsId/workbench?path=&line=`.
- Tests beside each: `packages/core/test`, `packages/adapters/test/process-tree.test.ts` style, `packages/server/test/workbench-routes.test.ts`, `gate.test.ts` unchanged list, `tests/e2e/workbench-problems.spec.ts`, `tests/architecture.test.ts` (spawn env rule already covers the new adapter).

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/project-commands.ts`, `events-workbench.ts`, `events.ts`, `errors.ts`, `index.ts` -- contract extensions above, the new event and code -- one contract for core, server and web.
- [x] `packages/core/src/project-command-parsers.ts` + fixtures -- `parseProblems(output, projectRoot)` → `{items, parsed}` for TypeScript (`a.ts(12,5): error TS…` and `a.ts:12:5 - error TS…`), ESLint (stylish and unix), Vitest (`❯ file:line:col` after a FAIL), Jest (`● …` then `at … (file:line:col)`), pytest (`file:line: Error` and `FAILED file::test - msg`), Go (`file_test.go:12: msg`, `./a.go:12:5: msg`), Rust (`--> file:line:col` after `error`, `panicked at file:line:col:`); dedupe; path containment -- the parser set.
- [x] `packages/core/src/project-commands.ts`, `shell-free.ts` (argv check), `db/schema.ts`, migration, `core.ts`, `index.ts`, `errors.ts` (`CommandChangedError`) -- the use-case per Boundaries: list, set, run (started/finished events, masked output and parsed items kept per command until the next run), get, stop, `close()`.
- [x] `packages/adapters/src/project-commands-node/index.ts`, `acp-base/linked-command.ts`, `project-commands-memory/index.ts`, `index.ts` -- the runner: resolve, spawn, 1 MiB tail, 30 min limit, Stop and `close()` kill the tree; plain words when a program isn't found or is a Windows script.
- [x] `packages/server/src/start.ts`, `workspace-files-routes.ts`, `app.ts` -- wiring, refusals, shutdown.
- [x] `packages/web/src/workbench/problems-api.ts`, `workbench-problems.tsx`, `routes/workspace-workbench-page.tsx`, `router.tsx` -- Problems panel: trust prompt with `PROBLEMS_UNTRUSTED_TEXT`; offer with each script's text, Use these / Not now (Not now kept in this browser); changed-script prompt; an inline Add a command form; rows with Run/Stop, last result, Show output; items grouped by file with path links and Ask the agent to fix this (latest chat, or Ask in a new chat); a polite live region announcing "Tests finished: 2 failures" once; poll the run while it runs.
- [x] Tests -- core: every matrix row with the memory runner, each fixture to its items, hostile-input timing, outside paths, masking; adapters: real `node` fixture child and grandchild killed on Stop and on `close()`, env has no planted key and no `process.env` extras, a shell-needing argv never reaches spawn, missing program's plain words; server: routes 409/400/404 and 202; web: unit test for the draft text and the panel states; Playwright `tests/e2e/workbench-problems.spec.ts`.

**Acceptance Criteria:**
- Given a trusted fixture project with a declared `node fail.js` command printing a TypeScript error for `src/a.ts:12`, when the user runs it in Problems and clicks the item, then the viewer opens `src/a.ts` with line 12 highlighted; axe finds nothing and a 390px page has no sideways scroll.
- Given a failure item, when Ask the agent to fix this is clicked, then the project's latest chat (or a new-chat draft) opens with the failure, its `file:line` and its output lines in the composer, and no message is sent.
- Given the change, when `pnpm typecheck` and `pnpm test` run, then both pass.

## Implementation Notes

- `splitCommandLine` moved from `adapters/acp-base/linked-command.ts` to `shared/src/command-line.ts` (core needs it and depends on no adapter); `linked-command.ts` re-exports it. `findProgram` (absolute `PATH` entries only, Windows scripts refused) sits beside `resolveProgram` there.
- `core/src/shell-free.ts`: `shellFreeCommand(line)` (the Boundaries list, plus an unclosed quote) and `argvShellRefusal(argv)`, which the node runner re-checks before spawn. A shell as the program (`sh`, `bash`, `cmd`, `pwsh`, ...) is refused too, so `sh -c '...'` (operators inside single quotes) can't slip through.
- `ProjectCommandInput.confirmedScript` absent on a `package_json` command keeps the confirmation already stored for that id and script (so saving another command never silently re-confirms a changed script); present, it must equal the script's current text (else `command_changed`). Its `command` must equal `<pm> run <script>` as detected now.
- The 30-minute limit lives in the runner (`error` with a plain sentence); a run that never started shows its plain reason as the output. After a normal exit the runner also kills what the command left in its process group, so a straggler can't hold the pipes open.
- `core.projectCommands` exists only with both a runner and a files port. The server closes it (finish recorded, then the runner) in shutdown, on a failed start, and the runner itself if start fails before listening. Migration `0040_romantic_fenris.sql` adds `workspaces.project_commands`.
- Seven formats (TypeScript, ESLint, Vitest, Jest, pytest, Go, Rust), as `ProblemFormat` names them; ESLint stylish keeps errors only.

- Review fixes (pass 1): a package.json script's confirmation is bound to the package manager, its pre, main and post texts, the `packageManager` field and the package-manager config files (through `projectFilesFingerprint`, since the files port refuses `.npmrc` as a credential file); wrapper programs (`env`, `sudo`, `nohup`, `xargs`, `find -exec`, ...) refused; draft and appended errors masked; synchronous `killAll` on process exit; every item carries its output lines; Windows drive paths parsed; `RUST_PANIC` anchored.
- Verified (after review fixes): `pnpm typecheck` clean; `pnpm test` 5718 passed, 13 skipped (440 files); `workbench-problems.spec.ts` and `workbench-files.spec.ts` passed after `pnpm run build`; provenance check passed.

## Deferred (for the sweep)

- Windows `.cmd`/`.bat` shims (`npm`, `pnpm`, `yarn` on Windows) are refused in plain words, so package.json scripts don't run on Windows yet; resolving npm's `npm-cli.js` through `node.exe` is the likely fix (E8-R11). (8.12: logged in `deferred-work.md`.)
- Check-then-use gap (security review 4): core checks the script binding, then the package manager reads `package.json` itself a moment later; an edit in that window runs unconfirmed text. Can't be closed while npm reads the file; a re-check after start that kills on a mismatch would narrow it. (8.12: logged in `deferred-work.md`.)
- AD-38 should say plainly that a detected `package.json` script runs through the package manager's own shell (Ogden never starts one itself); architecture note for the user. (8.12: logged in `deferred-work.md`.)
- Windows: after the main process exits normally, `taskkill /T` can't walk to grandchildren it left (security review 7, Windows half). (8.12: logged in `deferred-work.md`.)
- Go test failures print paths relative to the package folder, so a nested package's link can point at a file that isn't there. (8.12: logged in `deferred-work.md`.)
- Run history lives in memory only and is gone after a server restart. (8.12: logged in `deferred-work.md`.)
- `node -e`, `python -c`, `npx -y` stay allowed: the user typed and confirmed them and no shell interprets them; the refusal reasons don't promise more. (8.12: logged in `deferred-work.md`.)
- The list response returns a command's and script's text unmasked (the user's own settings, needed for exact-text confirmation); only the draft and output are masked. (8.12: logged in `deferred-work.md`.)

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lenses: quick, security). Verdicts: high 1, medium 7, low 10, false 0, maybe-false 0. No intent_gap or bad_plan: the binding fix is internal row storage with no new API surface; all patches sent to the implementer, the rest deferred above.

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| S1 | security | npm runs unconfirmed `pre`/`post` scripts | high | patch | reviewer reproduced `PRE-RAN` with the `test` text unchanged; the binding now covers pre, main and post |
| S2 | security | `.npmrc`/`.yarnrc.yml`/`bunfig.toml` change what runs | medium | patch | `workspaces=true` ran another package's script; config files join the binding |
| S3 | security | package manager re-derived from lockfiles, never stored | medium | patch | a new `yarn.lock` changed the shown command, still confirmed; pm stored and compared |
| S4 | security | check-then-use gap before npm reads package.json | low | defer | npm reads the file itself; deferred above |
| S5/Q3 | both | `env sh -c`, `nohup`, `xargs`, `sudo` wrappers and `rbash`/`yash` get past the shell check | medium | patch | `shellFreeCommand("env sh -c ...")` returned ok; wrappers refused, shells added |
| S6 | security | draft and appended error text not masked | medium | patch | `problemDraftText` used the raw command; `redactSecrets` over both |
| S7 | security | detached groups survive a server crash | medium | patch | `serve.ts` exits without closing; synchronous `killAll` on process exit. Windows grandchildren deferred |
| S8 | security | `RUST_PANIC` unanchored, re-parse on every poll | low | patch | 204 ms on 1 MiB; anchored, parse cached per output length |
| S9 | security | missing path test rows | low | patch | behaviour correct when probed; rows added |
| Q1 | quick | TS, ESLint, Go, Rust items have no `detail`, so the draft lacks output lines (AC 2) | medium | patch | Rust `Pending.lines` never filled; every format gets detail, e2e asserts it |
| Q2 | quick | a script over 2000 characters makes every list a 500 | medium | patch | `ProjectCommand.scriptText` max 2000 vs unbounded read; never offered, declared one unconfirmed |
| Q4 | quick | a cut first line kept when the tail has no newline | low | patch | `indexOf` -1 keeps all; dropped |
| Q5 | quick | Windows `C:\` paths never parsed | low | patch | path captures stop at the drive colon; optional drive prefix |
| Q6 | quick | Stop just after exit reports `stopped` | low | patch | `kill` overrides the real exit; exit code kept |
| Q7 | quick | ANSI stripper duplicated | low | patch | `stripTerminalEscapes` moved to shared |
| Q8 | quick | `close()` during `run()`'s awaits still starts | low | patch | `closed` re-checked after the awaits |
| D1 | impl | Windows shims refused | low | defer | deferred above |
| D2 | impl | Go package-relative paths | low | defer | deferred above |

## Design Notes

Trust: Problems uses the project trust flag (`scriptsTrusted`, AD-22 4.2) as AD-38 names; the content binding is the command's own (its text, or a detected script's text), not `_bmad/scripts/`' fingerprint, so a BMad script change doesn't stop Problems. Settings commands can change only through `PUT`, whose input must repeat the exact text. A `package_json` command is `npm`'s own script runner by design (AD-38 offers detected scripts): Ogden still never starts a shell itself.

Draft text (masked, from the item):

```
Fix this failure from npm run test:

src/wrap.ts:88 Expected 'a b' to equal 'a  b'

<detail lines>
```

appended after any existing draft with a blank line.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (wait for `uptime` load below 40; timing failures re-run alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/workbench-problems.spec.ts tests/e2e/workbench-files.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
