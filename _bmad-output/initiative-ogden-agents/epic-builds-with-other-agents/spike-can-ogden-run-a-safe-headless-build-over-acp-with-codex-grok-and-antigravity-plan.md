---
title: 'Spike 17.1: Can Ogden run a safe headless build over ACP with Codex, Grok and Antigravity?'
type: 'chore'
ticket: '1'
created: '2026-10-05'
status: 'built'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '89e49c401e7be1de11d45d30412112e9b39ec1e3'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 17 brings unattended builds with Codex, Grok and Antigravity into version 1 (user, 2026-10-05). Before anything is built we need facts per agent: can Ogden run a headless `bmad-build-auto` session over ACP with its own rules answering every permission request, a sandbox for the agent's commands, skills that reach the worktree, the halt and result contract, and a clean stop, without weakening any frozen safety rule (protected paths, no network sandbox, fail closed)?

**Approach:** A temporary CI job (Windows, Linux, macOS) ran the shipped session code and core's build permission policy against the fake Codex, Grok and Antigravity personalities. What a fake cannot show comes from the pinned adapter's source and the earlier spikes (12.1, 12.2, 6.1) and is marked, and everything only a real agent can answer is a live check for the user. The go or no-go per agent is the user's.

</frozen-after-approval>

## Implementation Notes

Oneshot: the only lasting change is this record. The probe (`packages/adapters/test/spike-17-probe.test.ts`, `.github/workflows/spike-17-probe.yml`) was added in 3d1b493fac2d88a23fa3d2cbccc4d0814936d7a6 and amended in 105df28adb76f576bab1506f5e68908192d3f9d0, and removed before review. Recover it from those commits to re-run. CI runs: 37410351440 (macOS and Linux green; Windows failed because the runner's temp folder is an 8.3 short name, which the build policy refuses by design, so the probe was changed to use long names) and 37411094365 (Windows and Linux green; macOS also green locally, and in 37410351440). Labels: **probe** = seen in those logs; **source** = read in the pinned `@agentclientprotocol/codex-acp` 2.1.1 `dist/index.js`; **spike** = recorded by 12.1, 12.2 or 6.1; **docs** = a vendor page, fetched or read earlier; **unverified** = not measured, a live check.

### What the probe ran (probe)

For each personality (`fake-codex.mjs`, `fake-grok.mjs`, `fake-antigravity.mjs`, the same wrapper files the chat tests use), through the shipped `createCodexAgent`, `createGrokAgent` and `createAntigravityAgent`:

1. A session started with a build sandbox. All three refuse with `agent_unavailable` ("<Agent> can't run a sandboxed build."). This is the fail closed rule working today: Codex and Grok because their mode is fixed at start (`startOptions`) and a fixed-mode start has no place for a sandbox (`acp-agent.ts`), Antigravity because it has no `sessionMeta` quirk. So no build can start with any of the three until a build quirk is written.
2. A session started without a sandbox (attended style, Ask) with core's `decideBuildPermission` as the permission callback, asked for an edit inside the worktree, in `.claude/`, in `AGENTS.md`, through `..`, and through a symlink that leaves the worktree. On all three OSes and all three personalities the policy saw the real paths and answered `allow_once` for the first and `deny` for the other four, and the agent's reply confirms the deny reached it (`Edited ...` and `Denied ...`). So the one shared policy and the shared adapter's option choice (`allow_once` and the reject option by kind) already work for every agent's request shape, for the generic `edit` tool call with `locations`.
3. `skillInvocation('bmad-build-auto', 'ticket 1.1')`: Codex `$bmad-build-auto ticket 1.1`, Grok and Antigravity `/bmad-build-auto ticket 1.1`. The build runner's invocation is a Claude Code slash command today and must use each agent's own.
4. Declared modes: all three declare `ask` and `skip_all` only (`permissionModes`). A build never uses `skip_all`.

Not measured by the probe (a fake plays what we already knew): each real agent's own tool names and raw-input fields, whether its sandbox holds, whether skills load in a worktree, a halt reaching the result file, and process trees of real agents.

### Per agent: what each needs

| | Codex | Grok | Antigravity |
|---|---|---|---|
| Key or sign-in | OpenAI API key only, `CODEX_API_KEY` in its process (user, 2026-10-05) | xAI access token only, `XAI_API_KEY` via the unadvertised `xai.api_key` (user, 2026-10-05) | Google sign-in or Gemini API key as chat (user accepted the terms risk for chat, 2026-10-02) |
| Mode at start (spike, source) | `INITIAL_AGENT_MODE` is read from the adapter's own environment at start (source: `getInitialAgentMode`); modes `read-only`, `workspace-write`, `agent`, `agent-full-access`; the adapter sends each mode's approval policy and sandbox policy with every turn (source: `sendPrompt`), so the sandbox follows the mode | None as session modes; `_meta.yoloMode` and `_meta.autoMode` on `session/new`, `resume`, `load` (spike 12.2); Ask is both false, explicit | Session modes `default`, `auto_edit`, `yolo` (spike 6.1); Ogden maps Ask to `default` only |
| Candidate sandbox for a build (source or docs) | `workspace-write`: policy `workspaceWrite`, `writableRoots` empty plus the session's `additionalDirectories` (the adapter advertises that capability, source and spike 12.1), `networkAccess: false` (source), approval `on-request`. `read-only` has `networkAccess: false` and asks before edits. `.git` and `.codex` being read-only inside a writable root (docs, unverified) decides whether `git commit` works | Seatbelt on macOS and Landlock on Linux exist (docs, spike 12.2); no Windows sandbox. How a client gives it the run's roots and no network is unverified (the sandbox page at docs.x.ai returned 404; the user guide is in the harness repo) | None recorded (spike 6.1, agent matrix). `auto_edit` approves every file edit including protected files; a terminal command may still prompt under `auto_edit` and `yolo` (binary strings, spike 6.1) |
| Permission options Ogden reads | `allow_once`, `allow_for_session`, two `reject_once` (`decline`, `cancel`); network amendments add `reject_always` (spike 12.1, source) | `allow_once`, `allow_always`, `reject_once`, `reject_always` (binary, ids unseen) | `allow` (`allow_once`), `deny` (`reject_once`), `allow_always` (binary strings) |
| Tool-path fields | Unseen with a model turn: live check (the adapter's `fileChange` approvals carry the changes; `toolInputPaths` is Codex's own) | Unseen: live check | `rawInput.CommandLine` for commands; edit fields unseen: live check |
| Skill reach in a worktree | `.agents/skills` and `.codex/skills`, not `.claude/skills` (spike 12.1): BMad skills are placed in `.agents/skills` by chat's story 12.9; a worktree has only committed files, so they reach it only if committed | `.claude/skills`, `.grok/skills`, `.agents` (docs, spike 12.2) | Its skills folder, placed by 6.8 |
| Windows | Restricted token sandbox, elevated preferred (docs, spike 12.1): unverified in a run | No sandbox: attended only | No sandbox recorded: attended only |
| Today (probe) | Refused (fixed mode) | Refused (fixed mode) | Refused (no quirk) |

### What each would need built (the stories)

- Codex: a build quirk that starts it with `INITIAL_AGENT_MODE=workspace-write` and gives the run's roots (the worktree, the git folders a commit needs, the per-run object store) as the session's `additionalDirectories`, with nothing in a config file that carries a key; Ogden's rule answers every escalation and denies it; `fixed` start options must accept this build mode and the fail-closed refusal stays for a start with no sandbox. If `.git` stays read-only inside a root, a commit fails in the agent's sandbox (live check 3).
- Grok: only if a sandbox can be configured per run; otherwise attended only with the explicit Ask `_meta`. `GROK_FOLDER_TRUST` and always-approve are never changed.
- Antigravity: attended only unless a sandbox is found; never `auto_edit` or `yolo`; answer every card by rule.
- All: a build runner per agent (skill invocation and halt wording), an agent-neutral run session id, a per-agent sandbox check, failure words, the picker and a default build agent (entries 2, 3, 8, 9).

### Terms

- Copilot is excluded by the user's own terms note (autonomous background Copilot CLI use violates GitHub's terms); it stays interactive in epic 16.
- Antigravity: Google's current terms say third-party software using Antigravity's OAuth is a breach that may suspend the user's accounts (spike 6.1). The user accepted that for chat. Whether it extends to unattended builds is the user's call at the go or no-go; the Gemini API key route avoids OAuth.
- Codex and Grok: API key only, so their subscription terms do not apply (user, 2026-10-05). OpenAI's and xAI's current API terms for unattended use were not re-read here (xAI's pages blocked automated reading in 12.2; OpenAI's help page returned 403): unverified.

### Recommendation (the user decides)

- Codex: **GO for unattended builds, conditional** on live checks 1 to 4. It is the only one of the three whose sandbox and approval policy are set by the mode the adapter takes at start, with no network and Ogden answering each escalation. If `git commit` cannot run in its sandbox (live check 3), Codex is attended only.
- Grok: **attended only for now; unattended no-go until live check 5** shows a sandbox can be given the run's roots and no network. On Windows it is attended only whatever the result.
- Antigravity: **attended only; unattended no-go** (no sandbox recorded, and `auto_edit` approves protected files). The terms question (4) is the user's.

A no-go does not weaken a rule: no agent is run unsandboxed unattended, and no agent's skip-all style mode is used.

### The user's live checks (a scratch repo, the user's own keys and accounts; a real run reads only the user's chosen account)

1. Codex: start the pinned adapter with `INITIAL_AGENT_MODE=workspace-write` and the key in the environment, session `additionalDirectories` set to a scratch worktree; ask it to write a file in the worktree (no card), outside it, in `.git/hooks` and in `AGENTS.md`, and to run a command that uses the network. Record which asked, which failed, and the permission options and tool-path fields seen. Mac and Windows.
2. Codex: whether `bmad-build-auto` loads from `.agents/skills` in a worktree when the skills are committed, and whether `$bmad-build-auto ticket <ref>` runs it.
3. Codex: `git add` and `git commit` inside the sandbox in a worktree whose gitdir and per-run object store are extra roots; does `.git` stay read-only?
4. Antigravity: the terms question for unattended builds (the user's decision), and whether any option gives its commands a sandbox.
5. Grok: whether its sandbox can be started for a headless ACP session with the worktree as the only writable root and no network, and by which key or flag; Mac and Linux.
6. Each: the exact `session/request_permission` options and tool names for an edit and a command, a rejected key, a usage limit and (Antigravity) an expired sign-in message, and the time and token cost of one small build (a finding for the report only; nothing is stored, AD-8).

### Decision (pending, the user)

Go, attended only, or no-go, for each of Codex, Grok and Antigravity, recorded as a dated Decision in epic 17's Notes. Until then entries 2 and 3 can be built against the fake personalities with Codex as the tracer's agent (the one the recommendation favours); entries 5, 6 and 7 wait for the decision.

### Review (quick)

Triage log in `## Review Triage Log` below.

## Review Triage Log

- Security (one pass): the probe wrote only temp folders and ran only the fake personalities with dummy keys; no real agent, keychain, network or `~/.codex`, `~/.grok`, `~/.gemini`, `~/.claude` was touched. KEEP.
- Correctness (one pass): the first Windows failure was the probe's 8.3 temp path, not the policy (the policy refuses short names by design); fixed in the probe and rerun green. The probe proves the shared policy on the generic `edit` shape only; each real agent's shapes are live checks, said above. KEEP.
