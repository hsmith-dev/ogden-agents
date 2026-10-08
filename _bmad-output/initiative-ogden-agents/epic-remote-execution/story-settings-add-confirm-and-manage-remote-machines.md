---
id: 3
type: story
title: "Settings: add, confirm and manage remote machines"
parent: epic-remote-execution
covers: [R6]
after: [1, 2, epic-first-run-onboarding]
hitl: false
risk: medium
---

# Settings: add, confirm and manage remote machines

## Description

Adds the remote-machine-linking UI in Settings: an 'Add machine' form (host, port, username, display name), a blocking host-key confirmation card modeled structurally on PermissionCard/the Skip-all AlertDialog (pending -> resolved two-state render, data-testid conventions, no default focus on the confirm action, the public key and its exact authorized_keys line shown with a copy action since Ogden cannot install it on the user's behalf), a list of added machines with connection status and a Remove action, and the plain-language refusal copy for a refused (changed) host key. New copy follows the no-dashes convention already used elsewhere in Settings.

## Acceptance Criteria

Verify: Component tests (packages/web) and a Playwright e2e spec (tests/e2e) against the fake RemoteHostPort/SSH adapter: adding a machine shows the fingerprint and the exact public key line, the machine is unusable until Confirm, Confirm records the pin and collapses to a one-line record exactly like a resolved permission card, a machine whose host key the fake adapter reports as changed is shown refused with plain-language copy and no re-prompt, and Remove deletes the machine's stored credential (verified by asserting SecretStorePort.get returns undefined after).

## References

- parent — _bmad-output/initiative-ogden-agents/epic-remote-execution/epic-remote-execution.md
- packages/web/src/permissions/permission-card.tsx
- packages/web/src/permissions/permission-mode-picker.tsx

## Notes

- Decision (implementation, 2026-10-07): the public key does not exist until the first successful confirm (story 18.2 generates it as part of confirming, not before), so it cannot be shown on the pending card itself — the pending card shows only the live fingerprint and the Confirm action; once confirmed, the machine's row offers a persistent "Show public key" disclosure (not a one-time toast) so the user can retrieve the exact authorized_keys line at any later time too, in case they navigate away before adding it to the remote machine. Judged more robust than a transient "copy it now or lose it" moment.
- Scope correction: "a list of added machines with connection status" is read here as the machine's confirm status (unconfirmed vs confirmed), not a live SSH reachability probe of a confirmed machine — actively checking whether an already-trusted machine is currently reachable is part of actually connecting to it (stories 18.4/18.5's territory, e.g. a chat or build attempt failing with a plain reason), not this settings page. Added a REST route pair (`host-key/check`, `host-key/confirm`) and the shared response schemas beyond what was explicitly named, since the pending card needs to read the live fingerprint before the user can confirm it.
- Added `ssh2` as a real (not mocked) dependency surfaced two interop bugs only the real build (not vitest) caught: `import { utils } from 'ssh2'` fails at runtime under Node's native ESM loader (cjs-module-lexer does not detect `utils` as a named export of ssh2's CommonJS module, though it detects `Client`) — fixed with a default import destructured afterward, in both `remote-host-ssh/index.ts` and its test. Flagging here since it is exactly the kind of bug `pnpm e2e`'s real build is for; `pnpm test`/`pnpm typecheck` alone did not catch it.
