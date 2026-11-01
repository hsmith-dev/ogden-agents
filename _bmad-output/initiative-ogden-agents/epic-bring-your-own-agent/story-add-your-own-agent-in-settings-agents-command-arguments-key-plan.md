---
title: 'Add your own agent in Settings, Agents'
type: 'feature'
ticket: '3'
created: '2026-10-31'
status: 'built'
baseline_revision: '5c8997cab11d419c7b2f08246a7770c5f2cc6904'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'auto'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-bring-your-own-agent/epic-bring-your-own-agent.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A custom agent can be saved, changed and removed through the API (21.2), and Settings has no way to add one, test it, or remove it (E21-R2, E21-R3).

**Approach:** `/settings/agents/new` takes a name, a typed command, optional arguments and an optional key. Test starts that command once, reports what `initialize` advertises, and stops it. Each saved agent is a card on `/settings/agents` that says its limits and removes it after confirmation.

## Boundaries & Constraints

**Always:**
- Resolve the command with `resolveLinkedCommand` before save and before Test. Show its plain reason. Save nothing on refusal.
- Arguments join the one stored `commandLine` (empty Arguments stores Command alone; otherwise append after a space). `splitCommandLine` parses the result.
- The key is write-only. Responses, the card and events carry `hasKey` and `keyEnvName` only. After save the field is cleared and the value is never shown again.
- Test of a saved agent uses that row's command and keychain key, and ignores any command in the body. Test before save uses the typed command and typed key, stores nothing, and logs neither.
- Routes stay on the AD-15 gate, `no-store`, `{ error: { code, message } }`.
- The card says: it is the person's own agent and Ogden asks before everything it does; Ask only; it needs project trust; it never builds unattended; it cannot be an orchestration worker.

**Never:**
- A file dialog. The page has no IPC (`desktop-app.ts`, AD-15). The command is typed.
- Modes and models on Test. They are not on `initialize`. Test does not open a session. Entry 5 owns that.
- Enforcing Ask only, trust, unattended builds, orchestration, or the read-only removed-agent chat. Entry 4. Removal still keeps the chats.
- Changes to built-in agent cards. No `process.env` on the probe. The child is always stopped.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Add | name, command, optional arguments and key | 201 and a card; key field empty | |
| Bad command | missing, relative, or not runnable | resolver's sentence; nothing stored | 400 `custom_agent_command_invalid` |
| Bad variable | `PATH`, `my_api_key`, `LD_PRELOAD_API_KEY` | schema sentence; nothing stored | 400 `invalid_request` |
| Test before save | fake agent's command, optional key | lines from `initialize`; no row; process gone | one sentence, `agent_unavailable` |
| Test saved | stored fake agent | same lines; its key reaches only that process | 404 `custom_agent_not_found` |
| Remove | confirm Remove | 204; card gone; chats remain | Keep it leaves the card |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/acp-base/acp-agent.ts` -- `listAuthMethods` (191) already runs `initialize` and kills the child. Return `opened.init` from that path. Do not change auth listing.
- `packages/adapters/src/acp-custom/custom-agent.ts` -- `probeCustomAgent` reuses this file's quirks and `resolveLinkedCommand`.
- `packages/shared/src/custom-agents.ts` -- `{ commandLine, apiKey? }` in, `{ lines }` out. Lines from the agent name, resume, load, and prompt flags `image`, `audio`, `embeddedContext`.
- `packages/shared/src/api.ts` (316) and `packages/server/src/custom-agent-routes.ts` -- `POST /custom-agents/test` (static, first) and `POST /custom-agents/:agentId/test`. Saved test reads the row and key in `start-custom-agents.ts`. `noStore` stays.
- `packages/server/test/gate.test.ts` (643) -- both new routes.
- `packages/web/src/routes/agents-settings-page.tsx`, `router.tsx` (46) -- link, cards, `/settings/agents/new`. Not inside `AgentCard`. Remove copies `local-endpoints.tsx`. The key field copies `ApiKeySection` without the last four.
- `tests/fixtures/fake-acp-agent.mjs` -- default `initialize` has no resume and no prompt capabilities. Playwright asserts those lines. `tests/e2e/agents-settings.spec.ts` is the harness to copy.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/custom-agents.ts` -- schemas and line builder; unit test for resume, load, prompt flags, and a missing name.
- [x] `packages/adapters/src/acp-custom/custom-agent.ts` -- probe on the existing kill path; test the fake agent for the default report, `FAKE_ACP_RESUME=resume`, exit-at-start, and a relative command refused before spawn.
- [x] `packages/server/src/custom-agent-routes.ts` -- both Test routes, the gate list, and server tests for the matrix, including the key absent from the response, database, events and logs, and the child exited.
- [x] `packages/web/src/agents/custom-agent-form.tsx` -- form, card, Test, save, inline remove, refetch on `settings.custom_agent_changed`. DOM test: bad command, forbidden variable name, key not left in the document.
- [x] `tests/e2e/custom-agents.spec.ts` -- add the fake agent, Test lists the default lines, both refusals are plain sentences, and the key is absent after save.

**Acceptance Criteria:**
- Given the fake agent, when a person adds it and presses Test, then the page lists what `initialize` advertised and the process is gone.
- Given a command that does not resolve, or a forbidden variable name, when they save, then one plain sentence shows and no card appears.
- Given a saved key, when the card renders, then the value is not in the document.
- Given `pnpm typecheck` and the new tests, when they run, then they pass and built-in agent tests stay as they are.

## Implementation Notes

- Picked up from another agent's plan (written 2026-10-31 13:28, no code yet); its Code Map was checked against the repo and holds.
- Test: `AcpAgentPort.probe` (acp-base) returns the `initialize` answer on the existing probe path (process stopped, no session); `probeCustomAgent` maps it to `CustomAgentAdvertised`; shared `customAgentTestLines` words it. Unsaved Test resolves the command first (400 like Save), runs in a chat environment under an id no slug can produce (`custom--test`) plus the typed key only, and waits 20 s. A failed start is 422 `custom_agent_test_failed` (new code; `details.reason` is the agent error's code).
- Command and Arguments join through shared `joinCommandLine`: the program is quoted (backslashes and quotes escaped) when it has a space or quote, so it round-trips through `splitCommandLine` (adapter test with Windows and POSIX paths).
- Fake agent: `FAKE_ACP_PROMPT_CAPS` advertises prompt capabilities.
- Web (built by a subagent, verified here): the form and cards live in `packages/web/src/agents/custom-agents.tsx` (not `custom-agent-form.tsx`) with `custom-agents-api.ts`; `/settings/agents/new` is the Agents page with the form open. Command is typed: EXPERIENCE.md's "Choose file" is left out, as the frozen block says (no IPC on the page).
- Verified after the review patches: `pnpm run build`; Playwright `custom-agents.spec.ts` 2 passed; `pnpm test` 5049 passed, 8 skipped (404 files).
- Earlier (subagent): `pnpm typecheck` clean; `custom-agents.dom.test.tsx` 13 passed; web tests 894 passed; Playwright `custom-agents.spec.ts` 2 passed and the agents, endpoints and route-stub specs 13 passed (subagent run, on a build with this story's server changes).

### Audit of 21.1 and 21.2 (2026-10-31, fresh reviewer, code only)

Verified first: the full suite after 21.2's review fixes is green (5014 passed, 8 skipped, 402 files). Findings and what was done:

| # | Finding | Verdict | Done |
|---|---|---|---|
| 1 | On Windows a bare name resolved to npm's extensionless shim (or a `.cmd`), which can't start without a shell: saved, then every chat fails | medium | patch: `resolveLinkedCommand` takes only `.exe`/`.com` on Windows and refuses a script in plain words; also fixes epic 12's linked command; tests updated |
| 2 | Tool path fields are guessed, so a caution level can auto-allow an edit naming an unknown path field; `modesNote` overclaimed | medium | note corrected; fix stays in 21.5 (deferred-work entry raised to confirmed medium) |
| 3 | `isAgentIdInUse` missed a project's build default and team roster | low-medium | patch, with a core test. The install-wide roster default lives in a file outside the database: left to entry 4's removal cleanup |
| 4 | PATCH whose re-register fails left the row changed while the old registration ran | low | patch: the row is put back |
| 5 | No test of a bare program name on PATH | low | server test added |
| 6 | Keys under 4 characters escape masking | low | keys need 8 or more |

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens), 2026-10-31: medium 3, low 3; nothing high

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | The agent's own `agentInfo` name and version reach the page unmasked; an agent echoing its key would show it | medium | patch: masked with `secretValues(env)` before the cut |
| 2 | A PATCH changing the key with the name or command, whose re-register fails, still changed the key | medium | patch: register first (as it will be saved), so a refusal changes nothing; restore logged |
| 3 | Remove and Keep it replace the focused button, dropping keyboard focus to the page | medium | patch: focus moves to Remove, then back to Remove agent; DOM test |
| 4 | Test had no limit: repeated presses start many agent processes | low | patch: one Test per agent (and one unsaved) at a time, else 409 `custom_agent_test_running` |
| 5 | No test proves the key reaches Test, or that another agent's does not | low | patch: fixture `FAKE_ACP_TITLE_ENV`; server test for unsaved, saved and another agent |
| 6 | e2e's key check ran after the form unmounted | low | patch: checked after a refused save with the form still open |

## Design Notes

Test stops at `initialize`. Entry 5 owns modes and models. The card edits the stored command line as one field. Removal asks "Remove {name}?" and "Its chats stay."

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm exec vitest run packages/adapters/test/custom-agent.test.ts packages/server/test/custom-agents.test.ts packages/shared/test packages/web/test` -- expected: pass
- `pnpm exec playwright test tests/e2e/custom-agents.spec.ts` -- expected: add, Test, both refusals, and the hidden key pass
