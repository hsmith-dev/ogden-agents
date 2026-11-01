---
type: architecture-review
lens: rubric (good-spine checklist)
scope: 'AD-30 to AD-35; 2026-10-31 notes on AD-1, AD-3, AD-8, AD-15; Capability Map rows CAP-27..33; new Deferred bullets'
spine: ../architecture-ogden-agents.md
spec: ../../spec-ogden-agents/spec-ogden-agents.md
date: 2026-10-31
verdict: needs-fixes
---

# Rubric review: CAP-27 to CAP-33 architecture pass

**Verdict: needs-fixes.** I found no blocker in the structure itself. Each of CAP-27 to CAP-33 maps to at least one AD or note, and every new AD is marked proposed. But one AD-34 rule lets a phone token reach command execution, which the spec forbids. Several rules also conflict with code already on disk. And four divergence points the CAP-28/30/33 stories will hit are not decided: whether a pane counts as a session, Developer mode for panes, whether screen text goes into events, and how the tray authenticates.

## Spot-checks against the codebase

| Claim in the spine | Found | Note |
|---|---|---|
| `TerminalPort.screenLines` | yes, `packages/core/src/terminal-port.ts:72` (on `PaneProcess`) | Only panes have it. A plain `TerminalProcess` (AD-6 chat terminal) has no `screenLines`. |
| epic 16 `PanePromptPattern`, status tracker | yes, `packages/shared/src/panes.ts:73`, `packages/core/src/pane-status.ts` | The tracker's own contract says screen lines are "never stored, logged or sent (AD-6, AD-16)". See H5. |
| `PaneStatus` | `['working','needs_attention','idle','exited']` (`shared/src/panes.ts:43`) | This is not AD-4's set. See H3. |
| Panes need Developer mode | yes, `core/src/panes.ts:84,172` (`PANES_NEED_DEVELOPER_MODE`) | Not addressed anywhere in the new text. See H4. |
| `AgentId` in `shared/src/events-common.ts` | yes, kebab-case regex, max 64 | `custom-<slug>` fits. |
| `orchestration.step_dispatched` carries `sessionId` | yes, `core/src/orchestration-dispatch.ts:206`, payload `{runId, stepId, worker, sessionId}` | Its parent is an orchestration **run**, not a session. `OrchestrationRun` (`shared/src/orchestration-run.ts:163`) has no parent chat. See H6. |
| `unattendedBuild` | on `AgentPort` (`core/src/agent-port.ts:293`), not on `AgentDescriptor` | The AD-1 note says "descriptor ... never `unattendedBuild`". Minor wording issue. |
| `interactiveOnly` descriptor flag | exists, `core/src/agent-descriptor.ts` | AD-30's Copilot rule should be keyed on this flag, not on the agent's name (M4). |
| `tests/architecture.test.ts` | exists, regex source scans (AD-1, AD-16 spawn env, AD-10, epic 16 pane-program) | AD-30's proposed scan conflicts with existing writers (H1). |
| Existing pane events | `terminal.pane_*` (`shared/src/events-panes.ts`) | AD-30 introduces a separate `pane.*` domain (L2). |
| `acp-opencode` | exists (epic 14) | Fine for the CAP-27 live check. |

## Critical

### C1. AD-34's allowlist lets a phone run commands through a chat
The allowlist grants "chat send and read". A message sent to a chat in **Auto** or **Skip all** makes the agent run tools, including Bash, with no card. The spec's CAP-31 constraint says "no route that can run a command ... is reachable with a phone token". AD-34's own Prevents line names "anything that runs a command". "Permission-card answers" is also unbounded: an *Always allow* answer creates a persistent `rule_` permission rule (AD-9 note), which is a settings change made from the phone.
**Fix:** add to AD-34's Rule:
- A device-origin chat send is accepted only while that chat's current mode is `ask`. Core re-checks this in the same step as the send, not only in the route, and otherwise refuses with 403 `device_not_allowed` (details `{ reason: 'mode_above_ask' }`).
- Device-origin card answers are limited to allow-once and deny. Always-allow is refused.
- The route-enumeration test also covers both refusals.

## High

### H1. AD-30's enforcement test does not match the code that exists
The Rule says "the user's own bytes on the terminal WebSocket ... do not pass it". The test is supposed to fail on any `write` "outside the terminal and pane sockets". But today the user's bytes reach the process in **core**, not in the sockets:
- `core/src/panes.ts:567`, `entry.process?.write(data)`, in the viewer handle
- `core/src/chat/terminal.ts:580`, `terminal.process.write(data)`

`adapters/src/setup-claude-code/index.ts:455` also writes a sign-in code into a terminal. That write is Ogden-originated and not an agent session, but the rule as written covers it. On top of that, a text scan cannot tell a `TerminalProcess.write` apart from the many other `.write(` calls.

**Fix:** make the rule structural and give the exemptions by name:
- Only `KeystrokeGate` and the viewer handle (`Panes.attach().write`, the chat-terminal viewer) hold a pane's or terminal's writer.
- The setup sign-in write is named as the one non-agent exemption.
- The test checks every `process.write` / `process?.write` call site in `packages/` against an explicit allowlist of files.
- Restate "the user's bytes" as "bytes arriving through a viewer handle from a terminal or pane socket".

### H2. The gate's scope is unclear for ACP chats and orchestration
AD-30's Prevents line lists "orchestration". AD-33 says "Rotation runs as one AD-30 job". But an ACP chat takes prompts over ACP, not keystrokes, and orchestration's `step_dispatched` sends an instruction into an ACP chat. One story author will route ACP rotation and dispatch through the gate. Another will not.
**Fix:** state in AD-30:
- The gate governs PTY input only: epic 16 panes and the AD-6 chat terminal.
- ACP prompts keep the existing chat-send use-case and CAP-22's per-step approval.
- Rotation of an ACP chat is a core chat job that does not use the gate.
- Decide whether a CAP-28 pane can be rotated (AD-33) or be an orchestration worker (`step`). Recommendation: neither in v1.3, in which case drop `step` from the action set.

### H3. It is undecided whether a CLI-only agent is a session or a pane
Panes are not AD-8 sessions. `PaneStatus` is not AD-4's state. Yet the new text treats them interchangeably in several places:
- AD-31: "a pane with an open `ScreenPrompt` is AD-4 `waiting`"
- AD-30: targets `sessionId | paneId`
- AD-32: Take over creates a chat "or epic 16 pane"
- AD-34: the "attention list"
- AD-3 note: the tray's "Needs you count"
- AD-33: lineage over sessions only

Each of the CAP-28, 29, 31 and 33 stories will invent its own join.
**Fix:** add a decision, as an AD-4 note or inside AD-31:
- A CLI-only agent is an epic 16 pane, never an AD-8 session.
- One core read model, **Needs you**, is the union of sessions in `waiting` and panes with an open `ScreenPrompt` (pane status `needs_attention`).
- The sidebar, tray, quick entry and phone read only that model.
- Panes are not part of lineage in v1.3.

### H4. Developer mode for CAP-28 panes is not decided
Panes refuse without Developer mode (`core/src/panes.ts:84`), and turning Developer mode off closes them. CAP-28 makes panes the only home for a CLI-only agent. AD-21 says no standard flow needs a terminal. AD-34 lets the phone answer into a pane, while the phone can never turn Developer mode on.
**Fix:** decide one of these, with the user if needed:
- (a) CAP-28 agent panes stay Developer-mode-only, and the spec says so.
- (b) A launcher flagged as an agent opens without Developer mode, but its raw pane WebSocket stays Developer-mode-only and the card is the standard surface.

Either way, also state that open prompts resolve `agent_ended` when Developer mode turns off.

### H5. Whether screen text enters the event log weakens AD-6 without saying so
The rule does not say what `prompt.opened` carries. It needs the question and option labels for the card and the phone. The current code's contract is explicit:
- `pane-status.ts`: screen lines are "never stored, logged or sent (AD-6, AD-16)"
- `panes.ts`: a pane name is "never taken from terminal output"
- `pane-store.ts`: "never a program's output"

AD-6 [ADOPTED] says terminal I/O "is never logged". Screens can also show secrets.
**Fix:** decide it in AD-31:
- Events carry only `promptId`, `kind`, option count and `outcome`.
- The parsed `ScreenPrompt` is held in core memory while it is open and served by an authenticated GET.
- The text is masked with AD-16's shared secret patterns before it leaves the server, and it is dropped on resolve.

If instead the text must be persisted, write it as an explicit AD-6 amendment for the user to adopt.

### H6. The lineage model matches neither the code nor the spec's success line
- `orchestration.step_dispatched` links an orchestration **run** to a worker session. There is no parent session (`OrchestrationRun` has no chat field). So "a chat's children come from `step_dispatched`" has no parent to hang on.
- A handoff keeps the **same** session (AD-8 handoff note). Yet the CAP-30 success line asks for "a handoff child [that] shows on its parent as waiting on it".
- "What came back" (CAP-30 intent) has no source in AD-33.

**Fix:**
- Define the family node types: the generations of one session (`session.rotated`, `session.agent_changed`), and an orchestration run as the parent of its worker sessions.
- Name "what came back" as the orchestration readback (`orchestration-readback.ts`), or else defer it.
- Raise with the spec owner that "handoff child" should read "orchestration worker" (or add an event that does create a child).
- Make the enforcement testable: an architecture test that `packages/web` imports no lineage-building helper and reads only the family API.

### H7. How the tray and global shortcut authenticate is undecided and touches AD-15
The tray reads the Needs you count "over the existing API". The Rust shell holds only the launcher token, which "opens nothing but the handshake" (AD-15 story 1.7 note). The webview has "no Tauri IPC or capability" (AD-15 epic 13 note). A quick-entry box is a second window, and it is unclear whether it has its own tab token. Two implementers will pick different answers, and one of them, such as giving the launcher token a read route or adding IPC, weakens AD-15.
**Fix:** add an AD-15 note:
- The shell exchanges a fresh launch code for its own tab token, held only in Rust memory, and polls the Needs you read model with it.
- Quick entry is a same-origin window opened on its own `/#c=<code>`.
- No IPC is added and the launcher token's reach is unchanged.

### H8. AD-34's local certificate authority is unbounded
The phone must trust Ogden's root CA. If that key leaks, it can mint a certificate for any site the phone visits. The rule does not say where the key lives, with what permissions, how long it lasts, or what happens when the interface address changes (a new DHCP lease, Tailscale renumbering).
**Fix:**
- Issue the CA with X.509 `nameConstraints` limited to the chosen address or tailnet name.
- Keep the key owner-only (0600) in the data directory, never exported or logged.
- Give the leaf certificate a short life, re-issued on address change.
- Use a fixed, user-chosen port so the phone's bookmark survives restarts and upgrades.
- If the chosen address is missing at start, the listener stays closed and Settings says why.
- Give device tokens an idle expiry, for example 30 days unused, on top of Revoke.

### H9. CAP-33's chat commit contradicts an AD-17 note, and the promised AD-17 note is missing
AD-17's epic 7 note says: "besides approve's merge, Ogden's only commit is **Save the lessons**". The new AD-8 note adds a chat commit. The Capability Map cites "AD-17 (notes)" for CAP-33, but no AD-17 note was added. Also undecided:
- whether the chat worktree gets AD-17's protections (repo hooks off, protected paths, Windows `core.longpaths`)
- branch naming (a collision with run branches?)
- cleanup when the chat is deleted, and state after a restart
- how the changes reach the main branch (only by the user, outside Ogden?)

**Fix:** add the AD-17 note. It should cover:
- the third commit kind: user-clicked, local, never pushed, git hooks off
- branch prefix `ogden/chat/<ses_…>`
- the worktree in the data directory, kept on restart and removed with the chat after confirmation
- no merge back from Ogden in v1.3

Also update the Conventions "Config and data" row.

## Medium

- **M1. Two new event uses conflict with AD-5's retention.** AD-5 [ADOPTED] says "all events are retained". AD-35's "only the latest reading per agent and window is kept, as ... `plan_limit.read` event" is a pruning rule. `discovered.session_updated` on every transcript write will flood the log. *Fix:* keep plan readings and found sessions in core-owned install-level tables, with events only on a meaningful change (debounced, at most 1 per minute per session). Or write explicit pruning as an AD-5 note.
- **M2. `promptId` collides across repeated prompts.** It hashes session, question and labels, so the same "Allow? Yes/No" asked twice gets one id. That breaks "exactly one `prompt.resolved`" and the `answered_in_ogden` join. *Fix:* include a per-pane occurrence counter (or the seq of `prompt.opened`) in `promptId`.
- **M3. One CLI's prompt data would live in two places.** Epic 16 launchers already carry `promptPatterns` (`shared/src/panes.ts:127`, `adapters/src/pane-launchers`). AD-31 adds `screen-prompts-<cli>`. *Fix:* pick one source. Recommended: the screen-prompt adapter owns the patterns and key encodings, and the launcher entry references it by id.
- **M4. AD-30's Copilot rule would make core name an agent.** Core cannot name Copilot (AD-1). *Fix:* key the rule on a data flag (reuse `interactiveOnly`, or add `screenAnswersOnly`) carried by the pane launcher data, and test it.
- **M5. User typing can still interleave with a gate send.** User bytes bypass the gate, so a gate send can land in the middle of the user typing, despite the Prevents line. *Fix:* the viewer handle respects the gate's per-target lock and holds user bytes while a gate send is in flight, or the Prevents line is narrowed.
- **M6. AD-6's driver lock and the gate interact without a decision.** May the gate (or the phone) answer into a chat's terminal while `driver = terminal`? Does a screen prompt there conflict with ACP permission cards? *Fix:* state that CAP-28 screen prompts apply only to epic 16 panes, never to the AD-6 chat terminal.
- **M7. Restart and upgrade behaviour is not decided.** The rubric requires it. *Fix:* add one operations bullet per AD:
  - AD-31: an open prompt resolves `agent_ended` at server start, since pane programs do not survive a stop (`pane-store.ts`).
  - AD-30: consent tokens are memory-only and lost on restart.
  - AD-33: a rotation interrupted mid-job (brief written, new agent session not started) is left `idle` with a "Resume rotation" action, and the old agent session ref is kept.
  - AD-34: the listener reopens at start only if enabled and its address exists. Device hashes are in SQLite and so ride AD-5's pre-migration backup.
  - AD-32: a rescan after restart dedupes on (agent, agent session id).
  - AD-35: a reading whose `resetsAt` has passed reads as `unknown`.
- **M8. Deferring attachment storage leaves room to diverge.** AD-5's `session.message_completed` "carrying the full content" would put image bytes in SQLite unless something says otherwise. The UI story and the adapter story will choose differently. *Fix:* decide now:
  - Attachments are files under the session in the data directory, with a size cap per file.
  - Events carry `{ name, mediaType, size, sha256, ref }`.
  - They are deleted with the workspace's history.
  - They are sent only to agents that advertise the matching capability.
  - Leave only the exact limits to the epic.
- **M9. AD-32 has several gaps.**
  - Take over's "original process is still running" check has no defined signal per adapter.
  - A transcript reference must resolve under the agent's sessions folder, with no symlinks or `..`.
  - A session under "On this computer" has no workspace, but AD-2 needs one, so Take over must first add or pick a workspace.
  - The spec's CAP-29 success line ("restores every hook or config change") is vacuous under "installs no hook".

  *Fix:* add these to AD-32, and ask the spec owner to align that success line.
- **M10. AD-35's statusLine path is underspecified.** It does not say how the statusLine command reports back: a loopback HTTP call needs a token, while a file in the data directory is simpler. Passing a `statusLine` replaces the user's own status line in that pane, and it must be merged with Auto's `--settings` ask rules (AD-6 note) into one file. *Fix:*
  - The command writes to an owner-only file in the data directory, which the adapter reads.
  - Ogden's settings file is a single merge of the ask rules and the statusLine.
  - A pane whose user already passes `--settings` gets no meter.
- **M11. The device listener's event WebSocket is not decided.** The phone's attention list needs push. AD-34 forbids terminal and pane sockets but says nothing about `/ws` events, which carry everything. *Fix:* the device either gets no `/ws` and polls the Needs you read model, or gets a filtered device stream of only attention and allowed-chat events, enumerated in the same test.
- **M12. CAP-27 needs more detail.**
  - Where the custom descriptors are kept (core-owned, install-level, AD-11).
  - Validation of the key's environment variable name: refuse `PATH`, `NODE_OPTIONS`, `LD_*`, `DYLD_*` and anything in the allowlist.
  - `needsProjectTrust` defaults to true.
  - Whether a custom agent can be a CAP-22 worker.
  - What happens to existing sessions when a custom agent is removed: they open read-only with a plain reason.

  *Fix:* add these to the AD-1 note.

## Low

- **L1. Stale text and missing entries.**
  - Deferred still says "Start at login or a tray icon: later" and "remote access ... out of scope (spec non-goals)". Both now conflict with CAP-33 and CAP-31.
  - The Stack table lacks `tauri-plugin-global-shortcut` and the `tray-icon` feature.
  - The Layer table and Structural Seed lack the new adapters and the device listener.
  - The Conventions "Config and data" row lacks the CA, chat worktrees and attachments.

  *Fix:* update each one.
- **L2. Event naming is inconsistent.** `pane.keys_sent` / `pane.keys_refused` sit beside the existing `terminal.pane_*` domain. *Fix:* `terminal.pane_keys_sent` / `terminal.pane_keys_refused`.
- **L3. The record can claim keys went out when they did not.** `keys_sent` is appended *before* the write, so a throwing write leaves a false record. *Fix:* rename it `keys_sending`, or add a follow-up outcome.
- **L4. Adapter naming and an empty port.** `screen-prompts-<cli>` breaks the `<port>-<variant>` convention (use `screen-prompt-<cli>`). `DeviceAccessPort` has no stated purpose: say it covers certificate issuance and interface enumeration, the OS- and crypto-specific parts.
- **L5. The AD-15 note overstates what the phone can reach.** "Nothing reachable from it touches the terminal" is inaccurate, since screen-prompt answers write pane input. *Fix:* "no terminal or pane byte stream is reachable; pane input only as an AD-30 `answer`".
- **L6. AD-33 and AD-35 lack the usual lines.** AD-35 has no Enforcement or Alternatives line. AD-33's Enforcement cannot be tested as written. *Fix:* add a test for each, for example "no route returns a meter for an API-key agent" and "nothing is refused because of a reading".
- **L7. The AD-1 note puts `unattendedBuild` on the wrong type.** It says "descriptor ... never `unattendedBuild`", but that flag is on `AgentPort` (`core/src/agent-port.ts:293`). *Fix:* reword the note.

## Coverage summary

| CAP | Covered by | Gaps (finding) |
|---|---|---|
| CAP-27 | AD-1 note, AD-16 | M12 |
| CAP-28 | AD-30, AD-31 | H1, H3, H4, H5, M2-M6 |
| CAP-29 | AD-32 | M1, M7, M9 |
| CAP-30 | AD-33, AD-8 note | H2, H6, M7 |
| CAP-31 | AD-34, AD-15 note | C1, H8, M11, L5 |
| CAP-32 | AD-35 | M1, M10, L6 |
| CAP-33 | AD-3 note, AD-8 note, Deferred | H7, H9, M8, L1 |

Adopted ADs weakened without an explicit amendment:
- AD-5: event retention (M1), and attachment content in events (M8).
- AD-6: screen text in events (H5).
- AD-15: tray authentication (H7), and an inaccurate note (L5).
- AD-17: the "only commit" note (H9).
- AD-34's amendment of AD-15 is properly flagged.
- No new AD weakens AD-3 or AD-16 as written. AD-32 keeps AD-3 by making take-over a resume.
