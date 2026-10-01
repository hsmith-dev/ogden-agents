---
title: 'Terminal messages appear in the chat after switching back'
type: 'feature'
ticket: '3'
created: '2026-10-01'
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
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After switching back, turns typed in `claude --resume` never reach the transcript: `turnsToImport` is 3.2's stub and the adapter has no `transcript` (E3-R4, Done when 1).

**Approach:** The adapter reads Claude Code's session JSONL directly through `terminalResume.transcript`. Core marks the transcript's last turn when the terminal opens, and on switching back appends the turns after that mark as completed messages, the user's with `origin: 'terminal'`.

## Boundaries & Constraints

**Always:** Import only main-chain user text and the joined assistant text of each turn (no thinking, tool_use, tool_result, sidechain, `isMeta` or `<command-…>`/`<local-command-…>`/`<system-reminder>` wrappers). Mask with the adapter's `maskSecrets(text, secretValues(env))` (AD-16). Log codes and counts only, never text. Cap: file over 32 MiB is not read; at most 200 turns per switch back (the newest); each text cut at `MAX_MESSAGE_LENGTH`. Any failure logs a code and the switch completes. Imported turns are appended before `driver_changed` (3.2 order).

**Never:** ACP `session/load` replay; a new dependency (no Agent SDK import); new event types or shared-schema changes; edits to `web/*`, `session-page.tsx`, `transcript.ts`, the router (3.6), `terminal-socket.ts`, `terminal-pty/*` (3.5/3.8), recovery on restart or CLI exit (3.4).

## I/O & Edge-Case Matrix

| Scenario | State | Expected | Error |
|---|---|---|---|
| Typed 1 line | mark = last turn at open | user (`origin:'terminal'`) + agent reply appended once | — |
| No session file at open | mark `start` | every CLI turn imported | — |
| Mark missing (read failed at open) | no ref | turns after the last stored user message whose text matches; no match → none | code `terminal_import_unaligned` |
| Switch back twice / again later | mark advanced | nothing re-imported | — |
| CLI killed mid-reply | user record, no assistant text | user turn only | — |
| Unreadable / malformed line / >32 MiB | — | bad lines skipped; too large → none | code only, switch completes |
| Secret in env typed in terminal | — | `[redacted]` in event | — |

- Decision (2026-10-01, user): text only — imported turns carry user text and the joined assistant text; no tool-call summary.
- Decision (2026-10-01, user): over 200 turns, import the newest 200 preceded by an agent note "N earlier terminal messages were not imported".

</frozen-after-approval>

## Code Map

- `adapters/.../claude-code-agent.ts:218` -- `terminalResume`; add `transcript`. `mask.ts` `secretValues`, `maskSecrets`.
- claude-agent-acp 0.84.0 `dist/resumed-session.js` `findTranscript`: `${CLAUDE_CONFIG_DIR ?? ~/.claude}/projects/*/<id>.jsonl` (all project dirs). `acp-agent.js:1334-1352`: `session/resume` replays nothing; only `session/load` replays, from `getSessionMessages` (same file).
- JSONL record: `{type:'user'|'assistant'|'system'|…, uuid, parentUuid, sessionId, timestamp, isSidechain, isMeta?, message:{role, content: string | [{type:'text'|'tool_use'|'tool_result'|'thinking',…}]}}`; one assistant record per content block. Main chain = from the newest non-sidechain record back by `parentUuid` (SDK rule; survives `/rewind`).
- `core/src/agent-port.ts:196` `AgentTranscriptTurn` -- 3.3 owns this shape.
- `core/src/terminal-import.ts` -- stub to fill.
- `core/src/chat/terminal.ts` `toTerminal` (after `releaseAgent`, before `terminal.open`), `importTerminalTurns`, `toChat`. `entities.setSessionAdapterRefs` merges refs. `chat/constants.ts` `AGENT_SESSION_REF`.
- `tests/fixtures/fake-claude-cli.mjs`; `server/test/terminal-socket.test.ts:302` round trip (`extraAgentEnv`); `core/test/chat.test.ts:1814-1890` 3.2's hook tests.

## Tasks & Acceptance

**Execution:**
- [x] `core/src/agent-port.ts` -- `AgentTranscriptTurn` gains `id` (the turn's user record `uuid`) -- stable mark.
- [x] `adapters/src/acp-claude-code/transcript.ts` (new) -- `readClaudeTranscript({agentSessionId, env})`: find the file, size cap, line-parse, main chain, group per Matrix/Always, mask; missing file → `[]`. Wire as `transcript` in `claude-code-agent.ts`.
- [x] `core/src/terminal-import.ts` -- `turnsToImport(stored, turns, after?)` per Matrix (mark, `start`, fallback alignment, 200 cap, text cut).
- [x] `core/src/chat/constants.ts`, `chat/terminal.ts` -- `TERMINAL_IMPORT_REF`; at open save the last turn id or `start` (read failure: no ref, code logged); on switch back import, then set the ref to the last turn id.
- [x] `tests/fixtures/fake-claude-cli.mjs` -- with `CLAUDE_CONFIG_DIR` set, each answered line appends real-shaped user and assistant records (plus a `tool_use` and a sidechain record) to `projects/<cwd slug>/<resume id>.jsonl`.
- [x] Tests: `adapters/test/claude-transcript.test.ts` (shapes, chain, wrappers, masking, cap, bad lines); `core/test/terminal-import.test.ts` (Matrix); `core/test/chat.test.ts` (mark, twice, failing read still switches); `server/test/terminal-socket.test.ts` (fake ACP agent + fake CLI: typed line and reply appear once, earlier turns not duplicated, survive a reload via GET events).

**Acceptance Criteria:**
- Given a chat switched to the terminal where a marker line was typed, when switched back, then the next chat message resumes the same agent session and the marker text appears in no log file.

## Implementation Notes

- Adapter `acp-claude-code/transcript.ts`: reads only `<CLAUDE_CONFIG_DIR, else $HOME|%USERPROFILE%/.claude>/projects/<slug(cwd)>/<id>.jsonl` (the id must match the terminal's `SESSION_ID`, now exported). A cwd whose slug is over 200 chars matches the folder named `<slug[0..200]>-*` (Claude Code adds a hash this can't recompute). A symlinked file, or a project folder resolving outside `projects`, is refused (`transcript_unsafe_path`); opened with `O_NOFOLLOW` where available. Errors are `AgentError`s with `details.code` and no path. Main chain follows `parentUuid`, else `logicalParentUuid` (compaction), cycle-safe. Besides the listed wrappers, `<bash-…>` text, `[Request interrupted by user]`, `isCompactSummary`, `isVisibleInTranscriptOnly` and `isApiErrorMessage` records are skipped. An agent turn shares its user turn's id.
- Core `turnsToImport(stored, turns, after?)` now returns `{ turns, omitted, unaligned }`; a mark the record no longer holds (rewritten) falls back to alignment. `terminal.ts` reads at open after `releaseAgent` (empty ref on failure, so an older mark never lingers), imports on switch back, then moves the mark. Failures are logged through `onInternalError` as `TerminalImportError` (`terminal_import_unreadable` / `_unaligned` / `_failed`, plus the adapter's own code), never the adapter's error text.
- Not imported (deferred, review F9): turns after `/clear` or in a forked session (another session id), and a terminal `/rewind` of turns already imported.
- Server terminal tests always set a temp `CLAUDE_CONFIG_DIR`. The round-trip test's old "marker in no event/no data file" check became "in no log line and no log file" (the import puts it in the event log by design, as the acceptance criterion allows). `terminal.spec.ts` (e2e) only gained a temp `CLAUDE_CONFIG_DIR` (review F2).

## Plan Change Log

## Review Triage Log

Security review (coordinator, 2026-10-01): no blockers.

| ID | Finding | Decision | Change |
|---|---|---|---|
| F1 | A `start` mark on a chat that already has user messages can re-import the chat's own turns (the record was elsewhere at open). | Fixed | `turnsToImport` trusts `start` only when the chat has no user message; otherwise it lines up on the last one (core tests: start, chat A,B, CLI A,B,C → only C). |
| F2 | `terminal.spec.ts` let the reader probe the real `~/.claude`. | Fixed | The e2e sets a temp `CLAUDE_CONFIG_DIR`, removed afterwards. |
| F3 | Opening a FIFO or a swapped-in special file could block or read the wrong thing. | Fixed | Opened with `O_NOFOLLOW | O_NONBLOCK` where available; the opened handle must be a regular file (`transcript_unsafe_path`). FIFO test on POSIX. |
| F4 | Key-shaped secrets not in the agent's environment were imported unmasked. | Fixed | The log backstop's Anthropic key patterns moved to `@ogden-agents/shared` (`ANTHROPIC_KEY_PATTERNS`, `redactAnthropicKeys`), used by `log.ts` and by the reader after `maskSecrets`. They may over-redact a word on the line after a key, which is acceptable. |
| F8 | The data-folder scan was narrowed to logs. | Fixed | `terminal-socket.test.ts` scans every data-folder file for terminal-only strings (prompt, thinking, tool output, sidechain, the chat's own CLI-recorded reply). The server test now seeds the chat's exchange in the record, as the real agent leaves it. |
| F9 | `/clear`, `--fork-session` and `/rewind` in the terminal aren't imported/reflected. | Deferred | `deferred-work.md` entry (3.3 review F9). |

## Design Notes

Why (b): the adapter resumes first, and 0.84.0 advertises `session/resume`, which replays nothing; only `session/load` replays, and it reads the same JSONL through `getSessionMessages`, at the cost of starting the adapter and `claude` (sign-in needed), regrouping id-less chunks, and the adapter's `replaying` swallow. The cost of (b) is coupling to the file format; the reader drops unknown record types and bad lines rather than failing.


## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green; PTY tests skip with a reason if node-pty can't load.
- `pnpm build && pnpm e2e` -- expected: green, `terminal.spec.ts` unchanged.
