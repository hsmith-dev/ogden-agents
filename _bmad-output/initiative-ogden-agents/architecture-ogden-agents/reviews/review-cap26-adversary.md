# Review — adversarial divergence: CAP-26 / AD-27, AD-28, AD-29

Scope: AD-27, AD-28, AD-29 (Jira tracker link / "Tooling Drive", resolving CAP-26), and their
interaction with AD-1, AD-2, AD-3, AD-7, AD-9, AD-10, AD-11, AD-16, AD-17, AD-22. Reviewed against
CAP-26's intent/success/non-goals in spec-ogden-agents.md.

Verdict: **needs-fixes**. AD-27 and AD-28 are well-reasoned on the problem they were clearly
written to solve (no webhook, no custom Jira fields, no tracker-driven routing) but both leave at
least one load-bearing mechanism unspecified in a way two conforming implementers would fill
differently and incompatibly. AD-29 is explicitly proposed-not-adopted, so its gaps are lower
severity, but one of them (secret shape) would still produce divergent, insecure-by-default code
if adopted as currently worded.

---

## Finding 1 (HIGH) — AD-28's sync baseline has no specified home, and the two natural homes each break a different adopted AD

AD-28's whole conflict rule rests on a value that is neither "the current local file" nor "the
current Jira issue": *"each keeps the value it held at the last successful sync."* That is a third
piece of state — a snapshot taken at sync time — and AD-28 never says where it lives, what shape
it has, or who writes it. Two implementers resolving this literally will diverge, and each
plausible answer collides with an already-ADOPTED rule:

- **Implementer A puts the baseline in SQLite** (a `jira_sync_baseline` table or JSON column,
  keyed by ticket ref + field, holding `{title, body, status, lastSyncedAt}` for each two-way
  field). This is the obvious, fast choice, and nothing in AD-27/AD-28 forbids it. But AD-10 is
  explicit and unqualified: *"The database stores ticket refs only."* A per-field snapshot of
  ticket content is not a ref. Reading AD-10 literally, Implementer A has just put ticket content
  in the database, which is exactly what AD-10 exists to prevent ("the database and the plan files
  disagreeing about a ticket" — now there's a third copy that can disagree with both).
- **Implementer B, respecting AD-10, puts the baseline in a file** — e.g. a sidecar
  `.jira-sync.json` next to the ticket, or an extra frontmatter block (`_jira_sync_snapshot:`) only
  `tickets-jira` reads. This keeps ticket *state* in files as AD-10 wants, but now the file carries
  non-authored, machine-only bookkeeping that `tickets.py mark` and a human editing the file never
  asked for and don't know how to merge — and AD-13 says `tickets.py` runs only from Ogden's
  verified pinned copy, so this snapshot format is an Ogden-only convention BMad's own tool has no
  opinion on. Nothing in AD-28 says this file is git-tracked, gitignored, or how it survives
  `bmad-build-auto` writing into a run's worktree rather than the main checkout (AD-10: "For a
  ticket with an active run, the port reads its plan from that run's worktree"). Does the baseline
  live per-worktree too, and get reconciled on merge? Unaddressed.
- **Implementer C keeps it only in adapter memory** (simplest of all, and arguably what "the
  tracker-store abstraction's existing write and query verbs" in AD-27 most naturally supports,
  since the file-watcher index AD-10 describes is explicitly a *derived, throwaway* cache). This
  silently breaks conflict detection across every server restart: after any restart, the next poll
  has no baseline, so every field that differs from Jira looks either like a clean one-sided change
  (if local is untouched) or — the actual bug — a two-sided change is indistinguishable from this
  state, and AD-28 gives no fallback rule for "no baseline exists." Given AD-3/AD-20's emphasis on
  surviving restarts and version handshakes, an implementer who defaults to the cheapest option
  here produces a sync engine that loses its memory on every restart, with no AD-28 text to catch
  the omission in review.

AD-11 compounds this: *"Adapters... never hold a database handle... Routes call core use-cases."*
If the baseline ends up in SQLite (option A), is it `tickets-jira` writing it directly (violating
AD-11) or a new core use-case written specifically to let an adapter persist its own diffing
bookkeeping (a use-case AD-28 never asks for and AD-1's port list has no slot for)? AD-28 cites
AD-7 and AD-10 as the ports it governs itself under, but says nothing about who owns writing the
baseline, so this ambiguity sits one level below the field-mapping table and is easy to miss in
review because the table (which fields sync which direction) *looks* like the whole spec, while
the thing that makes the conflict rule actually computable — the reference snapshot — is the part
left open.

**Fix shape:** AD-28 needs one sentence saying where the last-synced snapshot lives (most
consistent with AD-10's letter: a small Ogden-only file per ticket, read/written only by
`tickets-jira` through the existing port, never a new DB table), and one sentence on what happens
on the first sync after a baseline is missing or unreadable (treat as "no prior sync," i.e. same
handling as a brand-new tracker-known ticket, never as a silent one-sided win).

---

## Finding 2 (HIGH) — AD-28's `done` exception is one-directional in its text but the table calls `status` symmetric, and the reverse case (Jira closes an issue Ogden never approved) is never ruled on

AD-10 and AD-17 are unambiguous: `done` is written *only* by the approve action, and "merging and
`done` happen only through the approve action." AD-28's own exception text is written entirely
from the local→Jira direction: local reaches `done` via approve, and that push is immediate and
never a conflict candidate. It does not say what happens when **Jira** is the side that reaches a
`done`-equivalent status first — e.g. a human closes the linked issue directly in Jira while the
local ticket is still `in-review`.

The table's row says `status` is "two-way, except the `done` case below." Two readings survive
that sentence equally well:

- **Reading X (symmetric exclusion):** `done` is excluded from two-way sync *in both directions* —
  a Jira-side closed/done status is never pulled down to local status at all, precisely because
  AD-10/AD-17 reserve writing local `done` for the approve action alone. The ticket would show
  `in-review` locally and "Done" in Jira until a human approves locally, by design.
- **Reading Y (only the push is special-cased):** the exception text only describes the local→Jira
  push; nothing says the pull direction is blocked, so an implementer builds the natural "two-way
  except where stated" sync and lets a Jira `done`/closed status flow down and set local status to
  `done` directly on the next poll — bypassing the approve action, its merge, and its verification
  gate (AD-17: "core runs verification before the UI may show built... Merging and done happen
  only through the approve action"). This is a direct, mechanical violation of two already-ADOPTED
  ADs, built by someone who read AD-28's table exactly as written.

Separately and more concretely: ticket is `in-review` locally; a human in Jira moves the linked
issue **backward** (e.g. to a To Do/backlog-equivalent status). AD-28 says this is "changed on
[Jira's] side only since [the last sync]... takes that side's value" — local status should become
`backlog`. But AD-10 says *"Every status change goes through `tickets.py mark`, via that port,"*
stated with no carve-out for tracker-originated changes. Two implementers now diverge on a second
axis: does the Jira-driven pull actually invoke `tickets.py mark` (and if BMad v7's `mark` command
has no verb for moving a ticket backward out of `in-review` — plausible, since `mark` is typically
a forward workflow command — the pull either silently fails, or someone quietly extends BMad's fork
to add a backward-mark verb, which is a change to the pinned fork AD-13 nowhere lists), or does
`tickets-jira` write the frontmatter status field directly, bypassing `tickets.py mark` entirely
(cheaper, works for any status, but is a literal violation of AD-10's "every status change goes
through tickets.py mark")? AD-27's text — "a sync runs through the tracker-store abstraction's
existing write and query verbs... behind the same `TicketStorePort`" — reads as if it settles this,
but it only asserts the sync goes through *a* port verb, not that the verb is `tickets.py mark`
specifically, nor that `mark` supports arbitrary backward transitions.

**Fix shape:** state explicitly whether a Jira-originated `done`/closed pull is excluded from
two-way sync (matching the "only approve writes done" invariant), and state explicitly whether
`tickets-jira`'s status write-back is required to go through the same `tickets.py mark` verb
`tickets-v7` uses — and if BMad's `mark` can't express every transition Jira allows, say what the
port does instead (a direct frontmatter write is probably the right answer, but it then needs its
own sentence in AD-10 carving out tracker-driven writes, since AD-10 as written has no exception
for them).

---

## Finding 3 (MEDIUM) — AD-27's tab-gated polling is consistent with AD-3's letter but not reconciled with it in the text, and "a connected client" is itself underspecified

AD-3's prevents-clause is "work stopping when a browser tab closes," and its rule is scoped to
agent processes/sessions/runs (its Binds are CAP-3, CAP-5, CAP-8). AD-27's polling is a different
kind of "work" — background tracker sync, not an agent computation — and AD-27 is bound only to
CAP-26, so there is no literal rule collision: AD-3 never claims to govern polling cadence for a
tracker adapter. That said, this is exactly the kind of place where a reviewer should check that
the document itself draws the line, because the prose in AD-3 and AD-27 is close enough in
subject ("stops when the last tab... disconnects" vs. "work stopping when a browser tab closes")
that an implementer pattern-matching AD-3's general ethos — "the server decides what runs, not the
browser" — could reasonably conclude Jira polling should also survive tab closure for consistency,
and build continuous server-side polling per linked workspace regardless of tab count. AD-27 never
says why it is deliberately *not* following AD-3's pattern here (API quota is the stated reason,
but the text doesn't connect that back to AD-3 to pre-empt the pattern-match). That omission is
cheap to fix and should be fixed given how central AD-3 is (`Binds: all` sibling ADs usually cross-
reference each other when they deliberately diverge; AD-6, AD-15 and AD-22 all do this routinely).

More concretely divergent: AD-27 says polling runs "only while that workspace has at least one
connected client (an open tab), matching AD-2's per-workspace scoping," but never defines
"connected" against AD-5's actual subscription model. AD-5 says the UI "subscribes to install-level
events after seq N and to each workspace's recent window" — implying per-workspace subscriptions
are a thing a client opts into, not an automatic property of "a tab is open." AD-18's status
sidebar is "the one place to see, open, add and manage projects" and plausibly needs live data
(ticket counts, badges) for every workspace shown in the sidebar, not just the one currently open
in the main view. Two implementers will build:

- **Implementer A:** "connected" = the tab's WebSocket has an active per-workspace subscription
  (AD-5's model). Navigating away from a workspace's board view unsubscribes it, so polling for
  that workspace stops the instant you're not looking at its board — far more aggressive than
  "last tab disconnects" suggests, and probably not what AD-27's authors meant by "a project nobody
  has open."
- **Implementer B:** "connected" = any open tab at all, regardless of which workspace it's showing,
  because the sidebar needs every workspace's live state. This makes "stops when the last tab
  disconnects" nearly meaningless in practice for a user who always has one tab open — it never
  stops regardless of which project they're actually using, undermining the stated quota-saving
  rationale.

**Fix shape:** one clause in AD-27 defining "connected client" in terms of AD-5's existing
subscription primitive (e.g. "a client is connected to a workspace while its WebSocket holds that
workspace's event subscription, per AD-5"), plus a one-line cross-reference to AD-3 explaining why
polling is allowed to stop on tab-close when agent work is not.

---

## Finding 4 (MEDIUM) — AD-29's "one blob" secret shape breaks AD-16's one-key-one-secret pattern and invites a plaintext-JSON fallback by analogy with Codex's documented exception

AD-16's established pattern, used consistently for every other credential, is one secret string
per keychain entry: `agent-api-key/<agentId>` holds exactly one API key. AD-29 proposes
`jira-credential/<workspaceId>` holding "site URL, email and token together" as one value. Two
problems follow directly from that choice, neither of which AD-29 addresses:

1. **Non-secret data gets locked behind the secret store unnecessarily.** Site URL and account
   email are not secrets — AD-29 even calls the token the thing that needs AD-16 protection, not
   these. Bundling them into the one encrypted blob means Settings can't display "Linked:
   mycompany.atlassian.net" without reading from the OS keychain (which can prompt the OS's own
   access dialog on macOS) just to show a label. The AD-16-consistent shape is: site URL and email
   live as plain fields on the workspace row (AD-11, core-owned, no different from any other
   workspace setting), and only the token itself goes through `SecretStorePort` under
   `jira-credential/<workspaceId>` — matching `agent-api-key/<agentId>`'s shape exactly (one key,
   one secret string). AD-29 as worded invites the opposite: a careless implementer serializes all
   three fields to JSON and calls that the "secret," because AD-29's own prose groups them as one
   unit ("holding site URL, email and token together").
2. **No schema, and a precedent for silently falling back to plaintext.** AD-16's Codex note
   explicitly documents a plaintext fallback ("else in a plain `auth.json`... shown to the user as
   a known limitation") for a case where no keychain path exists. AD-29 says nothing about what
   happens when `@napi-rs/keyring` has no backend (AD-16's base rule: "saving a key is refused with
   a plain reason") — does the Jira credential follow the base AD-16 refusal, or, because it's
   structurally a composite JSON blob rather than a bare key (closer in shape to Codex's "no
   keychain support" case than to a plain API key), does an implementer reach for the same
   plaintext-file fallback pattern by analogy, without the "known limitation" disclosure AD-16
   requires for that path? Nothing in AD-29 rules this out, and because the value is already a
   composite object rather than a string, writing it to a plain JSON file is a smaller leap than it
   would be for a bare token. Compounding this, no Zod schema (contrast AD-5's "every event type
   has a Zod schema... nothing unschematized is emitted") is specified for the blob's shape, so two
   implementers' field names (`siteUrl`/`site`/`url`, `apiToken`/`token`) could differ even in the
   adopted-keychain case, breaking the save/read round-trip the moment the two code paths are
   written by different people.

**Fix shape (if AD-29 is adopted):** store only the token through `SecretStorePort` under
`jira-credential/<workspaceId>`, keep site URL and email as plain workspace-row fields under AD-11,
and give the stored value a Zod schema in `packages/shared` the way every other cross-component
contract already has one.

---

## Finding 5 (MEDIUM) — the Jira field-mapping table names vendor concepts with no stated home, risking an AD-1 hexagonal-core leak

AD-28's table names Jira concepts directly — Summary, Description, Status, Issue Type, Epic
link/parent, Assignee, Priority, Issue Links ("is blocked by") — and AD-27 names the adapter that
must know them (`tickets-jira`). AD-12 sets the precedent for exactly this situation: *"Skill names
appear only inside the adapters that must invoke a specific skill."* Nothing in AD-27/AD-28 says
the equivalent for Jira: that this field-mapping table's vendor-specific names live only inside
`tickets-jira`, never in `packages/core` or named generically in `packages/shared` the way the
BMad piece list is (AD-22: "The piece list, labels and dependency rule live in `packages/shared`").
Because AD-22's pattern for *BMad's own* cross-cutting lists is "put it in shared," and this table
superficially looks like the same kind of cross-cutting reference data, an implementer could
reasonably — and wrongly, per AD-1's "core... names no agent, OS, sandbox, CLI or BMAD skill" and
its broader hexagonal intent — place the Jira field-mapping table in `packages/shared` as a named
constant (`jiraFieldMap.ts`) rather than buried inside the `tickets-jira` adapter, on the theory
that it's "contract," not "adapter logic." AD-1's enumerated port list has never needed to name a
vendor concept before (ports are generic: `TicketStorePort`, not "JiraPort"), so this would be the
first crack in that isolation, and AD-28 gives no explicit instruction to prevent it.

A second, smaller instance of the same class: AD-9 says agent session IDs are "adapter refs...
never used as keys or in URLs," and ticket refs follow "BMAD writes them (`2.3`)." A Jira issue key
(e.g. `PROJ-123`) stored on a synced ticket's frontmatter falls into neither category by name —
AD-28 never says whether it's treated as an adapter-ref-like field (AD-9's pattern) or folded into
the ticket-ref namespace, and the difference matters the first time a URL or API path has to
reference "this ticket" and an implementer reaches for whichever identifier is closest to hand.

**Fix shape:** one sentence in AD-28 or AD-12's pattern extended explicitly: "the field-mapping
table and all Jira-specific names live only in `tickets-jira`; core and `packages/shared` name no
tracker." And one sentence confirming the Jira issue key is stored as an adapter-ref-style field,
never used as the ticket ref itself.

---

## Summary table

| # | Severity | Divergence | ADs in tension |
|---|---|---|---|
| 1 | HIGH | Sync baseline's storage location/owner unspecified; DB choice fights AD-10's "refs only," file choice is unaddressed by AD-10/AD-13, memory choice silently breaks on restart | AD-28 vs AD-10, AD-11 |
| 2 | HIGH | `done` exception's reverse direction (Jira closes first) and whether status pull must route through `tickets.py mark` are both left open | AD-28 vs AD-10, AD-17 |
| 3 | MEDIUM | Tab-gated polling doesn't cross-reference AD-3's rationale for diverging, and "connected client" isn't tied to AD-5's subscription model | AD-27 vs AD-3, AD-5 |
| 4 | MEDIUM | Bundling non-secret fields with the token in one blob breaks AD-16's one-key-one-secret shape and has no schema or stated no-keychain fallback | AD-29 vs AD-16 |
| 5 | MEDIUM | No stated home for the Jira-specific field-mapping table risks it leaking into core/shared, breaking AD-1's hexagonal isolation; Jira issue key's identity class (ref vs adapter-ref) is unstated | AD-27/AD-28 vs AD-1, AD-9, AD-12 |
