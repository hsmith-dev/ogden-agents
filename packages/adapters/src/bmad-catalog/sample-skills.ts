/**
 * Ogden Agents' own bundled sample skills (story 18, CAP-18): two or more
 * tiny, real, runnable Claude Code skills a brand-new user can try from
 * Plan the moment Planning is set up in a project, so CAP-18 ("every
 * installed BMAD skill... is usable from the UI without an Ogden Agents
 * code change") has something real behind it on the very first run,
 * instead of only a placeholder.
 *
 * Their names and `SKILL.md` text are constants, inlined into the server
 * bundle exactly as `skill-labels.json` already is (`skill-labels.ts`):
 * never a loose file on disk beside this one. The packaged tarball ships no
 * file named `SKILL.md` anywhere (`tests/packaging.test.ts`, story 4.14),
 * the way the verified pinned copy's skills are only ever downloaded, not
 * bundled, so these can't be files copied from this adapter's own folder
 * either.
 *
 * `setup.ts`'s `setup()` writes each one, by name, into every skills folder
 * target it writes the verified pinned copy into, through the same
 * "never overwrite an existing name" rule `copySkillsInto` already applies
 * there (AC3: a project's own skill of the same name, or a sample a
 * previous setup already wrote, is left alone). Nothing here is written
 * except from inside `setup()`, which itself runs only when a BMad piece is
 * turned on and the project has no `_bmad` yet, or on an explicit upgrade
 * (AC4; E4-R2) — never for a project with every BMad piece off.
 *
 * Discovery is entirely `scanSkills`' (`skills.ts`, unchanged, AD-12): once
 * written, a sample is an ordinary `SKILL.md` under `.claude/skills/` (or
 * another agent's configured folder), read, catalogued, and invoked exactly
 * as a user-authored skill, with no special case anywhere in that path.
 * None is in Ogden Agents' label mapping (`skill-labels.json`): labelling
 * only ever applies to a skill verified against the pinned upstream copy
 * (`verified.ts`, entry 4.12), which a sample never is, so each shows on
 * Plan by its own `SKILL.md` name and description, as any other unmapped
 * skill does.
 */

/** One bundled sample skill: its folder name (also its `SKILL.md` `name`) and the file's full text. */
export interface BundledSampleSkill {
  /** The skill's name: its folder, and the `name` its own `SKILL.md` frontmatter must repeat (`SKILL_NAME_PATTERN`: lower case letters, digits and dashes). */
  readonly name: string;
  /** The whole `SKILL.md` file, frontmatter included. */
  readonly content: string;
}

const SAMPLE_BRAINSTORM_A_FEATURE = `---
name: sample-brainstorm-a-feature
description: 'A sample skill bundled with Ogden Agents: brainstorm a new feature idea in a short structured session, ending with two or three shaped options to develop further. Use when exploring or ideating on a feature idea.'
---

# Brainstorm a Feature (sample skill)

This is one of Ogden Agents' bundled sample skills: a small, real example to try from Plan before writing a skill of your own. Say so, briefly, at the start — then get to work. This is a genuine brainstorm, not a demo for its own sake.

## On Activation

1. If the user already named an idea or a problem, use it. Otherwise ask one short question: "What is the rough idea, or the problem you want a feature for?" Wait for an answer.
2. Ask at most two clarifying questions, and only if genuinely needed to proceed (who it is for, or what is out of scope) — skip them if the idea is already clear enough to work with.
3. Generate three to five distinct directions for the idea, each a short paragraph covering: the shape of the feature, who it is for, and the one thing that makes it worth building over the obvious alternative. Vary the directions genuinely — a minimal version, a more ambitious version, and at least one that approaches the problem from an unusual angle — rather than three small variations on the same idea.
4. Present them as a numbered list, each with a one-line name and its paragraph, then **HALT** and give the user a choice:
   - Pick one or more by number to develop further.
   - **More options** — generate a fresh set, not repeating what has already been shown.
   - **Combine** — name which numbers to merge into one direction.
   - **Done** — stop here with what has been generated.
5. For anything picked, develop it one level further: the rough shape of how it would work, what it deliberately leaves out for a first version, and the single open question that most affects whether it is worth building. Show this, then offer the same menu again (minus what is already settled).
6. When the user chooses **Done** (or the conversation naturally wraps up), close with a short numbered summary of the direction or directions settled on, each with its one-line name and open question, so it is easy to carry into a spec or a PRD next.

Stay concise throughout — this is a brainstorm, not an essay. Prefer a few sharp options over a long list of similar ones.
`;

const SAMPLE_EXPLAIN_THIS_CODE = `---
name: sample-explain-this-code
description: 'A sample skill bundled with Ogden Agents: read a file or function in this repo and explain it in plain language, what it does, how data flows through it, and what to watch for. Use when asking for code to be explained or reviewed in plain language.'
---

# Explain This Code (sample skill)

This is one of Ogden Agents' bundled sample skills: a small, real example to try from Plan before writing a skill of your own. Say so, briefly, then do the real thing: read the code and explain it well.

## On Activation

1. If the user already named a file, function, or area of the codebase, use it. Otherwise ask: "Which file or function would you like explained?" Wait for an answer; if they are not sure, offer to look at the most recently changed file in the repo's version control history as a reasonable default.
2. Read the named file (or enough of the surrounding module to make sense of it: its imports, the functions it calls, and its callers if that is quick to find). Read before writing anything — never explain code without having actually read it.
3. Explain it in plain language, structured as:
   - **What it is for** — one or two sentences, in terms of the product or user-facing behavior, not implementation detail.
   - **How it works** — a short walkthrough of the control flow: what comes in, what happens to it step by step, and what comes out. Name the key functions, classes or types involved, each with a one-line reason it exists. Use a short code excerpt only where pointing at exact lines is clearer than describing them.
   - **What to watch for** — real risks or sharp edges actually present in this code: things that look fragile, anything surprising for its stated purpose, or anywhere the behavior depends on an assumption that is not checked. If there is genuinely nothing notable, say so plainly rather than inventing a caveat.
4. Offer, but do not start unprompted: "Want me to go deeper on any part of this, look at a related file, or suggest an improvement?" Follow whatever the user picks.

Keep the explanation grounded in the actual code read, not in what similar code usually does elsewhere — if something is unclear from reading it, say that rather than guessing.
`;

const SAMPLE_DRAFT_A_MINI_SPEC = `---
name: sample-draft-a-mini-spec
description: 'A sample skill bundled with Ogden Agents: turn a short feature idea into a one-page mini spec, problem, goal, non-goals, approach and open questions. Use when asking for a quick spec or one-pager for something small.'
---

# Draft a Mini Spec (sample skill)

This is one of Ogden Agents' bundled sample skills: a small, real example to try from Plan before writing a skill of your own. Say so, briefly, then produce something genuinely usable: a short spec the user could paste straight into a ticket or a doc.

This is deliberately smaller than a full spec or PRD skill: one page, five short sections, for a feature small enough to describe in a paragraph. For anything bigger, point the user at a fuller planning skill instead, once that becomes clear.

## On Activation

1. If the user already described the feature, use that. Otherwise ask: "What is the feature, in a sentence or two?" Wait for an answer.
2. Ask at most two clarifying questions, and only if the answer leaves the problem or the audience genuinely unclear — skip them if there is enough to write from.
3. Write the mini spec as a markdown document with exactly these five sections, each kept short (a sentence or a few bullets, never padded to look thorough):
   - **Problem** — what is wrong or missing today, for whom.
   - **Goal** — the one outcome that, if achieved, means this succeeded. One sentence.
   - **Non-goals** — two or three things this deliberately does not cover, so scope stays small.
   - **Approach** — the shape of the solution in plain language: what changes, for the user or in the system, without prescribing implementation detail that belongs to a later design pass.
   - **Open questions** — anything genuinely unresolved that someone should answer before building this; if there truly are none, say so rather than inventing one.
4. Show the whole document in one markdown block, titled with the feature's name as a heading, ready to copy. Then ask: "Want any section expanded, or should this be tightened further?" and revise in place from there.

Keep it one page. If the conversation reveals this is bigger than a mini spec (multiple audiences, several phases, real architectural decisions), say so plainly and suggest a fuller spec or PRD skill instead of forcing it into this shape.
`;

/** The bundled sample skills shipped by default (story 18), in the order they are written. */
export const SAMPLE_SKILLS: readonly BundledSampleSkill[] = [
  { name: 'sample-brainstorm-a-feature', content: SAMPLE_BRAINSTORM_A_FEATURE },
  { name: 'sample-explain-this-code', content: SAMPLE_EXPLAIN_THIS_CODE },
  { name: 'sample-draft-a-mini-spec', content: SAMPLE_DRAFT_A_MINI_SPEC },
];
