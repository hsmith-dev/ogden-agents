---
id: 7
type: story
title: "Poll on an interval and on Refresh, gated to a watched workspace"
parent: epic-jira-tracker-link
covers: [E18-R7]
after: [6]
hitl: false
risk: medium
---

# Poll on an interval and on Refresh, gated to a watched workspace

## Description

Replaces entry 1's one-shot manual sync with AD-27's real scheduler: a per-workspace timer (default 5 minutes, configurable only in code, not UI, for v1.2) that calls entry 6's full sync only while at least one tab is subscribed to that workspace's event stream (AD-5's existing per-workspace subscription, not any tab open anywhere), starting on the first subscription and stopping on the last subscription's end exactly as AD-27 specifies Ogden's Jira poll should, unlike AD-3's survive-tab-close sessions and runs; the Board's existing Refresh action is wired to the same sync path, debounced to at most once every 10 seconds per workspace; a failed sync (network, auth, rate limit) leaves the Board showing its last-synced local state with a dismissible "last synced at `<time>` — retry" notice, and the next tick or Refresh retries without user action beyond dismissing.

## Acceptance Criteria

Verify: Against the fake Jira server and a fake workspace event-stream subscription, a poll fires on the interval only while a subscription is open, stops within one tick of the last subscription closing, and resumes on the next subscription; clicking Refresh twice within 10 seconds triggers one sync, not two; a sync forced to fail (via the fake server's tamper flag) shows the retry notice and leaves the board's last-known tickets unchanged, and the next tick clears the notice on success.

## References

- parent — _bmad-output/initiative-ogden-agents/epic-jira-tracker-link/epic-jira-tracker-link.md
- _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md#ad-27--jira-sync-is-polled-and-refresh-triggered-never-a-webhook-adopted
