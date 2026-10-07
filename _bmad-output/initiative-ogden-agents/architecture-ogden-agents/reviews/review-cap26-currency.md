# Review — currency (AD-24, AD-25, AD-26: Jira sync, field mapping, authentication)

Scope: verify every factual/technical claim about Jira and Atlassian OAuth in AD-24, AD-25 and AD-26 against current reality on the web (not training-data assumption), as of 2026-10-07. AD-15/16/17 read only for context on the patterns these ADs build on; not re-verified here.

**Overall verdict: needs-fixes.** Every claim checked is directionally correct and none is fabricated, but two points materially understate a real gap (API token lifecycle/scoping churn, and PKCE's actual unavailability for Jira Cloud OAuth apps), and one piece of terminology ("Jira Data Center/Server") is stale. None of these overturn AD-26's conclusion (API token over OAuth) — if anything they strengthen it — but AD-26's own stated reasoning needs a correction, and AD-26/CAP-26 should account for token expiry now that it's a near-term operational fact, not a hypothetical.

---

## 1. Jira Cloud REST API: `GET /rest/api/3/myself` and Basic Auth (email + API token)

**Claim (AD-26):** "Before saving, Ogden makes one read-only test call (`GET /rest/api/3/myself` or the Data Center equivalent)..." Implicit in AD-25/AD-26: Basic Auth with email + API token is the current, supported way to call Jira Cloud's REST API.

**Verdict: correct, but incomplete — flag for fix.**

- `GET /rest/api/3/myself` is still live and is exactly the lightweight "whoami" smoke-test call it's used for here: it returns the authenticated user's profile and is Atlassian's own recommended way to validate a token. No deprecation notice targets it (the only Jira Cloud API deprecations found are the 2018–2019 user-privacy/username→accountId migration and the Oct 2024→May 2025 removal of the old `/rest/api/3/search` family — unrelated endpoints).
- Basic Auth with `email:apiToken` base64-encoded in the `Authorization` header against `https://<site>.atlassian.net/rest/api/3/...` remains Atlassian's documented, current mechanism for Jira Cloud API tokens. This part of the AD is accurate as stated.
- **What the AD misses:** Atlassian has been actively changing the API token model since late 2024, in two ways relevant to a credential Ogden will store for however long a board stays linked:
  1. **Expiry:** Atlassian now defaults new API tokens to a maximum 1-year expiry (configurable down to 1 day), and — more sharply — set *all* tokens created before 2024-12-15 to expire on a rolling basis between **2026-03-14 and 2026-05-12**. Relative to this document's date (2026-10-07), that forced-expiry window has already passed, meaning any pre-2024-12-15 classic token still in use anywhere has already been cut over or revoked, and every token a user pastes into Ogden from here on carries a hard expiry of at most one year by policy. Practically: a token Ogden stores today *will* expire on a known horizon, and Ogden has no way to detect that in advance except via a failed sync. AD-24's "failed sync... last-synced... retry" story is the only place this surfaces, and AD-26 doesn't mention token expiry at all — it should, at minimum as a known limitation ("a token can expire; re-auth is pasting a new one"), since this is now a routine operational fact, not an edge case.
  2. **Scoped vs. classic tokens:** since late 2024, Atlassian's token-creation UI offers "Create API token with scopes (recommended)" alongside the old unscoped/classic token, and is steering users toward scoped tokens. The two are not just a permissions difference — **scoped tokens route through a different base URL** (`https://api.atlassian.com/ex/jira/{cloudId}` instead of the site's own `https://<site>.atlassian.net`), which changes what Ogden's `tickets-jira` adapter must do to resolve a working base URL for a pasted token. AD-25/AD-26 assume a single site-URL-plus-token shape; they should at least note that a scoped token needs a `cloudId` lookup (itself an API call, e.g. via `GET /_edge/tenant_info` or the `oauth/token/accessible-resources`-style resolution used for OAuth) rather than using the site URL directly. This isn't a blocker for the API-token approach, but it is a real implementation detail the AD currently omits.

**Suggested fix:** add a bullet to AD-26 noting token expiry as a known limitation, and note that Ogden must handle both classic (site-URL) and scoped (cloudId-routed) token shapes, or explicitly scope v1.2 to classic/unscoped tokens only and say so.

---

## 2. Jira Data Center/Server: Personal Access Token (PAT)

**Claim (AD-26):** "...or a Personal Access Token (Jira Data Center/Server)."

**Verdict: correct on the mechanism; one stale term.**

- PAT is confirmed as Atlassian's current recommended auth mechanism for self-hosted Jira (available since Jira Data Center/Server 8.14+), sent as a Bearer token (`Authorization: Bearer <PAT>`) rather than Basic Auth. Atlassian's own guidance is that existing Basic-Auth integrations *should* be migrated to PATs; some admins can and do disable Basic Auth entirely on Data Center. So treating PAT as the primary/recommended self-hosted mechanism (rather than Basic Auth with a password) is the right call and matches current guidance.
- One meaningful difference from what the AD implies by pairing it with "an API token": a Data Center PAT is **always full-access** (scoped only by the issuing user's own permissions, not by a token-level scope the way Cloud's new scoped tokens are) and admins can set it to expire or never expire. This doesn't change AD-26's rule, just means the "paste a credential, test with `/myself`-equivalent" flow is accurate for DC too (DC's equivalent whoami call is `GET /rest/api/2/myself`, same idea, different API version).
- **Stale terminology:** Atlassian ended support for Jira **Server** on 2024-02-15 (Jira 9.12 was the last Server release; all releases since are Data Center-only). "Jira Data Center/Server" as a live, current pairing is no longer accurate — Server is an unsupported legacy product at this point, not a current self-hosted option alongside Data Center. The AD should say "Jira Data Center" (or "Data Center (and any remaining unsupported Server installs)") rather than presenting them as two current options side by side. Minor, but worth a wording fix since this doc is dated 2026-10-07, well past Server's EOL.

---

## 3. Atlassian OAuth 2.0 (3LO)

**Claim (AD-26):** registered app + client id in the Developer Console (a); public/native client needs PKCE since no client secret can stay secret in a published npm package (b); requires a redirect URI (c); issues a refresh token needing ongoing lifecycle management — expiry, refresh, revocation (d).

**Verdict: (a), (c), (d) correct. (b) is the one real problem — and it's not that the AD overstates the OAuth burden, it understates it.**

- **(a) Registered app + client id:** correct. Atlassian OAuth 2.0 (3LO) apps are created and managed in the Atlassian Developer Console, which issues the client id used in the authorization URL.
- **(c) Redirect URI:** correct. The authorization request's `redirect_uri` must exactly match a callback URL configured for the app in the Developer Console, or the flow fails.
- **(d) Refresh token lifecycle:** correct and if anything the AD is being generous calling this just "lifecycle management." Atlassian's refresh tokens for 3LO are **rotating**: requesting `offline_access` scope gets you a refresh token, but every time it's used to mint a new access token, Atlassian issues a *new* refresh token that must replace the old one in storage, and an unused refresh token expires after a default ~90-day inactivity window. So the lifecycle isn't just "renew before expiry" — it's "store the newest token after every single refresh or the chain breaks," which is a meaningfully heavier lift than a typical OAuth integration and supports AD-26's "the real gap" framing.
- **(b) PKCE — this is the finding that most needs a fix.** The AD frames PKCE as the available mitigation a public client (npm package, no durable secret) would use instead of a client secret — i.e., "it would need PKCE" as though that's a solved, supported path that's merely extra work. **That's not accurate for Jira Cloud today.** Checked directly against Atlassian's own developer community and the live Jira issue tracker:
  - An Atlassian staff member stated outright, in the official developer community thread on this exact topic: *"No. Currently, Atlassian only supports the authorization code flow"* (i.e., not PKCE) for Jira Cloud 3LO apps.
  - A later reply in the same thread reveals PKCE support exists *internally* behind a feature flag not exposed in the Developer Console — so it is technically implemented somewhere in Atlassian's stack but not available to any outside developer registering an app today.
  - The formal feature request for this, **ECO-283** ("[RFC 7636] OAuth 2.0 with Proof Key for Code Exchange (PKCE)") on `jira.atlassian.com`, is still open as of **2026-07-27** (its last update), sitting in Atlassian's "Gathering Interest" pre-triage status with 55 votes / 40 watchers — i.e., not even accepted onto a roadmap, let alone shipped.
  - Atlassian's own documented workaround for desktop/public clients in the meantime is for *each end user* to register their own client id **and secret** and store it locally — which is a worse shape for Ogden than a shared PKCE client, not a substitute for one.

  **Correction to make in AD-26:** rewrite "a public client id with PKCE, since no client secret can stay secret inside a published npm package" to something like: *"a public client id — except Atlassian's Jira Cloud OAuth 2.0 (3LO) does not currently support PKCE for public clients (confirmed open, unresolved as of mid-2026, Atlassian feature request ECO-283); the only flow the Developer Console exposes needs a client secret, which a published npm package cannot keep secret, or pushes every user into generating and storing their own client id/secret pair. There is no secretless, single-shared-app OAuth path for Jira Cloud today."* This makes AD-26's actual argument for API-token-over-OAuth stronger, not weaker — the gap is categorical, not just "needs more plumbing" — so the proposed rule doesn't need to change, only its stated reasoning.

---

## 4. Jira Issue Links: "is blocked by" / "blocks"

**Claim (AD-25):** `after` (prerequisites) maps local → Jira only via "Issue Links ('is blocked by')."

**Verdict: correct, current, no changes needed.**

- "Blocks" is one of Jira's default, out-of-the-box issue link types in both Cloud and Data Center, with outward description "blocks" and inward description "is blocked by" — exactly the pairing AD-25 names. It ships by default and is present on virtually every instance (admins can rename/disable it, but it's not something a project has to opt into the way a custom field is).
- One cosmetic known-issue surfaced in research (JRACLOUD-73372-adjacent reports): because the link type's *name* ("Blocks") and its outward description ("blocks") are identical, some JQL queries against `issueLinkType = "blocks"` can match both directions. Irrelevant to AD-25's one-way local→Jira push via the API (which sets a specific link direction, not a JQL filter), so it doesn't affect this AD, just noting it was the only wrinkle found.

---

## 5. Native vs. custom fields: Summary/Description/Status/Assignee/Issue Type/Priority vs. Story Points

**Claim (AD-25):** Summary, Description, Status, Issue Type, Assignee, Priority are treated as native/reliable sync targets; Story Points is deliberately excluded/never pushed, with the architecture avoiding dependence on it (consistent with the Deferred section's note on only syncing `estimate`→Story Points "later, and only if... the need remains").

**Verdict: correct, and actually under-states how fragmented Story Points is — strengthens AD-25's caution.**

- Summary, Description, Status, Issue Type, Assignee and Priority are system fields present on effectively every Jira project regardless of template, project type or edition — confirmed as the standard field set every Jira issue has. AD-25's table treating these as safe two-way or one-way native fields is accurate.
- Story Points is **not** a universal native field the way those six are, for a more specific reason than "it's a custom field": it's a field Jira *Software* adds (not present at all in Jira Core/Business or Service Management projects), and — within Software projects — **company-managed and team-managed projects use two different, non-interchangeable fields** for the same concept (classic "Story Points" vs. "Story point estimate" in team-managed projects, different field IDs, and Advanced Roadmaps has documented bugs rolling them up together). So "may not exist on a given project's schema" is true, and even where some story-point field does exist, which one depends on project type, so Ogden genuinely cannot assume a single field id project-to-project. AD-25's decision to never sync it, and the Deferred section's gate on "later, and only if the need remains," is well-supported by this — no change needed to the AD, this just confirms the caution was warranted and for a slightly richer reason than a generic "custom field" framing suggests.

---

## Summary table

| # | Claim | Verdict |
|---|---|---|
| 1 | `/myself` as whoami test, Basic Auth email+token current | Correct, but omits imminent token-expiry policy and scoped-token base-URL split — add as known limitation |
| 2 | PAT is current DC/Server recommendation | Correct mechanism; "Data Center/Server" pairing is stale wording (Server EOL'd 2024-02-15) |
| 3a | Registered app + client id | Correct |
| 3b | Public client needs PKCE | **Not currently available for Jira Cloud 3LO** (unresolved Atlassian feature request, "Gathering Interest" as of 2026-07) — rewrite AD-26's reasoning, conclusion unaffected |
| 3c | Redirect URI required | Correct |
| 3d | Refresh token lifecycle | Correct, and the real shape is rotating refresh tokens (must persist newest token every use) — slightly heavier than "lifecycle management" implies |
| 4 | "Blocks"/"is blocked by" default link type | Correct, no changes |
| 5 | Six native fields vs. non-universal Story Points | Correct; Story Points fragmentation (Software-only, and split by company-managed vs. team-managed) is sharper than the AD implies, reinforcing its caution |

## Sources consulted
- Atlassian Support: Manage API tokens for your Atlassian account (scoped vs. classic tokens, expiry policy)
- Atlassian Developer: Jira Cloud REST API v3 docs and `/myself` usage patterns; OAuth 2.0 (3LO) apps docs (developer console, redirect URI, `offline_access`/refresh token rotation and 90-day inactivity expiry)
- Atlassian Developer Community thread: "OAuth 2.0 with Proof Key for Code Exchange (PKCE)" (staff reply confirming no PKCE support exposed for Cloud 3LO apps)
- `jira.atlassian.com/browse/ECO-283` (PKCE feature request, status "Gathering Interest", last updated 2026-07-27)
- Atlassian/community documentation on Jira Data Center PAT (Bearer auth, 8.14+, full-access-per-user scoping) and Jira Server end of support (2024-02-15, last release 9.12)
- Atlassian issue-linking model docs and community reports on the default "Blocks" link type
- Atlassian Community threads on Story Points as a Jira Software field, and company-managed vs. team-managed field divergence
