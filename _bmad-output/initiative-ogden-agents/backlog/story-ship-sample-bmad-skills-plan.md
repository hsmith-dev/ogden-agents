---
title: 'Ship sample BMAD skills'
type: 'feature'
ticket: '18'
created: '2026-10-07'
status: 'built'
baseline_revision: 'b7fb3216f59d3181d83ed6f2a52a2cb1bb1d3075'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-ship-sample-bmad-skills.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A project with Planning turned on has no sample skill to try without the user first writing one, so CAP-18 ("every installed BMAD skill is usable from the UI without an Ogden Agents code change") has only a placeholder behind it, not real content.

**Approach:** Ship three small, real Claude Code skills (brainstorm a feature, explain this code, draft a mini spec) as content inlined in the `bmad-catalog` adapter; `setup()` writes them into every project skills-folder target through the exact same copy-target list and never-overwrite rule already used for the verified pinned BMad skills, so discovery (`scanSkills`/`buildCatalog`), labelling fallback, and invocation need no change at all.

## Boundaries & Constraints

**Always:**
- Discovery (`scanSkills`, `buildCatalog`) and skill invocation (the planning session, the Skill tool) stay byte-for-byte unchanged; once written, a sample is an ordinary `SKILL.md` under `.claude/skills/` (or another agent's configured folder).
- A project's own skill of the same name as a bundled sample is never overwritten — on a fresh setup, on an upgrade, and in every configured skills-folder target (CAP-19's per-project opt-in untouched).
- Nothing from this is written outside `setup()`'s existing run, so a project with every BMad piece off (so `setup()` never runs) gets none of this on disk and none in the catalog.
- `SKILL.md` content ships as an inlined TypeScript constant, never a loose file: `tests/packaging.test.ts` refuses a packed tarball holding any file named `SKILL.md`, the same rule the verified pinned copy (downloaded, never bundled) already respects.

**Never:** change `scanSkills`/`buildCatalog`'s scan or labelling rules so a sample gets a plain label or its own catalog group; add an "is this a sample" special case anywhere in the discovery or invocation path; bump the pinned BMad Method or an agent's version.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh setup | No `_bmad`, Planning turned on | Three samples written into `.claude/skills` (and any other configured agent folder) alongside the verified pinned skills | No error expected |
| Name clash | Project already has `.claude/skills/<sample-name>/SKILL.md` | The project's own file is untouched; that one sample name is skipped there | No error expected |
| Re-run / upgrade | A previous setup already wrote a sample | The file is left exactly as it is, even if the user edited it since | No error expected |
| Elsewhere on upgrade | Project already has that sample's name in another configured skills folder | Not duplicated into `.claude/skills` on upgrade, the same rule entry 4.11 already applies to the pinned copy | No error expected |
| Every BMad piece off | `setup()` never runs for this project | Nothing on disk, and `scanSkills`/`buildCatalog` report none | No error expected |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/bmad-catalog/sample-skills.ts` (new) -- `SAMPLE_SKILLS`: the three bundled sample skills' names and full `SKILL.md` text, inlined (never a loose file, `tests/packaging.test.ts`).
- `packages/adapters/src/bmad-catalog/setup.ts` -- `BmadSetupOptions.sampleSkills` (defaults to `SAMPLE_SKILLS`); `writeSampleSkillInto` (stage + rename a sample's `SKILL.md`, never overwriting); `createBmadSetup`'s `writeSampleSkills` closure (same target list and never-overwrite / `elsewhere` rule as `copySkills`/`copySkillsInto`); called once, right after `copySkills`, in the existing `copying_skills` step of `setup()` — no new progress step.
- `packages/adapters/src/bmad-catalog/index.ts` -- re-exports `SAMPLE_SKILLS` and `BundledSampleSkill`.
- `packages/adapters/test/bmad-catalog-setup.test.ts` -- `adapter()` now takes `sampleSkills` (default `[]`, isolating the file's pre-existing assertions, as `bmad-catalog-catalog.test.ts` already isolates itself from the shipped `skill-labels.json`); new `describe('bmad-catalog bundled sample skills (story 18, CAP-18)')` covering every row of the I/O matrix above, plus a `plainBmodRepo` helper for the upgrade-fixture tests outside the existing upgrade `describe`.
- `packages/adapters/test/bmad-catalog-sample-skills.test.ts` (new) -- content sanity on the real shipped `SAMPLE_SKILLS`: valid, distinct, `sample-`-prefixed names; frontmatter `name` matches; non-empty description; each *body* (frontmatter stripped first) says plainly it is a bundled sample.
- `packages/server/test/bmad-setup-routes.test.ts` -- `setUpThrough` now also returns `workspace`; new real-uv test in the `describe.skipIf(realUvMissing())` block: after a real `POST .../bmad/setup`, every shipped `SAMPLE_SKILLS` name is on disk, listed by `GET .../catalog`, and `POST .../planning-sessions` with a sample's name creates a `planning` session whose first user message is `/<sample-name>` — the same route, same assertions as the existing `bmad-spec` case in `planning-routes.test.ts`, proving AC1/AC2 end to end through the real production wiring (`start-planning.ts`'s `createBmadSourceAndCatalog` passes no `sampleSkills` override, so it gets the real shipped set).
- Untouched, confirmed by reading first: `skills.ts`, `catalog.ts`, `labels.ts`, `verified.ts` (discovery and labelling), `plan-home.tsx` (Plan UI); `start-planning.ts` read but not edited — it already wires `createBmadCatalog` with no `sampleSkills` override, so the real shipped set reaches it by the option's own default.

## Tasks & Acceptance

**Execution:**
- [x] `packages/adapters/src/bmad-catalog/sample-skills.ts` -- write the three skills' content and `SAMPLE_SKILLS` -- the shipped data, inlined per the packaging guard
- [x] `packages/adapters/src/bmad-catalog/setup.ts` -- add `sampleSkills` option, `writeSampleSkillInto`, `writeSampleSkills`, and the call site in `setup()` -- the write path, reusing the existing target list and never-overwrite rule
- [x] `packages/adapters/src/bmad-catalog/index.ts` -- export the new names -- so a consumer (and the tests) can reach them
- [x] `packages/adapters/test/bmad-catalog-setup.test.ts` -- isolate existing tests via `sampleSkills: []`, add the new `describe` block -- proof against the I/O matrix
- [x] `packages/adapters/test/bmad-catalog-sample-skills.test.ts` -- content sanity on the real shipped data
- [x] `packages/server/test/bmad-setup-routes.test.ts` -- a real-uv end-to-end test that a bundled sample starts a planning session through the production wiring, with no override anywhere (review finding, below)

**Acceptance Criteria** (verbatim from the ticket):
1. Given a project with Planning turned on and no skills of its own, when the user opens Plan, then at least two bundled sample skills are listed and runnable, with no code change and no skill authored by the user.
2. Given a bundled sample skill shown on Plan, when the user starts it, then it runs the same way a user-authored skill would, through the existing skill-discovery and invocation path, with no special-casing for bundled skills.
3. Given a project that already defines a skill with the same name as a bundled sample, when Plan lists that project's skills, then the project's own skill is shown and runs, not the bundled sample.
4. Given a project with every BMad piece off, when the user looks at that project, then no bundled sample skill is shown and nothing from it is written into the repo.

## Implementation Notes

- Read `spec-ogden-agents.md` (CAP-18, CAP-19) and `epic-planning-and-board.md` (E4-R2, E4-R3, E4-R4; AD-12) before designing: skills are discovered by `scanSkillFoldersAt` purely by scanning `.agents/skills/` then `.claude/skills/` for a `SKILL.md` whose frontmatter `name` matches its folder, first folder wins on a name clash — already exactly AC3's rule, with zero code needed from this ticket. The only open question was *where* bundled content gets onto disk at all.
- Found the constraint that decided the design: `tests/packaging.test.ts` asserts the packed tarball holds no file named `SKILL.md` anywhere (story 4.14's packaging guard — the verified pinned BMad copy is downloaded on Set up, never bundled). So sample `SKILL.md` text can't ship as loose files copied by `packages/server/tsdown.config.ts`'s `copy` the way `packages/core/drizzle/*.sql` migrations do; it has to be an inlined constant, the same way `skill-labels.json` already is (`import ... with { type: 'json' }`). Chose a plain `.ts` string export over a `.md`-as-text build loader: zero new build-tool configuration, and it behaves identically under `tsdown` (production) and `vitest` (tests) with no divergence to maintain.
- Reused `setup()`'s existing `copySkills`/`copySkillsInto` target list and never-overwrite semantics as closely as the different source (strings, not a directory to copy from) allows: `writeSampleSkills` is shaped exactly like `copySkills` (same targets loop, same `upgrade && target === SKILLS_PATH` "leave it elsewhere" rule via the existing `elsewhere` closure), and `writeSampleSkillInto` stages beside the target and renames in, exactly as `copySkillsInto` does for a copied folder. This is one step further from "the exact same path" than literally calling `copySkillsInto`, but it is the only option once `SKILL.md` can't be a file on disk in the built package; discovery itself (the actual "same path" CAP-18 cites) is completely unchanged.
- `BmadSetupOptions.sampleSkills` defaults to the real `SAMPLE_SKILLS` but is overridable, mirroring `catalog.ts`'s `LabelOptions` (`labels = SHIPPED_LABELS`, `verifier = UNVERIFIED`). `bmad-catalog-setup.test.ts`'s shared `adapter()` helper now defaults it to `[]` so none of that file's ~24 pre-existing exact `readdirSync(...).toEqual([...])` assertions needed touching; new tests pass a small two-skill fixture of their own, the same isolation `bmad-catalog-catalog.test.ts` already uses for `skill-labels.json`.
- No change to `BMAD_SETUP_STEPS` (`checking`, `copying_skills`, `writing_config`, `verifying`, `packages/shared/src/planning-setup.ts`): writing the samples happens inside the existing `copying_skills` step, right after the pinned copy, so the setup progress UI needs no change and no test asserting its exact 4-step sequence breaks.
- Chose three skills (within the ticket's 2-4 range), each self-contained with no `_bmad/scripts` dependency (unlike every real BMad skill in this repo, which all run `uv run .../render_skill.py`): `sample-brainstorm-a-feature`, `sample-explain-this-code`, `sample-draft-a-mini-spec` — one each for ideation, code understanding, and planning, the three things the ticket's own notes suggested a first-time Planning user would want to try. Each one's first line says plainly it is a bundled sample, and each points at a fuller real skill for anything bigger than its own small scope. None is added to `skill-labels.json`: that mapping only ever labels a skill verified against the pinned upstream copy (`verified.ts`, entry 4.12), which a sample never is, so adding entries there would have no effect and would misleadingly imply they are part of BMad Method itself.
- `packages/core` and `packages/web` needed no source change at all. `packages/server`'s own source (`start-planning.ts`) also needed none — read it to confirm its production `createBmadSourceAndCatalog` wiring passes `{ runner, workDir, source }` with no `sampleSkills` key, so `createBmadSetup`'s own default (`= SAMPLE_SKILLS`) is what a real install gets; a server-side *test* was still added (below) once the quick-lens review pointed out that claim had no end-to-end proof. `stubSetupCatalog` (`tests/support.ts`), used by every other server/e2e test that exercises Plan/Board, is a hand-rolled stub that never calls the real `setup()`, so this ticket's change stays invisible to all of those; only `bmad-catalog-setup.test.ts` and the one new `bmad-setup-routes.test.ts` case exercise the real file-writing `setup()`.

## Plan Change Log

## Review Triage Log

Pass 1 (lens quick, one context-free subagent reading this plan, the ticket, `AGENTS.md`, and the diff against `baseline_revision`): 0 high, 0 medium, 2 low, 0 false.

| Finding | Verdict | Route | Evidence / action |
|---|---|---|---|
| `bmad-catalog-sample-skills.test.ts`'s "says plainly it is a bundled sample" assertion checked the whole `SKILL.md` text, so it passed on the frontmatter's own `sample-`-prefixed `name` alone and would still pass if the body's disclosure sentence were deleted — it didn't guard the property it was named for. | low | patch | The test now strips the frontmatter block first (finds `\n---\n`, slices after it) and checks only the body for `'bundled sample'`. Re-run: still green, and now actually depends on the body prose. |
| AC2 ("runs the same way a user-authored skill would, through the existing skill-discovery and invocation path") and the "runnable" half of AC1 had no test that actually started a planning session on a bundled sample — only that `catalog.skills()` lists it. The design argument (discovery/invocation code is provably unchanged) is reasonable but isn't itself a test of AC2 as written. | low | patch | Added a real-uv end-to-end test in `packages/server/test/bmad-setup-routes.test.ts`: `POST .../bmad/setup` on an empty repo through the production wiring (no catalog override), then `POST .../planning-sessions` naming a real shipped sample, asserting the same 201/`planning`-kind/`/<skill>`-first-message shape `planning-routes.test.ts` already asserts for `bmad-spec`. Passes, not skipped (confirmed with `--reporter=verbose`). |

No issues found in the areas the review was asked to scrutinize most closely: `writeSampleSkillInto`'s stage-then-rename race-safety (mirrors `copySkillsInto` exactly, including the re-check immediately before `rename`); `writeSampleSkills`' `leaveElsewhere` rule applied identically to `copySkills`' on upgrade; every `SAMPLE_SKILLS` frontmatter `name` matching its skill/folder name with no apostrophe or unescaped quote that would break `parseSkillFrontmatter`; no change leaking into `skills.ts`, `catalog.ts`, `labels.ts`, `verified.ts`, `BMAD_SETUP_STEPS`, or `skill-labels.json`; and `bmad-catalog-setup.test.ts`'s ~24 pre-existing exact `readdirSync(...).toEqual([...])` assertions staying meaningful (unaffected, since `adapter()`'s `sampleSkills` default is explicitly `[]`, not `createBmadSetup`'s own default).

## Design Notes

The alternative considered and rejected: a catalog-level merge (read the project's real skills, then union in the bundled samples at `buildCatalog` time, deduping by name). Rejected because it would be exactly the "special case" AC2 forbids — a second, parallel source of truth the Plan UI and the planning-session start route would both need to know about, on top of `scanSkills`'s existing folder scan. Writing the samples to disk once, during `setup()`, keeps the discovery and invocation path (`scanSkills` → `buildCatalog` → `start-planning.ts`) exactly as CAP-18 already describes it for any installed skill: "appears in the UI and runs" with no further code to maintain.

```ts
// setup.ts, inside createBmadSetup(...), same shape as copySkills/copySkillsInto:
const writeSampleSkills = async (repoPath, targets, upgrade) => {
  for (const target of targets) {
    const folder = join(repoPath, ...target);
    const leaveElsewhere = upgrade && target === SKILLS_PATH;
    for (const skill of sampleSkills) {
      const result = join(folder, skill.name);
      if ((await entryAt(result)) !== undefined) continue; // the project's own, or already written
      if (leaveElsewhere && (await elsewhere(repoPath, skill.name))) continue;
      await writeSampleSkillInto(folder, skill);
    }
  }
};
```

## Verification

**Commands:**
- `pnpm typecheck` -- green across all six workspace packages.
- `pnpm test` -- green: 364 files, 4587 tests passed, 8 skipped (the pre-existing real-uv-dependent skips elsewhere in the suite; this ticket's own new real-uv test in `bmad-setup-routes.test.ts` ran, not skipped, confirmed with `--reporter=verbose`). Includes `tests/packaging.test.ts`'s guard that the packed tarball holds no file named `SKILL.md` anywhere.
- `pnpm e2e` -- green: 191 Playwright specs passed.
