/**
 * `tickets-jira` (epic 18; CAP-26, AD-27, AD-28, AD-29): the Jira-backed
 * `TicketStorePort`, alongside `tickets-v7`. Jira's own vocabulary (Issue
 * Type, Epic link, Priority, Issue Links, its REST endpoints) is known only
 * inside this adapter, never in `packages/core` or `packages/shared`
 * (AD-27, AD-12).
 *
 * This package currently ships the pieces epic 18's stories 1-4 complete:
 * the real {@link JiraLinkPort} (`jira-client.ts`, the pre-save test call
 * and classic-token base-URL resolution) and whole-value credential
 * redaction (`redact.ts`). The full `TicketStorePort` decorator — reading
 * and writing a linked board's tickets, polling, and conflict detection
 * (stories 5-9) — is not yet built; see the epic's `tickets.toml` for what
 * remains.
 */
export * from './jira-client.js';
export * from './redact.js';
