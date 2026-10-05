---
title: 'Document cards and the next suggested step'
type: 'feature'
ticket: '7'
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
baseline_revision: '5e5cf8ede8d665100687b7da55ffaaf7d90dd997'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A planning session that writes a BMad document leaves no trace in the transcript but a tool-call row, so the user can't open it or take the next step (E4-R6, Flow 1 step 7). 4.2 froze `session.document_written` and `DOCUMENT_OPEN_LABEL`; nothing emits or renders them.

**Approach:** Core watches a planning session's completed write tool calls; a diff path that lies in the project's output folder (from `setupStatus().outputFolder`) and ends in `.md` emits `session.document_written` with the catalog's `next` for the skill that started the session. The session view folds it into a document card with **Open** (a read-only side sheet rendering the document's markdown safely) and the next step as a button that starts a planning session on `next.skill` with the document's path as the idea.

**Decisions (planning, autonomous, 2026-10-02):**
- Open (the epic's open question): a read-only side sheet; the server reads the file through the catalog adapter with path confinement; the web renders a safe markdown subset as React elements (no HTML injection, no new dependency). In-app editing stays epic 8.
- Next step (epic open question, settled by 4.5): the label mapping's `next` of the session's skill, through the catalog (so `next` names an installed skill only). No new label source (4.12 note).
- The session's skill: the catalog skill whose `agent.skillInvocation(name)` the session's first user message equals or starts with plus a space (longest match). Derived from stored messages, so it survives a restart; no new table.
- One card per path: the web keeps the latest write's card. Card title: the file name; path in mono caption.
- "Names the document": the next session's first message is `skillInvocation(next.skill, path)` via the existing `StartPlanningRequest {skill, idea: path}`; no request change.
- New appended shared contract: `API_ROUTES.workspaceDocument` (`GET …/documents?path=`, `planning`, no scripts) and `DocumentResponse`; 4.2 didn't pre-register it.

## Boundaries & Constraints

**Always:** Only `planning` sessions, only completed calls (a call that turns `completed`, once), only when Planning is on (guard; a refusal or failure emits nothing and logs). Lexical check in core (absolute path relative to the workspace's `realPath` or `path`; relative to the repo); `RepoRelativePath`-valid, `/`-separated. The read adapter: real path inside the repo's real path and inside the output folder's real path, regular file opened `O_NOFOLLOW|O_NONBLOCK`, `.md`, at most `MAX_DOCUMENT_BYTES` (1 MiB; longer is cut with `truncated: true`). Texts in `shared` (append-only, no em/en dashes). Buttons: next step ink primary, Open outline; failures say why inline; sheet has a title, Esc closes, focus returns. Markdown: headings, paragraphs, lists, fenced/inline code, emphasis, quotes, rules; links as plain text; raw HTML as text; frontmatter hidden.

**Never:** No change to frozen shapes (`session.document_written`, `StartPlanningRequest`), no migration, no new dependency, no watcher (8's), no write to the repo. Core does no file IO. Don't touch the board files or 4.10's `PUT …/status`; edits to shared files, `plan-and-board.spec.ts`, `gate.test.ts` and the fake agent append-only. Tests never run real `claude`, uv, the keychain or the network, nor read the real `~/.claude`; test hooks only via `testHooksAllowed`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Spec written | `bmad-spec` session; completed edit, diff `<repo>/_bmad-output/specs/spec-x.md` | one event `{path, toolCallId, next: {bmad-ticket, "Turn this spec into tickets"}}`; card with Open + button | — |
| Outside / not md | `src/x.md`, `_bmad-output/tickets.toml`, `../x.md` | no event | — |
| Not completed / chat | in_progress or failed; kind `chat` session | no event | — |
| No next | skill without `next`, or no skill matched | event `next: null`; card with Open only | — |
| Planning off / no output folder | guard refuses / `outputFolder: null` | no event | logged |
| Rewrite | same path twice | two events, one card (latest) | — |
| Reload | page reload | card still shown | — |
| Next button | click | new session, first message `/bmad-ticket <path>` | inline error |
| Open | in output folder | sheet with rendered markdown | 404 missing; 400 outside folder, not `.md`, malformed; link escaping folder → 404 |

</frozen-after-approval>

## Code Map

- `packages/core/src/chat/turns.ts` `apply` (`tool_call`, `tool_call_update` cases) -- call a new optional `ChatOptions.onToolCallCompleted?(sessionId, toolCallId, diffs)` when the call's status becomes `completed` (not when it already was); wrap in try/catch. `chat/types.ts` `ChatOptions` (beside `onAgentError`).
- `packages/core/src/planning.ts` -- `createPlanning`, `workspaceRepoPath`; add `document(workspaceId, path)` use-case (guard, `RepoRelativePath`, inside `outputFolder`, `.md`, then the port). New `packages/core/src/planning-documents.ts` for the detector (`createPlanningDocuments({bmad, entities, catalog, agent, sessionEvents, onError})`); export from `index.ts`.
- `packages/core/src/bmad-catalog-port.ts` -- add `readDocument(repoPath, path): Promise<{content, truncated} | null>`; implement in `packages/adapters/src/bmad-catalog/index.ts` (+ new `document.ts`, reuse `inside`, `realRepoRoot`, `readHead` pattern from `skills.ts`) and `catalog-memory/index.ts` (a `documents` option).
- `entities.listCompletedMessages(sessionId)`, `entities.getSession` (kind), `AgentPort.skillInvocation`.
- `packages/server/src/start.ts:412-426` -- create the detector before `createChat`, pass `onToolCallCompleted`; log failures (no paths). `planning-routes.ts` -- `routes.get('planning', API_ROUTES.workspaceDocument, …, { projectScripts: false })`; `ValidationError` → 400. Update `test/gate.test.ts` route list.
- `packages/shared/src/api.ts` (append route), `planning.ts` (append `MAX_DOCUMENT_BYTES`, `DocumentResponse {document: {path, content, truncated}}`, card/sheet texts).
- `packages/web/src/chat/transcript.ts` -- `TranscriptItem` `{type:'document', path, next, toolCallId, at}`; one per path. `routes/session-page.tsx` (`itemKey`, item map) -- render `DocumentCard`.
- New `packages/web/src/planning/document-card.tsx`, `document-sheet.tsx` (pattern `ticket-sheet.tsx`, `ui/sheet.tsx`), `ui/markdown.tsx`; `planning-api.ts` (`startPlanningSession`, add `useDocument`).
- `tests/fixtures/fake-acp-agent.mjs` -- append `write-doc <relpath>`: write a small markdown file under the session cwd, an `edit` tool call then a `completed` update with a diff of its absolute path; reply "Wrote <relpath>.".
- Tests: core beside `planning`; `packages/adapters/test/bmad-catalog*.test.ts`; `packages/server/test/planning-routes.test.ts`; `web/test/*.dom.test.tsx`, transcript test; e2e new `tests/e2e/document-cards.spec.ts` (real catalog, `SET_UP`/`moduleFiles` pattern from `plan-and-board.spec.ts:395`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/{api,planning}.ts` -- append route, response, limits, texts; contract tests.
- [x] `packages/core/src/{bmad-catalog-port,planning,planning-documents,chat/types,chat/turns,index}.ts` -- port method, detector, `document` use-case, hook.
- [x] `packages/adapters/src/bmad-catalog/{document,index}.ts`, `catalog-memory/index.ts` -- confined read.
- [x] `packages/server/src/{start,planning-routes}.ts` -- wiring and route.
- [x] `packages/web/src/...` -- transcript fold, card, sheet, markdown, API hook.
- [x] `tests/fixtures/fake-acp-agent.mjs` -- `write-doc`.
- [x] Tests -- every matrix row: core detector (unit, memory ports), adapter confinement (symlink file and folder out, FIFO, `..`, size cut, missing), route codes, transcript fold and card DOM (Open, next, error), markdown safety (`<script>`, `javascript:` link, raw HTML stay text); e2e: the ticket's `verify` in full.

**Acceptance Criteria:**
- Given the full suite, when `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` run, then all pass.
- Given a chat (not planning) session writing into the output folder, then no card appears.

## Implementation Notes

- `BmadCatalogPort.readDocument(repoPath, outputFolder, path)`: the Code Map's `(repoPath, path)` plus the output folder, because the adapter must confine the read to the folder's real path and core already has the folder from `setupStatus()`; the adapter does not re-derive it.
- "Longest match" for the session's skill compares invocation lengths (`sessionSkill`), not name lengths.
- The detector reads nothing for a write that is lexically no document (outside the repo, not `.md`); only then the setup status and the catalog. Its failures are logged as `{sessionId, step, code}`, never a path.
- A rewrite moves the one card for that path to where the latest write happened (transcript fold).
- `GET …/documents` maps `NotFoundError` to 404 with `DOCUMENT_NOT_FOUND_TEXT` and `ValidationError` to 400 with `DOCUMENT_INVALID_PATH_MESSAGE`; a project with no output folder answers 400.
- Markdown: inline formatting is matched within one line and skipped on a line over 4,000 characters, so a hostile document can't make rendering quadratic; nesting is capped at 8; soft breaks render as spaces.
- New shared texts (append-only): `PlanningDocument`, `DocumentResponse`, `MAX_DOCUMENT_BYTES`, `DOCUMENT_*` texts, `documentCardLabel`, `documentFileName`.
- Server shutdown waits (bounded) for detections under way before core closes.
- Review pass 1 patches applied (see the triage log); the hostile-input timing tests allow 1.5 s (3 s for 1 MB) so slow Windows runners pass, against 4 to 8 s before the fixes. Verified after the patches: `pnpm typecheck`, `pnpm test` (130 files, 1601 passed, 4 skipped), `pnpm e2e` (99 passed), `pnpm run pack && pnpm smoke` (OK).

## Plan Change Log

## Review Triage Log

### Pass 1 (2026-10-02; lenses: quick (UX and accessibility focus), security)

Verdicts: high 1, medium 4, low 9, false 0, maybe-false 0 (quick Q1-Q6, security S1-S8).

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| Q1 | The card's `DOCUMENT_NEXT_FAILED` never shows: `startPlanningSession` always throws a non-empty message built from `PLAN_START_FAILED` | low | patch | `api/http.ts` `send()` always sets a message. Fix: optional fallback text passed from the card. |
| Q2 | `#` and `##` both render `h3` (5 and 6 both `h6`); a text-less heading renders an empty heading | low | patch | `HEADING_TAGS` in `ui/markdown.tsx`. Fix: one element per level below the sheet title; empty heading as text. |
| Q3 | The open sheet re-parses the whole document on every session event | medium | patch | `Markdown` parses per render; `SessionPage` re-renders per event. Fix: `useMemo` on the source. |
| Q4 | A failed refetch keeps old content with no sign | low | patch | Only the `data === undefined` branch reads the error. Fix: quiet Notice above kept content, as `ticket-sheet.tsx`. |
| Q5 | `realPath === undefined` returns without telling `onError` | low | reject | `toWorkspace` always sets `realPath` (`planning.ts` `workspaceRepoPath` comment); unreachable in practice. |
| Q6 | A quote swallows a following heading, fence, rule or list item until a blank line | low | patch | Quote branch ignores `startsBlock`. Fix: stop there, as the paragraph branch. |
| S1 | Inline code-span regex is cubic: a 4,000-backtick line takes ~5 s; a 1 MiB document hangs the tab for minutes | high | patch | Reproduced by the lens. Fix: linear code-span scan; timing test. |
| S2 | `HEADING` and `LIST_ITEM` are quadratic on long raw lines (100 KB: ~8 s / ~4 s); the inline cap doesn't cover them | medium | patch | Reproduced. Fix: long raw lines are plain text before block regexes; non-backtracking matching. |
| S3 | An intermediate folder swapped for a symlink between `realpath` and `open` is followed out of the repo (`O_NOFOLLOW` covers the last component; flags are 0 on Windows) | medium | patch | Reproduced on macOS. Needs an agent racing the read; the content goes to the user, not the agent. Fix: after open, compare handle dev/ino with a fresh stat and re-check the real path. |
| S4 | A hard link inside the output folder to an outside file is read | low | reject | Only an actor that can already read the target (the agent) can create it; the content is shown to the user only. |
| S5 | The agent-controlled path (newlines, control or bidi characters, any length) reaches the card and, via the next step, the next session's first message; documents per call unbounded | medium | patch | `RepoRelativePath` allows them. Fix: `documentPath` refuses `\p{Cc}`, `\p{Cf}`, over 512 characters; at most 20 documents per call. |
| S6 | Frontmatter is hidden in the sheet, so text a later skill reads isn't shown | low | reject | Hidden frontmatter is the frozen intent's choice; the file stays in the repo for the user to open. |
| S7 | Link targets are hidden (text only) | low | reject | Frozen intent: links render as plain text, which is the safe choice (no navigation). |
| S8 | Windows reserved device names (`NUL.md`) unverified | low | reject | Not reproduced; `realpath` and `isFile()` gate the read; noted for 4.13's Windows run. |

## Design Notes

Plan size: ~2,300 tokens, above the 1,600 guide; kept whole (one user goal across layers, autonomous run approved by the coordinator).

Detection is async (catalog and setup status reads) and fire-and-forget after the tool call's event, so the card follows its tool-call row; a session deleted meanwhile makes `appendSessionEvent` throw, which is caught and logged.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- pass
- `pnpm e2e` -- pass
- `pnpm run pack && pnpm smoke` -- pass
