# Adversarial Review — AD-24, AD-25, AD-26 (CAP-24 remote execution over SSH)

**Reviewer lens:** attack the spine as an adversary. Assume two engineers each build a piece of CAP-24 independently, each obeying every AD to the letter. Look for places they'd still build incompatibly.

**Verdict: FAIL** (on the adopted AD, AD-24 — it is marked `[ADOPTED]` but is not actually buildable in isolation, and it plus AD-25 depend on an entity that doesn't exist anywhere in the entity model). AD-25 and AD-26 are correctly left unadopted and already flag some of their own open questions, but they have additional gaps beyond what they self-flag.

---

## Finding 1 — "Remote machine" is a load-bearing entity that was never added to the entity model (Severity: Critical)

AD-8 (adopted) defines the entire entity hierarchy as `Workspace > Session > Event`, with Run as a child-ish attachment to a build Session, and AD-9 (adopted) enumerates the complete ID prefix set: `ws_`, `ses_`, `run_`, `evt_`, `rule_`. Nowhere in AD-1 through AD-23 does a "remote machine" entity exist.

AD-24, AD-25, and AD-26 all casually introduce and depend on one anyway:

- AD-26 mints keychain entries as `remote-machine-ssh/<machineId>` and talks about "each remote machine," "adding a machine," "per machine" trust.
- AD-25 talks about "whichever target machines," "that machine's own live permission card," "the failed machine," and retrying "just the failed machine."
- AD-24 talks about "a remote target," "the remote machine."

None of AD-24/25/26 say:
- Where a machine record lives (a new DB table? a workspace-scoped list like `workspaces.default_models`? an install-level registry like the `AgentPort`/`AgentId` registry in AD-1's epic-6 note?).
- Whether a machine is scoped to one workspace or shared across the whole install (fan-out "across a Mac/Linux/Windows box" for one ticket strongly implies an install-level registry the user configures once and reuses per ticket/workspace — but this is never stated).
- What `machineId`'s prefix is under AD-9's scheme (no `mach_`/`host_` prefix is listed, and AD-9 binds "all").
- How a Run (AD-8's entity, whose fields are explicitly enumerated as "ticket ref, worktree path, sandbox used, deadline and outcome") records *which machine it ran on*. This field is simply absent. Without it, you cannot implement "retry just the failed machine" (AD-25) or look up which `remote-machine-ssh/<machineId>` credential a given Run's remote step should use (AD-26) — both AD-25 and AD-26's own worked examples require a Run → Machine link that no AD defines.

**Two engineers, both AD-compliant, would diverge concretely:** Engineer A stores machines as rows on the workspace (reasoning: "workspaces hold BMad pieces and default agent, AD-2/AD-22, so project-scoped config belongs on the workspace row"). Engineer B stores machines at install level in `agent_settings`-style config (reasoning: "a physical SSH-reachable box isn't project data, and the user will want to reuse the same Mac/Linux/Windows targets across every workspace, per CAP-24's own motivating case"). Both satisfy every AD as written — there's no AD that picks one — and they produce incompatible schemas, API routes (`/api/v1/workspaces/:wsId/machines` vs. an install-level `/api/v1/machines`), and permission/trust models the moment someone tries to fan out tickets from two different workspaces to the same physical boxes.

**Fix:** AD-24/25/26 (or a new AD-8 amendment note, matching the doc's own convention of amending AD-8 in place for new entity fields) must add Machine as a named entity with an owning scope, an AD-9 ID prefix, and an explicit field on Run (or on a join row) recording which machine a given Run executed on.

---

## Finding 2 — AD-25 contradicts its own "exactly one mergeable diff" claim (Severity: High)

AD-25's first bullet asserts: *"A ticket's build still produces exactly one mergeable diff, from exactly one authoring Run... Fanning a build out across machines does not mean each machine's agent writes its own competing diff: the other target machines each run a verification Run... authoring no new code beyond what that model already lets a single run do (for example, an agent fixing an OS-specific test failure it hits)."*

This is internally inconsistent. If a verification machine's agent is permitted to author a fix for an OS-specific failure it hits, that machine now has produced its own diff — divergent from the "authoring" machine's diff — which is precisely the "competing diff" the bullet opens by ruling out. AD-25 never says:
- Which of the N Runs is "the authoring Run" (no `role`/`isAuthoring` field is proposed anywhere, including in the "N ordinary Runs sharing one fanOutId" bullet, which treats all N as symmetric/ordinary).
- What happens to a verification machine's self-authored fix at approve time: is it merged too (making it not "one diff"), discarded (silently losing a legitimate OS-specific fix), or does it block approve as `failed`/`blocked` until manually reconciled (which AD-25 doesn't describe either)?
- Whether AD-24's "read the remote diff back... before recording outcome" applies per-machine (reading back N diffs) or only for the one designated authoring machine — AD-24 was written for the single-machine case and says nothing about N.

**Two engineers, both AD-compliant:** Engineer A reads the headline claim literally and builds approve to merge only one hardcoded/first-dispatched Run's diff, treating every other machine's Run as read-only verification — so an agent's legitimate OS-specific fix on machine 2 is computed, diffed, and then silently thrown away because nothing merges it. Engineer B reads the parenthetical and builds verification Runs to surface their diffs as mergeable too, expecting some reconciliation/second-diff path at approve — which AD-17's single-diff, approve-only, never-force-merged model was never designed to support. Neither is wrong per the letter of AD-25; they are incompatible, and the gap is bigger than the "confirm this reading" caveat AD-25 already attaches (that caveat is about one-vs-N *authored* diffs; this is about the model's own example contradicting its own headline rule even under the "one authoring diff" reading).

---

## Finding 3 — AD-24 has no outcome mapping for an SSH drop, and no process-reaping rule (Severity: High)

AD-24's read-back step ("the remote's resulting diff is read back over the same SSH connection before the run's outcome is recorded") assumes the SSH connection is still alive when the run finishes. Nothing addresses:

- **Mid-run drop:** AD-3 (adopted) says *"only the server spawns and stops agent processes"* and treats a lost connection to a local process as the process being gone → session goes `idle`/resumable, with a separate unattended-run carve-out (AD-3's epic-5 note: an unattended run is *not* resumed; a crash/reboot leaves it `blocked`/`interrupted`, worktree kept, user retries by hand). AD-24 never says which of these a dropped *SSH* connection maps to for a remote run. Is a mid-run SSH drop `blocked` (retriable, matching the "interrupted" local case) or `failed`? AD-8's five outcomes (`running, verified, failed, blocked, stopped`) have no reason code reserved for this.
- **Orphaned remote process:** if the SSH connection drops while the remote agent process is still running, the controller has lost its only channel to stop that process (AD-3's exclusive "only the server spawns and stops" guarantee is now unenforceable against a process it can no longer reach). AD-17's "contained" framing (sandboxed, bounded by wall-clock, never reaching `done` without a person) silently weakens for the remote case: a run the controller believes `blocked`/`interrupted` may still be mutating files on the remote box, unsandboxed from the controller's perspective, until the user manually intervenes on that machine. No reconnect-and-kill, reconnect-and-adopt, or "treat as poisoned, always retry fresh" rule is stated.
- **Drop between remote completion and read-back:** if the remote agent finished (diff exists on disk on the remote) but the SSH session drops before read-back, is the next attempt a reconnect-and-re-read, or does "Update and retry" (AD-17) always re-sync from scratch per AD-24's "one-shot, not an ongoing mirror" rule — discarding a diff that might already represent a `verified`-quality result, forcing a wasted re-run?

**Two engineers, both AD-compliant:** Engineer A maps every SSH failure to `blocked`/`interrupted` (reusing AD-3's local crash pattern) and implements a reconnect-and-re-read-diff path for the "finished but not read back" case. Engineer B maps any SSH failure to `failed` outright (simpler, and "the connection is just another tool call that errored") and always forces a fresh AD-24 one-shot resync on retry, never attempting read-back reconnection. Both are AD-compliant; the resulting board/approve semantics (can this run be retried in place vs. must it restart; does a transient network blip cost a full rebuild) differ, and a user fanning a ticket across three machines would see inconsistent recovery behavior depending on which engineer's adapter is wired to which `<port>-<variant>`.

---

## Finding 4 — AD-24 is marked `[ADOPTED]` but is not actually buildable without AD-26 (Severity: High)

AD-24's own rule text says the sync "rides... the same SSH connection CAP-24 uses to spawn the agent" and that "the remote machine is never given... a credential to the project's origin remote: it receives exact bytes" — i.e., AD-24 takes for granted that *some* SSH credential already exists and is usable ("the SSH credential CAP-24 already requires"). It does not itself define how that credential is stored, retrieved, or how the target host is authenticated (host-key trust). That is entirely AD-26's content — and AD-26 is explicitly *"proposed, not adopted — needs the user's go/no-go"*, closing with: *"No build ticket should cite this AD until the user has confirmed or adjusted it."*

That leaves a direct contradiction in the document's own status markers:
- The Capability → Architecture Map row for CAP-24 lists `AD-24; AD-25 and AD-26 proposed, not adopted` — implying AD-24 stands on its own as the adopted, buildable part.
- But AD-24's adapter (whatever actually opens the SSH connection and streams the worktree) cannot be built without *some* answer to "where does the SSH credential come from and how is the host authenticated" — and the only AD that answers that is the one a build ticket is forbidden from citing.

So AD-24's `[ADOPTED]` status is premature: no build ticket can actually implement it yet, despite its tag saying otherwise. This should either (a) be flagged as adopted-but-blocked-on-AD-26, with that dependency stated explicitly in AD-24's own text instead of only implied by "the SSH credential CAP-24 already requires," or (b) AD-24 should not be marked `[ADOPTED]` until AD-26 (or some minimal stand-in) is.

This is exactly the trap the review brief asked about: AD-25 and AD-26 do *not* get to proceed independently of each other's and AD-24's open questions — all three are coupled through the undefined credential/machine model, even though only two of the three carry the "proposed" tag.

---

## Finding 5 — Remote worktree path/namespacing and lifecycle are undefined, inviting a cross-run collision (Severity: Medium)

AD-24 says the server streams "that worktree's tracked contents to a matching path on the remote machine" and explicitly defers the adapter/port surface as "an implementation detail for the build ticket." But it never states that the remote path is namespaced per-run (e.g., by `run_<ulid>`), nor what happens to a remote worktree after the run (cleanup on approve/done? kept like AD-17 keeps local worktrees after an interrupted run? overwritten in place on retry, or written fresh?).

**Two engineers, both AD-compliant:** Engineer A mirrors the controller's own data-dir path verbatim (`<matching path>` read literally as "the same relative path"), which is not run-scoped on the controller side either (AD-17 just says "the user data directory," not a run-id-qualified path) — so two concurrent runs to the *same* remote machine (two different tickets, or an original run plus its own retry while the first attempt's remote copy hasn't been cleaned up) can target the same remote directory and corrupt each other's in-flight worktree. Engineer B independently decides to namespace by `run_<ulid>` on the remote side only, avoiding the collision — but now "Update and retry" (which AD-24 says "re-syncs and reruns") either leaves every prior attempt's remote directory as permanent garbage, or Engineer B has to invent a cleanup rule unilaterally, which a third engineer building the cleanup/GC adapter won't know to expect.

AD-2's per-workspace/global concurrency limits are stated to be "enforced in core," but nothing says a limit is enforced *per remote machine* — so core's existing concurrency guard doesn't by itself prevent this collision; it has to be closed at the remote-path level, which AD-24 leaves open.

---

## Finding 6 — `fanOutId` is described as "no change to the Run/outcome model," but it is a schema change, placed outside AD-8's own amendment convention (Severity: Medium)

Every other change to the Run/Session entity model in this document (agentId, model, agent_changed/handoff, driver, permission_mode) is recorded as a dated `Note` directly under **AD-8** itself — that is this document's established convention for entity-model amendments, visible throughout AD-8's note list. AD-25 instead adds a new field to Run (the optional `fanOutId`) entirely inside its own section, under CAP-24, while asserting "no new entity, no change to the Run/outcome model." Adding a field *is* a change to the Run model, even if the enum of outcomes is untouched — the claim conflates "no change to the five-value outcome enum" with "no change to the Run entity's shape," and only the first is actually true.

This matters because AD-25 doesn't specify the layer: is `fanOutId` a persisted column on the `runs` table, or is it metadata that only ever appears inside `run.*`/`session.*` event payloads (consistent with AD-25's AD-7-style "fetched, event only invalidates" framing, which might lead an engineer to treat it as event-payload-only, non-queryable state)? AD-8 is explicit that Run *holds* fields (ticket ref, worktree path, sandbox, deadline, outcome) as persisted state, independent of events — so by that pattern `fanOutId` should be a persisted Run column too, but AD-25 doesn't say so, and its own analogy to AD-7 (which is specifically about *not* persisting ticket content redundantly) pulls in the opposite direction.

**Two engineers:** Engineer A adds `fan_out_id` as a nullable column on the `runs` table (matching AD-8's pattern for Run's other fields) and can query "all runs in fan-out X" directly. Engineer B, taking the AD-7 analogy and "no change to the Run/outcome model" at face value, keeps `fanOutId` only in event payloads/a separate dispatch record, with no column on `runs` — so the aggregated-review query Engineer A's UI expects (`SELECT * FROM runs WHERE fan_out_id = ?`) simply has no backing data in Engineer B's build.

---

## Finding 7 — AD-25 layers a second, REST-polled read-model over Run state that AD-8 already governs as live-event-driven (Severity: Medium)

AD-8 states "the live run view is the session view in read-only mode" — i.e., a Run's live state is the same per-session event-log stream (AD-5) every chat/session view already uses, not a separately fetched resource. AD-7's "fetched; events only invalidate" pattern exists specifically because ticket *content* lives outside the event-sourced model, in BMAD files read through `TicketStorePort` (AD-10) — a deliberate exception to AD-5, not the default.

AD-25 imports AD-7's pattern wholesale for the fan-out aggregate view ("fetched, not pushed, following AD-7's pattern... refetches on the existing run.*/session.* events"), while in the very same breath keeping each member Run's *live* per-machine progress and permission cards on the original AD-5/AD-8 event-stream path ("the UI shows per-machine progress, including that machine's own live permission card"). That means the same underlying Run objects are now presented through two different consistency models at once: a REST-polled aggregate (refetched only when a `run.*`/`session.*` event fires) sitting alongside a live per-session WebSocket view of the same Runs. AD-25 doesn't say which is authoritative if they disagree momentarily (e.g., a refetch that lands between two rapid event-driven state transitions on one member Run), nor whether the aggregate is computed server-side (a new endpoint) or client-side (re-deriving the aggregate from events the browser already receives per open session).

**Two engineers:** Engineer A builds a server-side aggregate endpoint (`GET /api/v1/workspaces/:wsId/fan-outs/:fanOutId`) that the UI polls/refetches on event signals, per the literal AD-7 analogy. Engineer B, noting that every member Run's events are already flowing to a UI that has all N sessions open anyway, computes the aggregate purely client-side from the already-subscribed event streams, never calling a new endpoint. If the UI ships assuming Engineer A's endpoint exists and the backend ships assuming Engineer B's client-side approach was sufficient, the combined review view never renders.

---

## Summary Table

| # | Finding | Severity |
|---|---|---|
| 1 | "Remote machine" is an undefined entity: no AD-8 entry, no AD-9 ID prefix, no stated scope (workspace vs. install), no field on Run linking it to a machine | Critical |
| 2 | AD-25's "exactly one mergeable diff" headline contradicts its own allowance for verification-machine Runs to author fixes; no role field, no merge/discard rule for a second diff | High |
| 3 | AD-24 has no outcome mapping or process-reaping rule for an SSH connection dropping mid-run or between completion and diff read-back | High |
| 4 | AD-24 is marked `[ADOPTED]` but is unbuildable without AD-26, which forbids being cited in a build ticket — the two are secretly coupled despite differing status tags | High |
| 5 | Remote worktree path namespacing/lifecycle (collision across concurrent runs to the same machine; cleanup on retry) is left fully open | Medium |
| 6 | `fanOutId` is a Run-schema change described as "no change," placed outside AD-8's own amendment convention, with its persistence layer (DB column vs. event-only) unspecified | Medium |
| 7 | AD-25 layers a second REST-polled read-model over Run state onto AD-8's existing live-event-driven model, with no stated authority/consistency rule between the two | Medium |
