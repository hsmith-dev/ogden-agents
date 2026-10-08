# Security review — AD-24, AD-25, AD-26 (Jira authentication, proposed)

**Scope:** AD-24 ("Jira sync is polled and refresh-triggered, never a webhook"), AD-25 ("Jira field mapping"), and AD-26 ("Jira authentication: proposed, not adopted"), read against the already-adopted AD-15 ("One security gate") and AD-16 ("Secrets"). The rest of the spine is out of scope for this lens.

**Verdict: needs-fixes.** AD-24's pull-only design is sound and correctly matched against AD-15. AD-26's core choice (API token over OAuth) is defensible, but its risk writeup is one-sided — it argues OAuth's complexity without weighing the static token's own exposure — and it leaves open two concrete gaps: no validation of the user-supplied Jira site URL before the server starts sending credentials to it, and no stated rule for what happens to the stored credential when a board is unlinked. Neither is hard to fix, but both should be closed before AD-26 is adopted.

---

## 1. Credential "blob" — token + email + site URL stored together

AD-26 stores `jira-credential/<workspaceId>` as site URL, email, and token together in one keychain entry (line 380). As a storage decision this is reasonable — one board has one credential, and `SecretStorePort`/OS-keychain already stores compound values (AD-16 line 240 does the same for webhook URLs). That part isn't the problem.

The gap is on the **redaction** side, not the storage side. AD-16's existing redaction rules are keyed to *shape*:
- Agent API keys: "log redaction covers each supported provider's key format" (line 237) — a format/pattern match on the token itself.
- Webhook URLs: the *whole URL* is treated as secret and redacted (line 240) — because a webhook URL doubles as a bearer-token-bearing endpoint, not because it's token-shaped.

AD-26 doesn't say which model applies to the Jira blob. If an adapter's redaction logic is pattern-matched to "things that look like a Jira API token," it will not catch the email or site URL when they appear in a log line or event payload on their own (e.g., `"sync failed for alice@company.com at https://mycompany.atlassian.net: 401"`, or a `ticket.changed`-adjacent debug event). AD-16's existing rule "adapters redact secrets before emitting events" (line 236) is written as if "secret" is one atomic thing per credential; for Jira it's three fields with different sensitivity (token = credential, email = PII, site URL = low-sensitivity-but-still-identifying). The AD should say explicitly that the *whole* `jira-credential/<workspaceId>` value — not just the token substring — is in scope for the adapter's redaction-before-emit rule, matching the webhook-URL precedent rather than the per-provider-token-format precedent. As written, it's ambiguous, and ambiguity here is exactly the kind of thing that produces a PII leak into `data/*.log` later.

**Recommendation:** AD-26 should state that `tickets-jira`'s redaction treats the stored value as one unit (token, email, and site URL all redacted wherever the credential would otherwise be echoed into a log line, error message, or event), not a token-shaped-substring match.

## 2. AD-24's outbound call: SSRF-adjacent risk from an unvalidated user-supplied site URL

AD-24 has Ogden's server initiating outbound calls to a third-party endpoint on a fixed interval — a new kind of network behavior relative to the rest of the adopted spine, which is otherwise almost entirely about *inbound* request gating (AD-15 is inbound-only: Host/Origin checks, bearer tokens, no public endpoint). AD-24's own "Prevents" clause (line 340) is framed entirely in terms of inbound risk ("a Jira webhook forcing the loopback server to accept unauthenticated inbound traffic... against AD-15's... posture") — it does not consider the outbound direction at all.

That matters because the Jira "site URL" is **user-supplied** (AD-26 line 379: the user pastes it in along with email and token) and the server will then attach the stored credential (as an `Authorization` header, presumably) and poll that URL every 5 minutes indefinitely (AD-24 line 343), plus on every Refresh click. There is no stated validation of that URL anywhere in AD-24, AD-25, or AD-26:

- No scheme restriction (is `http://` accepted? should only `https://` be allowed?).
- No check against the URL resolving to loopback, link-local, or other private/internal address ranges (a mistyped or malicious site URL pointing at `169.254.169.254`, `127.0.0.1:<internal-service-port>`, or an internal corporate host would cause Ogden's own server to make a periodic, credentialed request to it, replaying the Jira token's `Authorization` header to whatever actually answers).
- No mention of what happens if the entered "Jira site" is actually attacker-controlled or a proxy that logs headers — i.e., credential replay/exfiltration via a bad site URL is a real outcome given AD-26's design, and nothing in AD-24/25/26 defends against it beyond the one-time `GET /rest/api/3/myself` sanity check at save time (which only proves the URL *works*, not that it's safe to poll indefinitely with the token attached).

**Precedent that should have been cited and matched:** AD-16 line 240 already treats another user-configured outbound destination — the notification webhook URL (`notify-webhook` adapter, line 394/495) — as a secret to be stored and redacted, implicitly acknowledging that Ogden already sends outbound requests to user-supplied URLs elsewhere. AD-24 doesn't reference this precedent or extend whatever validation (if any) exists for webhook URLs to the Jira site URL case. Separately, AD-17's sandboxed unattended-build rule explicitly denies network access by default ("Bash runs in the agent's native sandbox with the same writable roots and **no network**", line 259) — showing the project already treats arbitrary outbound network access as something to be constrained by default elsewhere in the spine. AD-24 grants the server itself (not a sandboxed agent, but still) unconditional, long-lived, credentialed outbound access to a user-typed URL with none of that scrutiny.

**Recommendation:** AD-24 or AD-26 should add: site URL is restricted to `https://`, and the save-time test call (AD-26 line 381) should also serve as the one place that validates/pins the resolved host (or at minimum rejects loopback/link-local/private-range targets) before the interval poller is allowed to start sending the stored token to it on a recurring, unattended basis.

## 3. AD-26's OAuth-vs-token tradeoff is argued one-sided

AD-26's "why OAuth is not the recommendation" paragraph (line 382) is a real and legitimate list of OAuth implementation costs — public-client PKCE, a new inbound redirect-URI surface against AD-15's gate, and an unowned refresh/revocation lifecycle are all genuine, concrete problems, not hand-waving. That reasoning holds up on its own terms.

What it doesn't do is weigh the cost on the other side of the ledger: a **static, long-lived API token** has no built-in expiry at all. If it leaks (via a log line per Finding 1, via a mis-pointed site URL per Finding 2, via a keychain compromise, or via the user pasting it somewhere else by mistake), it grants the finder standing API access for as long as the token is valid — which for a Jira Cloud API token or Data Center PAT is typically until the user manually revokes it, often months. A short-lived OAuth access token (minutes-to-hours) leaking in the same way is a much smaller exposure window, even though the refresh token behind it is itself long-lived and would need its own protection (which is exactly the "lifecycle" AD-26 says isn't owned yet).

So the comparison AD-26 should make explicit is: OAuth moves the long-lived secret from "a token used directly on every request" to "a refresh token used only to mint short-lived access tokens" — trading inbound-surface and lifecycle-ownership cost for a smaller blast radius per leak. AD-26 argues the first cost is real (correct) but never states the second benefit exists, so the tradeoff reads as "OAuth is worse" rather than "OAuth is worse for different, in-house reasons, even though it has an actual security advantage AD-26 chose not to take." That's a reasonable call to make for v1.2 given Ogden's npm-package-public-client constraint — but the AD should say it's a deliberate tradeoff against a known downside (unbounded token lifetime, no revocation-on-leak-detection path), not present the static token as strictly simpler with no offsetting risk. This also means Finding 2's mitigations (URL validation, redaction) matter more here than they would for a refreshable credential, since AD-26's chosen design has no expiry as a backstop.

**Recommendation:** Add one sentence to AD-26 naming the tradeoff: the static token has no expiry/revocation-on-leak mechanism that OAuth's refresh/access-token split would have provided, and the decision accepts that risk in exchange for not taking on OAuth's redirect-URI/lifecycle cost in v1.2.

## 4. Missing: credential lifecycle on unlink

AD-16 establishes a clear pattern of saying explicitly when a stored credential is removed — e.g. line 239, Codex's `auth.json` is "removed on sign-out." AD-26 has no equivalent statement, and more fundamentally, **none of AD-24/25/26 mention an unlink operation at all.** CAP-26's board-linking flow (AD-26 line 379, "Link a Jira board") is described, but nothing in the document says what happens to `jira-credential/<workspaceId>` — or to the synced local tickets — when a user unlinks a board, deletes the workspace, or relinks it to a different Jira site/account.

Left unstated, this is a real gap: an abandoned or stale project could retain a live Jira API token in the OS keychain indefinitely with no UI path shown to remove it, which is inconsistent with AD-16's otherwise-explicit secret-lifecycle discipline (every other credential case in AD-16 states its removal condition). It also interacts with Finding 3: a token the AD itself says has no built-in expiry becomes even more of a liability if there's no deletion path tied to unlinking.

**Recommendation:** AD-26 (or AD-24) should add an explicit rule: unlinking a board deletes `jira-credential/<workspaceId>` from the keychain, matching AD-16's existing "removed on sign-out"-style pattern; and state what happens to already-synced local ticket files on unlink (kept as plain local files going forward, per the tracker-store convention, or something else) so the two concerns aren't left to be inferred.

---

## Summary of recommended changes before AD-26 is adopted

1. State that the whole `jira-credential/<workspaceId>` value (token, email, site URL) is in scope for adapter redaction before emit, not just a token-shaped pattern match.
2. Restrict the site URL to `https://` and have the pre-save test call also reject/flag loopback, link-local, or private-range targets, since the server will poll that URL unattended and indefinitely with the stored token attached.
3. Make the OAuth-vs-static-token tradeoff explicit: the static token has no expiry/revocation backstop that a refreshable OAuth credential would have had; the AD should own that it accepts this risk rather than imply the token has no offsetting downside.
4. Add an explicit credential-deletion rule on board unlink (and state the fate of already-synced local ticket files), matching AD-16's existing removal-condition pattern for every other stored credential.
