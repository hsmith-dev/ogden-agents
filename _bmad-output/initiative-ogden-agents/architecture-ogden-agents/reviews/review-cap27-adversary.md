---
title: Adversarial review: AD-30 to AD-35 and the 2026-10-31 notes (CAP-27 to CAP-33)
reviewed: architecture-ogden-agents.md (updated 2026-10-31)
date: 2026-10-31
verdict: needs-fixes
---

# Adversarial review: CAP-27 to CAP-33 spine update

Scope: AD-30 (keystroke gate), AD-31 (screen prompt model), AD-32 (discovery and take-over), AD-33 (rotation and lineage), AD-34 (paired-device access), AD-35 (plan-limit readings), and the 2026-10-31 notes on AD-1, AD-3, AD-8 and AD-15.

Method: for each finding, two units one level down (two stories, or a story and code that already exists). Each one follows every AD as written, and the two still build incompatibly. Every case is checked against code in this worktree. Each finding proposes the rule that would close it.

**Verdict: needs-fixes.** None of this blocks the direction. Three findings are critical: each lets two compliant stories break an adopted invariant (AD-6/AD-16 output never evented, AD-3 one owner per process, the spec's CAP-31 "no route that can run a command"). The highs are mostly ownership and binding gaps that two teams would resolve differently.

---

## Critical

### C1. Prompt text has no lawful path to the card or the phone (AD-31 vs AD-6, AD-16, epic 16 E16-R6)

- **Unit A (story under AD-31):** emits `prompt.opened` carrying the `ScreenPrompt` (`question`, `options[].label`) so the desktop card and the phone can render it. AD-31 says only that lifecycle events exist; it does not say what they carry, and the `ScreenPrompt` shape it defines is text.
- **Unit B (existing code):** `packages/shared/src/events-panes.ts` header: pane events are "STATE ONLY ... no payload has a text field, and a test keeps it so (AD-6, AD-16; E16-R6)". `packages/core/src/terminal-port.ts`: `screenLines` is "in memory only, never stored or logged". AD-6: terminal I/O "is never logged".
- **Clash:** a prompt's question is terminal output. A Claude Code permission prompt prints the full command, for example `curl -H "Authorization: Bearer sk-..."`. Unit A puts it in the append-only, retained-forever log (AD-5) without redaction, and breaks the epic 16 test. If a story keeps it out of events instead, the phone, which may not open the pane WebSocket (AD-34), has to read the screen over a REST route. That conflicts with AD-15's new note ("nothing reachable from it touches the terminal") and the spec's CAP-31 constraint ("the terminal channel is never reachable remotely").
- **Fix (new rule in AD-31):** "`prompt.*` and `pane.keys_*` events carry ids, kind, option count and outcome only, never question or label text. The `ScreenPrompt` itself is an in-memory core read model per open prompt. It is masked with the shared secret patterns (AD-16) before anything reads it, served only by `GET .../prompts/:promptId`, never stored, and dropped when the prompt resolves. That GET is the one sanctioned derived view of terminal output. AD-6 and AD-15's CAP-31 note name it as the exception." Extend the epic 16 no-text-field test to `prompt.*` and `pane.*`.

### C2. Discovery lists Ogden's own sessions, and Take over makes a second owner (AD-32 vs AD-3, AD-8 handoff note, AD-17)

- **Unit A (`discovery-claude-code`):** watches Claude Code's session and transcript files, as AD-32 requires.
- **Unit B (existing code):** Ogden's own Claude Code chats run under the user's subscription. Their transcripts go to `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<slug>/<id>.jsonl` (`packages/adapters/src/acp-claude-code/transcript.ts`), the same folder discovery watches. So do:
  - unattended `buildrunner-acp` runs, whose cwd is a run worktree in the data directory (AD-17);
  - `claude` inside an epic 16 pane, whose session id Ogden never learns.
- **Clash:** every Ogden chat and build appears under "sessions started outside Ogden". Take over then creates a second AD-8 chat that resumes the same `agentSessionId@claude-code`. Two Ogden sessions now hold one agent session, and the two transcripts diverge. Taking over a build's session turns a sandboxed, deny-by-default unattended session (AD-17 story 5.2 note) into an attended chat outside its sandbox. "The original process is still running" does not help: an idle Ogden chat has no live process.
- **Fix (tighten AD-32):**
  - "A discovered session is dropped from the read model when its agent session id is held in any Ogden session's `adapterRefs`, current or earlier (handoff, rotation), or when its cwd is under the data directory."
  - "Take over re-checks this in the same core transaction that creates the chat, and refuses with `already_in_ogden` and a link to that chat."
  - "A session first seen in a pane Ogden started is listed as that pane's, not as outside Ogden." This needs the pane to record the CLI's session id once discovery sees a new transcript whose cwd and start time match the pane's.

### C3. The phone allowlist reaches command execution and standing rules (AD-34 vs spec CAP-31 constraint, AD-15 Skip-all note)

AD-34 allows routes, not bodies. Three compliant units each break the spec's "no route that can run a command, raise a mode above Ask or change settings is reachable with a phone token":

- **Chat send:** `POST sessionMessages` (`packages/server/src/chat-routes.ts:368`) to a chat in Auto or Skip all makes the agent run shell commands with no card.
  - If "chat send" also covers creating a chat, that chat starts in the project's default mode (AD-6 note), which may be Skip all.
  - So a phone starts Skip-all work without any mode change, which is the only thing AD-34 forbids.
- **Permission answers:** `PermissionDecision` is `allow_once | allow_always | deny` (`packages/shared/src/events-common.ts:126`). `allow_always` from the phone writes a standing `rule_` permission rule, which is a settings change.
- **Screen-prompt answers:**
  - A `text` answer types arbitrary text into a CLI. In Claude Code, `!cmd` in the input runs a shell command.
  - A `permission` option such as "Yes, and don't ask again" writes the CLI's own allow rule.
- **Fix (AD-34 rule, body level, enforced in core and not only by the route test):**
  - "A device-origin chat send is refused (`device_mode_not_ask`) unless the chat's mode is Ask. A device never creates a chat."
  - "A device permission answer is `allow_once` or `deny` only."
  - "A device screen-prompt answer is `single` or `permission` kind only. It never sends free text. It never picks an option the CLI's adapter data marks `persists`. It never targets a `shell` launcher pane."
  - Add unit tests for each refusal in addition to the route-enumeration test.

---

## High

### H1. Two owners of "this pane needs the user" (AD-31 vs epic 16's `pane-status.ts`; AD-4 does not apply to panes)

- **Unit A (existing code):**
  - `createStatusTracker` (`packages/core/src/pane-status.ts`) sets `PaneStatus = needs_attention` from the launcher's `promptPatterns` and emits `terminal.pane_status_changed`.
  - The web Needs-you list counts panes from that event (`packages/web/src/shell/sidebar-model.ts`, kind `pane`).
  - User input flips the status back to `working` (`tracker.input`), and that happens only in `panes.ts` `viewer.write`.
- **Unit B (story under AD-31):** "A pane with an open `ScreenPrompt` is AD-4 `waiting`."
- **Clash:**
  1. A pane is not an AD-8 session. `Pane` has `state: PaneState` and `status: PaneStatus` and no AD-4 field. Unit B either adds a third status field or rewrites `PaneStatus`.
  2. The tracker's generic patterns (`CLI_PROMPT_PATTERNS` in `packages/adapters/src/pane-launchers/index.ts`) and the per-CLI `screen-prompts-<cli>` patterns differ. A prompt can be open while the tracker reads `idle`, so the sidebar says nothing while the phone says "needs you". The reverse case gives `needs_attention` with an `unreadable` prompt.
  3. A gate send that writes the process directly never calls `tracker.input`, so the chip stays `needs_attention` after Ogden answered.
- **Fix (AD-31):**
  - "For a pane, the open-prompt fact has exactly one owner, `ScreenPromptPort` run inside the pane's status tracker. `needs_attention` holds exactly while a `ScreenPrompt` (including `unreadable`) is open, and `prompt.opened`/`prompt.resolved` are emitted with the matching `pane_status_changed` in one transaction."
  - "Panes keep the `PaneStatus` vocabulary. AD-4 `waiting` applies only to AD-8 sessions."
  - "Every gate write goes through the pane service, which tells the tracker."

### H2. `promptId` collides on repeated prompts, so a stale answer lands on the next prompt (AD-30 + AD-31; phone and desktop racing)

- **Unit A:** the phone's card for "Allow Bash?" with options (Yes / No) holds `promptId = h(session, question, labels)`.
- **Unit B:** the desktop user answers Yes in the terminal. The agent immediately asks the same question for its next command, with the same labels and cursor, so the `signature` is identical too.
- **Clash:** the phone's answer passes the gate's re-read check and approves a command the user never saw. AD-31's "exactly one `prompt.resolved` per prompt" and "`answered_in_ogden` needs a `keys_sent` with that `promptId`" both break: two occurrences share one id. The desktop's earlier `keys_sent` can mark the second prompt answered. AD-31 also hashes "the session", and a pane has no session id.
- **Fix (AD-31):**
  - "`promptId` is an occurrence id (prefixed ULID `prm_`, AD-9) minted at `prompt.opened`. `contentHash` (target, question, labels) only decides whether a re-read is still the same occurrence."
  - "An occurrence closes when the prompt leaves the screen, and any later appearance is a new `promptId`."
  - "The gate also refuses when the pane printed or took input after the read it compares against" (the tracker's `generation`), which closes the gap between read and write.

### H3. What a consent token binds to is ambiguous (AD-30)

Two compliant gate stories diverge on four points:

1. **Target:** `paneId` alone survives Restart pane (`panes.ts` keeps the id and starts a new process), so a token minted for the old program answers the new one.
2. **Signature source:** the expected signature can be read on the server at send time, which trivially matches and voids AD-31's "changed between read and send" guarantee. Or the client sends the one the user saw. AD-30 does not say.
3. **The answer itself:** which option and its keys are not covered. The route that mints the token could pass different keys.
4. **Mint and redeem:** both may happen in one request, or across a preview and a confirm, as with `handoff.ts` `previewToken`. A job token's lifetime is unstated. Rotation's brief turn can take minutes, longer than the 60 seconds a single token lasts.

- **Fix (AD-30):**
  - "A consent token binds `{ target id, process generation, action, promptId, signature the user saw, chosen option index or text hash, origin listener }`. It is minted and redeemed in the same request handler unless the action has a preview step. A job token lives until its job ends or 10 minutes, whichever comes first, and covers only the named steps of that job."
  - "A token minted on the device listener is never redeemed on loopback, nor the reverse."

### H4. Rotation inside an orchestration step settles the step with the brief as its result (AD-33 vs epic 15 code)

- **Unit A (story under AD-33):** rotates a chat. The agent writes the brief, ends its session, and a fresh one starts, all on the same Ogden session.
- **Unit B (existing code):**
  - `orchestration-engine.ts` (subscriber near line 393) advances any `dispatched` step whose session leaves `working`.
  - `orchestration-readback.ts` (around lines 115-125) settles a step `done` when its session is `idle`, and reads back the last turn.
- **Clash:**
  - On a worker chat with a dispatched step, the brief-writing turn ends, the session reads `idle`, and the step settles `done`. The manager receives the handoff brief as the worker's result.
  - AD-33 also does not say whether rotation may run when `driver = terminal`, `state = waiting`, or another `switching` holder is active. `handoff.ts` `checkNow` refuses all three, and an independently written rotation might not.
- **Fix (AD-33):** "Rotation applies the handoff preconditions (`checkNow`), holds the session's `switching` lock for the whole job, and is refused (`step_in_flight`) while the session has a `dispatched` orchestration step. Orchestration ignores state changes inside a rotation job."

### H5. The rotation brief has two definitions, and rotating an ACP chat has no keystrokes (AD-33 vs AD-8 handoff note, AD-30)

- AD-33 says "the agent writes a brief" (an agent turn, model output) and also "built and masked as a handoff brief is". In `handoff-brief.ts` that brief is built by core from events, with no agent turn, and shown to the user through a preview token before it is sent.
  - Story A runs an extra agent turn, which can raise a permission card in the middle of the job.
  - Story B builds the brief from events.
  - The two produce different briefs, failure modes and disclosure.
- "Rotation runs as one AD-30 job", but AD-30's gate covers only pane and terminal input. Rotating an ACP chat writes nothing to a terminal, so Story A routes it through the gate for nothing, and Story B never touches the gate. The architecture test cannot tell them apart.
- Rotating a pane can't record `session.rotated`, because a pane has no session.
- For Copilot, `instruct` is refused, so rotation cannot work there at all.
- **Fix (AD-33):** pick one.
  - Either "the brief is core-built from events (as handoff), editable, previewed and redeemed like handoff's `previewToken`, with no agent turn",
  - or "the agent writes it in a turn the user started, then core masks it, caps it and previews it before the new session receives it".
  - Also state: "Rotation applies to AD-8 sessions only (ACP chats, and the agent's own terminal when `driver = terminal`). It uses AD-30 only where it types into a terminal. Panes and `interactive_only` launchers do not rotate."

### H6. Lineage cannot be built from the events AD-33 names (AD-33 vs `events-orchestration.ts`, spec CAP-30)

- AD-33's own rule: "A new parent-child link kind is a new event that names both sessions." `orchestration.step_dispatched` carries `{ runId, stepId, worker, sessionId }` (`packages/shared/src/events-orchestration.ts:109`). It names the child only, and orchestration runs have no parent session. So "children from `orchestration.step_dispatched`" has no parent to hang under.
- A worker chat reused across runs gains several parents.
- The spec's CAP-30 success reads "a handoff child shows on its parent as waiting on it". AD-33 makes handoff a generation of the same session, so there is no child.
- Two compliant read-model stories (parent = run, or parent = the chat that launched the run) disagree, and neither meets the spec line.
- **Fix:**
  - Either add `parentSessionId` to `orchestration.run_started`, or say the parent of a worker is the run, shown as a pseudo-node.
  - Amend the CAP-30 success line to "a dispatched worker shows on its run (or launching chat) as waiting".
  - State that handoff and rotation are generations, never children, and that a handoff back to an earlier agent with resume re-opens an earlier generation, so generations form a list with returns, not a strictly linear one.

### H7. The statusLine reading has no lawful launch path, and it shares `--settings` with the protected-path guard (AD-35 vs `terminal-command.ts`, `panes.ts`)

- AD-35 says the source is "only in a Claude Code pane Ogden started", passed "through the `--settings` flag Ogden already uses for Auto's ask rules". In code, `--settings` is used only by the agent's own terminal (`packages/adapters/src/acp-claude-code/terminal-command.ts:108`, `claudeGuardSettings(protectedPaths)`). Epic 16 panes take only `defaultArgs`, whose regex `^[A-Za-z0-9._=:/@+-]+$` (`packages/shared/src/panes.ts`) rejects a JSON settings value.
- **Unit A:** adds `--settings` carrying `statusLine` to the pane launcher.
- **Unit B:** keeps the guard's `--settings` on the session terminal.
- **Clash:** if a story adds a second `--settings` to the session terminal for the meter, the last flag can win. Auto then loses its protected-path ask rules, a silent security regression.
- The settings tier `--settings` also overrides the user's own `statusLine`, so the user's visible CLI changes, which is what AD-35 says it prevents.
- How the statusLine command passes the reading back to Ogden (a file, a socket, which environment) is unspecified. It is a child that Claude Code spawns, outside the AD-16 child-env test.
- **Fix (AD-35):**
  - "One function in `acp-claude-code` composes the single `--settings` document (guard rules plus statusLine), and every launch site (session terminal, pane launcher) uses it."
  - "The statusLine command is an Ogden helper that writes only `rate_limits` to `<dataDir>/plan-limits/<launch id>.json` and prints the user's own statusLine output if they had one."
  - "Pane launch arguments gain a typed, non-user `settingsFile` path, not free args."

### H8. The agent's own terminal has no screen to read (AD-30, AD-31 vs `terminal-port.ts`)

- AD-30 targets `sessionId | paneId`. AD-31 reads "`TerminalPort.screenLines`". In code, `screenLines` exists only on `PaneProcess`. The session terminal's `TerminalProcess` (`chat/terminal.ts`) has no screen mirror, and `TerminalPort` has no `screenLines`.
  - One story adds a mirror to session terminals, which costs memory and changes AD-6's channel.
  - Another treats every session-terminal answer as `unreadable`, so the gate refuses it.
- If prompts do apply to session terminals, AD-4 `waiting` for that session collides with `permissions.ts`. That code (around lines 389 and 401) sets a session back to `working` when its last card resolves, with no knowledge of screen prompts.
- `handoff.ts` and `orchestration-engine.ts` (`pauseForCard`) read `waiting` as "a permission card".
- **Fix:** "AD-31 v1.3 covers epic 16 panes only. The agent's own terminal (AD-6) gets screen prompts only after it gains `PaneProcess`'s mirror. If it does, a session's `waiting` is the OR of pending cards and an open `ScreenPrompt`, recomputed by one core function that `permissions.ts`, `turns.ts` and the prompt tracker all call." Correct "TerminalPort.screenLines" to `PaneProcess.screenLines`.

### H9. Taking over a session that belongs to no workspace, or to two (AD-32 vs AD-2, AD-8)

- AD-32 lets a found session show under "On this computer" with no workspace, and Take over "creates an ordinary AD-8 chat". An AD-8 chat must belong to a workspace, and project trust (`projectNotTrustedReason`) is per workspace.
  - One story refuses Take over.
  - Another silently adds a project for the cwd, with no trust prompt.
- "The existing workspace whose path contains its cwd" is ambiguous for nested projects (a monorepo and a package inside it).
- **Fix:**
  - "Take over of a session with no workspace first runs the normal add-project flow for its cwd, including trust. Nothing is created until the user confirms."
  - "With nested matches, the deepest canonical path wins."
  - "Core computes the mapping and puts `workspaceId` in the read model. The UI never matches paths."

### H10. The tray cannot read the Needs-you count (AD-3 CAP-33 note vs AD-15 epic 13 note)

- The note says the tray "read[s] the Needs you count over the existing API". Under AD-15, the webview gets no Tauri IPC. The shell holds only the launcher token, which "opens nothing but the handshake". Every `/api` route needs a tab token. No route can feed the tray.
- Separately, the count itself is computed only in the browser (`sidebar-model.ts`).
- A story either opens IPC from the webview, which breaks AD-15, or has the shell redeem a launch code for its own tab token, which is an unreviewed second tab.
- **Fix:**
  - Either "the shell holds one shell tab, minted through its own `/#c=` exchange, used only for a read-only `GET /api/v1/attention/count`",
  - or "the launcher token additionally opens `GET /launcher/attention-count` (a number only)".
  - Write whichever is chosen into AD-15.

### H11. Excluding credential files by descriptor misses the user's own credential files (AD-32 vs AD-16)

- AD-32 says adapters never read "a file their descriptor names as holding a credential". The Codex descriptor names Ogden's `CODEX_HOME` in the data folder, not the user's `~/.codex`. So `~/.codex/auth.json` is named by no descriptor, and the same holds for `~/.claude/.credentials.json` on Linux.
- A discovery adapter that globs the agent folder obeys AD-32 and still reads credentials.
- **Fix:** "Discovery adapters read only an allowlist of glob patterns declared in their own data (for example `projects/*/*.jsonl`, `sessions/**/*.jsonl`). An adapter test fails if anything outside the allowlist is opened. Transcripts shown in the UI are masked with the shared secret patterns (AD-16) on read."

---

## Medium

- **M1. The gate can be bypassed through `PaneViewer.write`.**
  - The AD-30 test looks for `TerminalProcess`/`PaneProcess` `write` calls outside the sockets. The real writers are `panes.ts:567` (`viewer.write`) and `chat/terminal.ts:580`, reached through the viewer interface.
  - A phone or rotation story that opens a viewer and calls `viewer.write` passes a source scan written against the process types.
  - Fix: "opening a pane or terminal viewer is allowed only from `pane-socket.ts` and `terminal-socket.ts`". The test asserts this on the viewer factory call sites.
- **M2. `keys_sent` before the write gives false `answered_in_ogden`.**
  - `TerminalProcess.write` is silently ignored once the program exits, yet the log already says the keys were sent.
  - Fix: `answered_in_ogden` requires that `keys_sent` AND the prompt clears with no user input in between. Otherwise the outcome is `answered_in_terminal` or `agent_ended`. Or add `pane.keys_failed`.
- **M3. "One send per target at a time" can mean a queue or a refusal.**
  - A queue breaks Copilot's "never queued" constraint.
  - Fix: a concurrent send is refused with `target_busy`, never queued.
  - Also, key the Copilot restriction on the launcher's `termsNote: 'interactive_only'` and the descriptor's `interactiveOnly`, never on a name (AD-1).
- **M4. The device event stream is undefined.**
  - AD-34 bans the terminal and pane sockets but is silent on `/ws`.
  - If `/ws` is allowed, the phone receives every workspace's full event stream, far more than "attention list and chat read".
  - WebSocket auth uses the `ogden.auth.<token>` subprotocol, not Bearer, which conflicts with "a Bearer token as in AD-15".
  - Fix: the device gets a filtered event route (attention and allowlisted chats only), or polls. Name the auth carrier.
- **M5. The attention list has two derivations.** It is computed in the web client today (`sidebar-model.ts`). The phone's attention route and the tray count would be a second, server-side derivation. Fix: move "Needs you" into one core read model that web, phone and tray all read.
- **M6. Event volume conflicts with AD-5 retention.**
  - `discovered.session_updated` fires on every transcript write.
  - `plan_limit.read` fires on statusLine renders, which come many times a minute.
  - AD-5 says "All events are retained". AD-35's "only the latest reading is kept" is pruning that AD-5 allows only for message chunks.
  - Fix: both are read-model rows. They emit an event only on a meaningful change (discovered: seen, gone or state changed; plan limit: crossing a 5% step, or a new `resetsAt`). Or AD-5 gains a named pruning class.
- **M7. "The original process is still running" cannot be checked under AD-32's own test.**
  - The architecture test bans spawning in discovery adapters, so there is no `ps`. A pid read from a session record is subject to pid reuse, and Codex has no pid file.
  - Fix: liveness is "a pid from the agent's own record that is alive (signal 0) and whose start time is at or before the record's", else "unknown", and unknown refuses Take over with a plain reason.
- **M8. Pattern data has two owners.**
  - `PaneLauncher.promptPatterns` lives in the `pane-launchers` adapter, keyed by `launcherId`. `screen-prompts-<cli>` is keyed by CLI.
  - A `claude` started inside a `shell` launcher pane matches neither.
  - Fix: a launcher names its screen-prompt set (`screenPrompts: '<cli>'`), the tracker's patterns are derived from that set, and a shell pane stays working or idle only.
- **M9. The signature needs data `screenLines` does not provide.**
  - `screenLines` returns plain, non-empty lines, with no cursor row and no SGR attributes. Many TUIs mark the selection and ticks only with inverse video or color.
  - Fix: `ScreenPromptPort` reads a defined screen snapshot (lines with attributes, plus the cursor position) from `PaneProcess`. Or the signature is defined over text only, and a CLI whose selection is attribute-only is `unreadable`.
- **M10. Custom agents (AD-1 CAP-27 note) leave several things unowned.**
  - The agent registry is fixed at server wiring time. Adding an agent at runtime needs a persisted owner, which must be core (AD-11), and a live registry update.
  - Deleting or renaming one strands sessions whose `agentId` never changes.
  - The key's environment variable name is user-chosen and could be `NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_*` or `PATH`.
  - Auto mode has no protected-path guard for an unknown agent.
  - Nothing says whether it can be an orchestration worker.
  - Fix: custom agents are rows core writes. The key variable name must match `^[A-Z][A-Z0-9_]*_API_KEY$` and must not be on the child-env allowlist or a loader variable. Modes offered are Ask (and Skip all under Developer mode) only. The descriptor sets `interactiveOnly` so orchestration refuses it (`orchestration-dispatch.ts:61`). A deleted agent's sessions read as unavailable, not as Claude Code.
- **M11. A crash during rotation leaves `adapterRefs` ambiguous.**
  - After a restart (AD-3), the session may resume an agent session that was half-ended or never started.
  - Fix: core swaps `agentSessionId@<agentId>` and appends `session.rotated` in one transaction, only after the new agent session exists. Before that point, the old reference stands.
- **M12. The chat worktree commit (AD-8 CAP-33 note) is a third commit path.**
  - AD-17's epic 7 note lists the merge and "Save the lessons" as Ogden's only commits.
  - The Config convention allows run branches and worktree metadata "for builds only".
  - Neither is amended, and the note does not say the commit is serialized with the repo's other git work (`repo-serialization.ts`).
  - Fix: amend both, and route it through the same serialization and the hooks-off git calls.
- **M13. The `step` action is undefined (AD-30).**
  - Is a confirmed orchestration plan-step card a "user action" that may mint a token for typing manager-written text into a pane? Two readings exist.
  - Fix: define `step` (a scripted step of a job only), and state that approving manager text never mints a pane `instruct` token.

## Low

- **L1. Event names and streams.** `pane.keys_*`, `prompt.*` and `discovered.*` introduce three new domains next to the existing `terminal.pane_*`. Nothing states which stream they use (workspace for panes, session for a session terminal, install for discovered sessions). Fix: name them `terminal.pane_keys_sent` and `terminal.prompt_opened`, and state each stream.
- **L2. Stale spec text.** The spec's CAP-29 constraint ("every hook or config change it makes is backed up first and removed by its off switch") and success line ("restores every hook or config change") describe hooks that AD-32 forbids. Fix: update the spec so stories don't build a backup feature.
- **L3. Rotation `cause` is not enumerated.** Fix: list `user` only (with a later `context_suggested_user_confirmed`), so no automatic cause is introduced against AD-30's "no timer".
- **L4. Device listener details.** The Host and Origin check against "the listener's own address" fails when the phone uses a Tailscale MagicDNS name. Whether device tokens survive turning access off and on again is unstated. Fix: allow the configured address and its MagicDNS name. Tokens survive off and on, and only Revoke removes them.
- **L5. History deletion misses discovery events.** Discovery events are install-level, so AD-5's "history deletable per workspace" never removes them, even for sessions mapped to that workspace. Fix: state that discovery read-model rows are dropped when discovery is turned off, and are not covered by workspace deletion.
