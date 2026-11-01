---
title: 'Line comments sent to the agent as one message'
type: 'feature'
ticket: '6'
created: '2026-11-01'
baseline_revision: 'c0ab1a6a2140d88e8cecf09a1cc74599592be7f0'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The diff viewer (8.3) has an empty `lineAfter` slot and no way to comment on a line, so a user reviewing a turn in Changes, or a build in Review, can't tell the agent "line 58: round after summing" without retyping paths and code into the chat (E8-R6, EXPERIENCE.md Line comments, Flow 6).

**Approach:** Web only. A Comment button on every diff line (hover, keyboard focus, `c`; Shift with click or `C` for a range from the last focused line) opens a field under the line; saved comments show in place and collect in a **Comments to send (N)** bar. **Send to <agent>** composes one message ("Please address these review comments:", then per comment `path:line`, the quoted lines and the comment), appends it to the chosen chat's composer draft and opens that chat, so the user reads and edits it and sends it with the composer's own send rule (queued while the agent works unless Send now). The chat is the panel's chat for This turn; from Unstaged, Staged or Branch a **Send to** picker lists the project's chats (latest first) and New chat. In Review the bar has no send: Reject and retry adds the composed comments to its note, editable, with "Your N comments go with it."

## Boundaries & Constraints

**Always:** unsent comments live only in this browser's `localStorage` (one entry per project and owner: the chat, the project's Workbench, or a Review's run), 7 days after the last change, guarded like `chat/drafts.ts`; they never reach the server, an event, a URL or a log until the user sends the composed message as a normal chat message (or Reject note); quoted lines are stored and sent masked (`redactSecrets`, and an environment file's values as `NAME=[redacted]`), and the whole composed text is masked again; caps: a comment at most 2000 characters, a quote at most 12 lines of at most 300 characters each (cut with "..."), at most 50 comments per owner, the composed text at most 20,000 characters for a chat and `MAX_RUN_NOTE_LENGTH` with the note for Review (quotes dropped first, then remaining comments counted as "and N more comments not included"); a comment whose line is no longer in the view with the same text shows "Outdated" in the bar and still sends with its original quote; comments are cleared only once handed into the draft or once the Reject succeeds; every text is in `@ogden-agents/shared`; Comment buttons are real buttons named with their line ("Comment on line 58"), reachable by Tab from the focused row; no em or en dashes in UI strings.

**Never:** a server, shared-schema or event change; sending a message directly from the bar (the composer sends); the transcript's "N review comments" block (deferred); a line's menu; Shift with arrows; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two comments, two files | This turn, `a.ts` line 58 and `b.css` lines 71 to 74 (Shift) | bar "Comments to send (2)"; Send to opens the chat with one composed message naming `a.ts:58` and `b.css:71-74` with their quoted lines | none |
| Existing draft | chat draft "hello" | composed text appended after a blank line | none |
| Agent working | chat busy | message waits in the composer; its Send queues as usual | none |
| Unstaged picker | no `?session=`, two chats | picker lists both, latest first, and New chat; New chat fills the new-chat draft | no chats: New chat only |
| Removed line | comment on removed line 40 | `path:40 (removed line)` and its `-` quote | none |
| Outdated | the line changed since | "Outdated" in the bar; sends the stored quote | none |
| Secret | quote holds `sk-ant-...`; `.env` line `TOKEN=abc` | `[redacted]`; `TOKEN=[redacted]` in storage and message | none |
| Over caps | 60 comments; a 40-line range; 30,000 characters | 51st refused with a plain line; quote cut at 12 lines; text within the cap with the "N more" line | none |
| Reload | saved comments, reload | still shown, in place and in the bar | storage blocked: kept in the page only |
| Review | comment on a build's diff, Reject and retry | note holds the composed comments, editable; sent note carries `path:line`; comments cleared after success | reject fails: comments kept |

</frozen-after-approval>

## Code Map

Project root is the worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/8.6`; run everything there; never `git stash`, push or switch branches; do not commit (the orchestrator commits).

- `packages/web/src/ui/diff/diff-file.tsx` -- `DiffSlots` gains `lineActions?(file, line)`: rendered at the end of the code cell (`data-slot="diff-line-action"` wrapper, visible on row hover, `focus-within` and `[data-current]`, else `opacity-0`, never `display:none`); Side by side renders it on each side, a context row once (right side). Its buttons render with `tabIndex={-1}`.
- `packages/web/src/ui/diff-viewer.tsx` -- `moveStop` also flips `tabIndex` (0/-1) of the buttons inside the old and new row's `[data-slot="diff-line-action"]`; `onKeyDown`: `c`/`C` on a focused line row clicks its (last) line-action button, `C` with a synthetic `shiftKey` click. Pass `lineActions` through `slots`.
- `packages/shared/src/line-comments.ts` (new, export from `index.ts`) -- texts (Design Notes), caps, `LineComment` type and zod schema for stored entries, `lineCommentRef(comment)` (`a.ts:58`, `a.ts:71-74`, removed lines suffixed), `quoteLines(path, lines)` (masking, caps), `reviewCommentsText(comments, maxChars)`; reuse `redactSecrets`, `REDACTED_SECRET` (`secret-patterns.ts`), `MAX_RUN_NOTE_LENGTH` (`builds.ts`).
- `packages/web/src/workbench/line-comments.ts` (new) -- storage after `chat/drafts.ts` (prefix `ogden-agents.line-comments.v1:`, `storageOf`, TTL, prune, try/catch), keys `lineCommentsKey(wsId, owner)`; `useLineComments(key)` hook (state + write-through, add/update/remove/clear).
- `packages/web/src/workbench/line-comments-ui.tsx` (new) -- `useLineCommentSlots({ comments, target, data })` returning `lineActions` and `lineAfter` (the field with **Save comment**/Cancel, saved comments with Edit and Remove), the anchor for Shift ranges (same file and side), outdated check against the loaded `DiffFileData`; `CommentsBar` (sticky bottom, count, list with Outdated, `Cmd/Ctrl+Enter` sends, optional send button and picker, a polite status line).
- `packages/web/src/workbench/workbench-changes.tsx` -- `ChangesList` merges comment slots with `slotsFor`; the comments key owner is `session ?? 'project'`; comments carry `view`, `turn` (resolved `changes.data.turn`); the bar sits under the viewer. Send: `appendDraft` (`problems-api.ts`) + `readDraft`/`writeDraft`/`chatDraftKey`/`newChatDraftKey` (`chat/drafts.ts`), clear, `navigate` like `workbench-problems.tsx` `ProblemRow`. Chats from `useSessions` (`kind === 'chat'`, already latest first), names by `chatName` (shared), agent by `agentNameOf` + `useChatAgents`.
- `packages/web/src/planning/build-review.tsx` -- `ReviewChanges` takes the comment slots; owner `review:<run.id>`; the bar (no send) under the viewer with `REVIEW_COMMENTS_GO_WITH_TEXT`; opening Reject and retry appends the composed text to `note` once; after `reject` succeeds the comments clear.
- `packages/web/src/ui/dropdown-menu.tsx` `DropdownMenuChoiceItem`, `ui/button.tsx`, `ui/textarea.tsx`, `ui/typography.tsx` -- reuse.
- `_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md` lines 171 and Flow 6 step 6 -- say Send opens the chat with the message in the composer, sent from there.
- Tests: `packages/shared/test` (composer, refs, masking, caps), `packages/web/test/line-comments.test.ts` (storage like `drafts.test.ts`), `diff-viewer.dom.test.tsx` (slot, tabIndex, `c`), `workbench-changes.dom.test.tsx` and `build-review.dom.test.tsx` (bar, picker, draft written, Review note); e2e new `tests/e2e/line-comments.spec.ts` (pattern of `workbench-changes.spec.ts`: two files, two comments, Send opens the chat, the test prefixes `review-echo ` in the composer and sends; the fake agent's `RECEIVED<<...>>` reply holds both `path:line`s; axe, 390px) and a Review case in `tests/e2e/build-dispatch.spec.ts` (comment, Reject and retry, the `POST` reject request's note holds the `path:line`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/line-comments.ts`, `index.ts` -- texts, caps, schema, composer, masking.
- [x] `packages/web/src/ui/diff/diff-file.tsx`, `ui/diff-viewer.tsx` -- `lineActions` slot, tab stop, `c`/`C`.
- [x] `packages/web/src/workbench/line-comments.ts`, `line-comments-ui.tsx` -- storage, hook, slots, bar.
- [x] `packages/web/src/workbench/workbench-changes.tsx` -- comments in Changes, Send to and picker.
- [x] `packages/web/src/planning/build-review.tsx` -- comments in Review with Reject and retry.
- [x] `_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md` -- the edit-before-send wording.
- [x] Tests above, one per matrix row at least.

**Acceptance Criteria:**
- Given a fake agent turn that changed two files, when the user comments on a line in each and clicks Send to Claude Code, then the chat opens with one composed message in the composer, and sending it gives the fake agent one prompt with both `path:line`s and quotes; axe finds nothing and 390px has no sideways scroll.
- Given a Review with a comment, when Reject and retry is confirmed, then the reject request's note holds the comment's `path:line` and text.
- Given the change, when `pnpm typecheck`, `pnpm test` and the touched e2e specs run, then they pass.

## Implementation Notes

- Environment-file masking for quotes: `isEnvironmentFileName` and `maskEnvironmentText` moved from `packages/adapters/src/workspace-files-node/index.ts` to `packages/shared/src/environment-files.ts` (with the segment fold as `foldPathSegment`; core's `foldSegment` calls it), so the web client masks exactly as the file viewer does; the adapter re-exports both. No behaviour change.
- Range anchor: the line focused last before the Shift action (tracked by an `onFocus` on an element around the viewer, plus the Comment button's own click for browsers that don't focus a clicked button). A range needs the same file and a side both ends share (an unchanged line counts on either side).
- The bar shows in every state of the Changes list (loading, empty, error), so comments can be sent from a view with no files; Outdated is only judged once every fetched diff answered. A draft that storage would not keep (blocked, too long) leaves the comments in the bar with `COMMENTS_NOT_HANDED_TEXT`.
- The fake ACP agent's `write-file` takes further `<relpath> <base64>` pairs, so one fake turn changes two files (the e2e).

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lens: quick; a first reviewer stalled and was relaunched fresh). Verdicts: high 0, medium 2, low 6, false 0, maybe-false 0. No intent_gap or bad_plan; all eight patched by the implementer.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Review: reopening Reject and retry after Cancel keeps the old composed text while the caption counts current comments; success clears comments never in the note | medium | patch | `seeded` reset only on success; seeded ids and text remembered, replaced on reopen, only seeded ids cleared |
| 2 | Review: no room in the note still marks seeded, so the caption lies and success deletes them | low | patch | `reviewCommentsText` '' path; nothing seeded when nothing appended |
| 3 | Bar's Remove leaves the notice up; with 0 comments Send hands over an empty message | low | patch | `CommentsBar` hid only on `count === 0 && notice === undefined`; notice cleared, no send at 0 |
| 4 | Keyboard `C` range only ever two lines: every j/k focus became the anchor | medium | patch | `onFocus` tracked each row; j/k moves no longer move the anchor; dom test 71 to 74 |
| 5 | Comment button covers the end of the first visual line on the current row | low | patch | absolute button with `pr-3` only; right padding reserved |
| 6 | e2e never checks the quotes or first comment in the agent's prompt (AC 1) | low | patch | assertions added |
| 7 | Matrix rows untested: no chats, `TOKEN=[redacted]` in the message, storage blocked through the hook | low | patch | tests added |
| 8 | Unused `REDACTED_SECRET` import in the adapter after the move | low | patch | removed |

## Deferred (for the sweep)

- The transcript's "N review comments" block whose rows link back to the lines (EXPERIENCE.md Line comments) is not built; the sent message shows as plain text.
- A line's menu and Shift with arrows for a range (EXPERIENCE.md) are not built; ranges come from Shift with click or `C`.
- EXPERIENCE.md Accessibility still says sending announces "3 comments sent to Claude Code"; Send now opens the chat with the message in its composer, so the announcement belongs to the composer's own send.
- Comments don't follow the user to another browser (browser storage by design, Design Notes).

## Design Notes

Storage (decision, autonomous 2026-11-01): this browser, not the server. EXPERIENCE.md already says "kept in this browser for 7 days, like unsent text", and `chat/drafts.ts`'s privacy decision applies: a comment quotes code and may hold a secret, and the server keeps an append-only event log; nothing about an unsent comment is worth a route. Cost: comments don't follow the user to another browser.

Edit before sending (decision, autonomous 2026-11-01, the orchestrator's brief): Send fills the chat's composer, the same path as Problems' "Ask the agent to fix this", so the user sees and edits the one message and the chat's while-working rule applies unchanged. EXPERIENCE.md is updated to match.

Message (masked; `a.ts:71-74` for a range; removed-only lines `a.ts:40 (removed line)`):
```
Please address these review comments:

src/cart/totals.ts:58
> + const total = lines.map(round).sum();
Round after summing, not per line.

src/styles/cart.css:71-74
> + color: red;
...
Use the existing formatPrice helper.
```

Texts: `COMMENT_LABEL` "Comment", `commentButtonName(range)` "Comment on line 58", `SAVE_COMMENT_LABEL` "Save comment", `commentsToSendText(n)` "Comments to send (2)", `sendCommentsLabel(agent)` "Send to Claude Code", `SEND_TO_LABEL` "Send to", `NEW_CHAT_NAME`, `COMMENTS_OPEN_IN_CHAT_TEXT` "Opens the chat with them in its message box, so you can read them before sending.", `COMMENT_OUTDATED_LABEL` "Outdated", `REVIEW_COMMENTS_HEADER`, `reviewCommentsGoWithText(n)` "Your 2 comments go with it.", `COMMENTS_FULL_TEXT` "You can keep up to 50 comments here. Send or remove some first.", `moreCommentsText(n)`.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (wait for `uptime` load below 40; re-run timing failures alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/line-comments.spec.ts tests/e2e/build-dispatch.spec.ts tests/e2e/workbench-changes.spec.ts tests/e2e/diff-viewer.spec.ts` -- expected: pass (axe, 390px)
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass

**Results (after review fixes, 2026-11-01):** `pnpm typecheck` clean; `pnpm test` 5912 passed, 13 skipped (453 files) at load 31 to 49; after `pnpm run build`, `line-comments`, `build-dispatch`, `workbench-changes` and `diff-viewer` e2e 10 of 10 (axe and 390px in `line-comments`); provenance check passed.
