---
title: 'Complete Ogden Agents and release v1'
type: feature
created: '2026-10-06'
status: built
route: full
route_source: auto
review: quick
review_source: pinned
lenses_ran: [quick]
baseline_revision: 3c77281279a64654812163e2a88017afac3fa517
context: [AGENTS.md]
---

<frozen-after-approval reason="User explicitly authorized continuing all work through v1 npm publication, except app signing">
## Intent
Finish inherited work, verify planned functionality, preserve the consistent design while adding customizable themes, promote HarrisonSmith.AI and voluntary Venmo support, correct user-facing documentation, and publish v1 through the existing release pipeline after verification.

## Boundaries & Constraints
Always preserve the existing uncommitted handoff changes and use the repository's architecture, token system, security gate and trusted npm publishing workflow. Maintain truthful release and verification claims. User authorizes parallel agents, development, commits/pushes and v1 publication. Do not sign apps or manufacture cross-platform/provider evidence. Keep hosted software free under MIT and consulting/support optional.

## I/O & Edge-Case Matrix
| Scenario | Input | Expected behavior | Failure |
| --- | --- | --- | --- |
| Inherited integration | Global skills/MCP configuration | Schema-validated persisted settings, gated routes, correct ACP propagation | Structured errors, no secret logging |
| Theme change | Preset or custom palette | Persisted token overrides, consistent layout and readable contrast | Invalid import/colors refused; reset restores defaults |
| Release | Verified 1.0.0 on main | Package installed from tarball then published through GitHub workflow | Unmet credentials or external evidence reported honestly |
</frozen-after-approval>

## Code Map
- packages/core/src/install-settings.ts, db/schema.ts: inherited global settings and migration.
- packages/server/src/settings-routes.ts: incomplete handoff CRUD, currently fails build.
- packages/shared/src/chat.ts, planning-catalog.ts: shared schemas.
- packages/adapters/src/acp-base/acp-agent.ts: ACP session MCP propagation.
- packages/web/src/appearance, routes/appearance-page.tsx, ui/tokens.css: theme behavior and design system.
- packages/web/src/routes/about-page.tsx, shell/status-sidebar.tsx: business and optional support discovery.
- README.md, docs/share, RELEASING.md: user documentation and outdated release instructions.
- .github/workflows/release.yml: existing authoritative npm and unsigned desktop release path.
- _bmad-output/initiative-ogden-agents/deferred-work.md: findings requiring triage against current code.

## Tasks & Acceptance
- [x] Repair inherited global MCP/skills integration and test persistence, validation and gating.
- [x] Implement preset and custom palettes using existing tokens with persistence, reset and import/export.
- [x] Complete business/support presentation without interrupting work.
- [x] Audit numbered epics and resolve applicable functional/security deferrals.
- [x] Correct repository README/share/release documentation with evidence.
- [x] Run typecheck, complete tests, browser and installed-package journeys and packaging checks.
- [ ] Synchronize v1 version/changelog and trigger release after required checks pass.

Acceptance: Given saved theme changes, when reopened, then the app retains a readable consistent palette. Given malformed settings, when submitted, then they are refused before persistence or agent launch. Given a version release, when users install it, then the actual app launches with verified package content. Given unfinished external checks, when documented, then their state is explicit rather than marked complete.

## Implementation Notes
Initial source audit found baseline typecheck and build failures in unfinished global settings. Prior tracked changes preserved in /tmp/ogden-v1-starting-changes.patch. The active npm product is the sibling ogden-agents repo; ogden-aiagents contains its older planning lineage. CLI Claude/Grok audits launched; theme and documentation delegated to scoped agents.

## Plan Change Log

## Review Triage Log

- medium / patch: MCP masker registered all nonempty values, confirmed DEBUG=1 would corrupt output. Reuse secret detection and retain normal configuration values, with regression tests.
- high / patch: URL credentials and bare Authorization token components were missing from masking, confirmed accepted URL/header schema and exact-substring masker. Extract supported credential components or refuse unsupported forms before spawn, then test stream/diagnostic masking.

- medium / patch: unsupported Authorization schemes were rejected only at agent startup; shared save-time validation now refuses them before persistence and retains prior settings. Focused reviewer recheck reports all findings resolved.

## Verification
pnpm typecheck; pnpm test; pnpm e2e; pnpm run pack; pnpm smoke; pnpm e2e:installed. Remote CI supplies Windows/Linux checks. npm metadata and clean registry installation verify publication.

Local evidence (2026-10-06, macOS / Node 26): full unit/integration suite 363 files, 4,574 passed, 8 skipped; complete typecheck and provenance check passed. Exact 1.0.0 tarball installed smoke passed. Custom-theme mobile/desktop persistence and stable-version update checks passed. Final full browser suite: 191 passed. Exact-tarball installed browser journeys: 54 passed, including onboarding, permissions, planning, builds, terminals, and lifecycle. Isolated output directories avoided concurrent artifact collisions. Real provider conversations, other desktop OS interaction and npm registry publication are not implied by fake-agent tests. Temporary inherited installer/patch scripts remain untracked and excluded from the npm whitelist.

Publication follow-through: GitHub repository is public, `NPM_PUBLISH=true`, and reviewer-protected `npm-release` environment with `v*.*.*` tag policy configured. npm trusted publisher cannot be verified through local authentication (`npm whoami` returns unauthorized); registry still reports latest 0.0.0. GitHub CI and tagged release remain the publication gates. Implementation is built; external publication is not complete.
