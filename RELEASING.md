# Releasing

Ogden Agents ships as one npm package, `ogden-agents`. Releases are published only by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)) when a version tag is pushed. Nobody publishes from their own machine, and no npm token is stored anywhere: the workflow authenticates to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers) (GitHub OIDC).

## What the release workflow does

On a pushed tag `vX.Y.Z`:

1. **Guard.** Fails unless the tagged commit is on `main`'s own (first-parent) history, not a feature-branch commit merged into it, and the version in `package.json`, `packages/server/package.json` and `packages/web/package.json` equals `X.Y.Z`. `tests/packaging.test.ts` keeps those three equal.
2. **CI.** Reruns the full CI workflow (`ci.yml`) for the tagged commit: tests and a clean-install smoke test on macOS, Windows and Linux for Node 24 and 26, and the browser tests. If anything fails, nothing is published.
3. **Publish** (Linux, environment `npm-release`). Builds and packs the tarball (recording the commit as `gitHead`), smoke-tests that exact tarball, then runs `npm publish ogden-agents-X.Y.Z.tgz --access public --tag <dist-tag>` with npm 11.5.1 or later. A stable version goes to the `latest` dist-tag. A prerelease such as `v0.2.0-rc.1` goes to `next`, so `npx ogden-agents` keeps installing the last stable version and the prerelease is installed with `npx ogden-agents@next`. Publishing is idempotent: if `X.Y.Z` is already on npm from this same commit, the job skips publishing and succeeds, so a re-run carries on to verify; if it is on npm from a different commit, the job fails.
4. **Registry and provenance.** Waits for `X.Y.Z` to show on npm, then checks provenance. From a public repository npm adds a provenance attestation automatically; the job fails if a public-repository release has none, and only warns if the repository is private. Verify doesn't depend on this job.
5. **Verify.** On macOS, Windows and Linux, Node 24 and 26, runs `npx --yes ogden-agents@X.Y.Z` in an empty directory with an empty npm cache, reaches the page and `server.started`, then quits the server (`node scripts/smoke-installed.mjs --registry-spec ogden-agents@X.Y.Z`).

A failed publish publishes nothing, since `npm publish` is all or nothing. A failed verify means the release is already public: fix it forward (below).

## First release (0.2.0) checklist

`0.2.0` is the first real release on npm: `0.0.0` was a name reservation, and it holds the `latest` dist-tag until `0.2.0` ships. `0.2.0` is epic 2 (chat and workspaces) and epic 9 (first-run onboarding, stories 9.1 to 9.7). Epic 3 (the terminal) is not in it: the release is cut before any epic 3 story merges. `0.1.0` was never published (its CHANGELOG entry says so).

It goes out in two steps, both by tag: `0.2.0-rc.1` to the `next` dist-tag, checked live with a real Claude Code, then `0.2.0` to `latest`. Every step here is done by the repository owner, by hand; nothing in the repository merges, tags or publishes by itself. Steps 2 and 3 are one-time setup.

### 1. Merge the stack to `main`

Merge the story branches to `main` in this order: epic 2's stories, then 9.1 to 9.4, then 2.13 (which sets the version to `0.2.0-rc.1`), then 9.5, 9.6 and 9.7. No epic 3 branch is merged before the release. Wait for CI on `main` to pass, including the installed-package end-to-end suite (with the first-run onboarding journey) on macOS, Windows and Linux. `main` must then hold the version `0.2.0-rc.1` in the root, server and web `package.json`, a root `package.json` with `"private": false`, and the 0.2.0 entry in `CHANGELOG.md`.

### 2. Make the repository public

GitHub → `hsmith-dev/ogden-agents` → Settings → General → Danger Zone → Change repository visibility → Public.

npm only records provenance for packages published from a public repository. The workflow still publishes from a private one, without provenance.

### 3. Configure the npm trusted publisher

**First, create the GitHub environment** (required, before any tag is pushed): GitHub → `hsmith-dev/ogden-agents` → Settings → Environments → New environment → `npm-release`. In it:

- Deployment branches and tags → Selected branches and tags → add a **tag** rule `v*.*.*` (and no branch rule), so only a version tag can publish.
- Required reviewers → add yourself, so each publish waits for your approval.

Do this first: a workflow run that names an environment which doesn't exist creates it with no protection, and the first publish would then go out unreviewed.

Then on npmjs.com, signed in as an owner of `ogden-agents`: the package page → Settings → Trusted Publisher → GitHub Actions, with exactly:

| Field | Value |
| --- | --- |
| Organization or user | `hsmith-dev` |
| Repository | `ogden-agents` |
| Workflow filename | `release.yml` |
| Environment name | `npm-release` |

Save. The values are case-sensitive and must match the workflow: renaming `release.yml` or the `npm-release` environment breaks publishing until this setting is updated. If publish fails with `ENEEDAUTH`, `E401`, `E403` or `E404`, this setting is missing or doesn't match.

After the first successful release, you can also set Settings → Publishing access to "Require two-factor authentication and disallow tokens", so only trusted publishing can publish.

### 4. Tag the release candidate

On the `main` commit to release (its own first-parent history, as the guard requires):

```sh
git switch main && git pull
git tag -a v0.2.0-rc.1 -m "v0.2.0-rc.1"
git push origin v0.2.0-rc.1
```

GitHub → Actions → Release. The publish job waits for your approval (the `npm-release` reviewer, step 3): approve it once guard and CI are green. All jobs should then go green: guard, CI, publish (to the `next` dist-tag), then the registry and provenance check and the six verify jobs. Then check:

```sh
npm view ogden-agents dist-tags
# latest: 0.0.0
# next: 0.2.0-rc.1
npx ogden-agents@next             # starts and opens the page
```

`latest` stays on `0.0.0` (the name reservation): a prerelease is published with `--tag next` and never moves `latest`. Until step 6, `npx ogden-agents` without `@next` still installs `0.0.0`, so use `npx ogden-agents@next` for the checks below.

### 5. Live checks with Claude Code

On a fresh computer (or a fresh user account) with Node 24 or later, run `npx ogden-agents@next` with a real Claude account. These are the checks CI can't make, since CI runs only the fake agent, fake login and an in-memory keychain:

1. Epic 9, Done when 1 (Welcome): the first launch opens **Welcome**. On the Claude Code card, **Install** installs it and shows the installed version.
2. Sign in with your Claude subscription from the card: the sign-in page opens, and Welcome moves on by itself. Add a project, answer the shortcut offer, and land in that project's empty Chats.
3. Epic 2, Done when 1 (chat): start a chat and see the reply stream in live.
4. Epic 9, Done when 2 (API key): as a second user (or after signing out of the subscription), with only an Anthropic API key: **Use an API key instead**, save it (it goes to the real OS keychain), and a chat works. The key is shown only as its last four characters.
5. Epic 9, Done when 3 (sign in again): when the subscription sign-in expires (or after signing out, for example `claude auth logout` where the Claude CLI is installed), the next message's error offers **Sign in**; after signing in, the chat resends and keeps its context.
6. Epic 2, Done when 3 (permission cards and caution levels): under the default caution level (**Ask every time**), ask Claude Code to run a shell command (say `npm test`). Nothing runs until **Allow once** on the card. Change the project's caution level and check that its cards follow it.
7. Epic 2, Done when 2 (restart and resume): Quit, start the app again, reopen that chat, and ask about the earlier conversation: it keeps its context.
8. Epic 2, Done when 4: agents working in two projects at once; close every browser window, then open a fresh launch link (run `npx ogden-agents@next` again, which prints one and opens it; it stands in for the app shortcut here), and the sidebar shows both live states.

If a check fails, fix it on `main` and release `0.2.0-rc.2` the same way (version bump PR, then the tag).

### 6. Release 0.2.0

On a branch, set the version `0.2.0` in `package.json`, `packages/server/package.json` and `packages/web/package.json` (the CHANGELOG's 0.2.0 entry already covers it). Merge that PR to `main`, wait for CI, then:

```sh
git switch main && git pull
git tag -a v0.2.0 -m "v0.2.0"
git push origin v0.2.0
```

Watch Release as in step 4 (approve the publish), then move `next` to the stable version too, so `@next` never installs an older release candidate than `latest` (signed in to npm as an owner):

```sh
npm dist-tag add ogden-agents@0.2.0 next
npm view ogden-agents dist-tags
# latest: 0.2.0
# next: 0.2.0
npx ogden-agents                  # installs 0.2.0, starts and opens the page
```

The package page on npmjs.com shows a provenance badge linking back to the workflow run.

## Epic 3 release (0.3.0) checklist

`0.3.0` is epic 3: switching a chat to the agent's own terminal and back (CAP-5). It goes out after `0.2.0`, in the same two steps, by tag: `0.3.0-rc.1` to `next`, checked live, then `0.3.0` to `latest`. As before, the repository owner does every step by hand.

### 1. Merge the stack to `main`

After `0.2.0` is released, merge epic 3's story branches to `main` in stack order: 3.1, 3.2, 3.11, 3.6, 3.3, 3.7, 3.4, 3.5, 3.9, 3.8, then 3.10. 3.10 sets the version to `0.3.0-rc.1` and adds the 0.3.0 entry to `CHANGELOG.md`. Wait for CI on `main` to pass. That includes the installed-package end-to-end suite on macOS, Windows and Linux, with epic 3's terminal journey and its check without `node-pty`.

### 2. Tag the release candidate

As in the 0.2.0 checklist, step 4, with the tag `v0.3.0-rc.1`. Then `npm view ogden-agents dist-tags` shows `next: 0.3.0-rc.1`.

### 3. Live checks with Claude Code

CI runs only a fake agent and a fake `claude` CLI, so these checks need the real one. Run them with `npx ogden-agents@next` and a signed-in Claude Code, once on macOS (or Linux) and once on Windows (PowerShell or Windows Terminal, Node 24 or later). On each:

1. Settings > Appearance: turn on **Developer mode**. A Claude Code chat's header now shows **Chat | Terminal**. With Developer mode off, no toggle is shown.
2. Epic 3, Done when 1: in a project, send the chat a message and wait for the reply. Switch to **Terminal**: Claude Code's own terminal opens on the same conversation, with focus inside it. Send it a message there and wait for the reply.
3. Epic 3, Done when 2: while the terminal drives, the composer is disabled and says why, and the read-only conversation opens beside the terminal (or as a sheet in a narrow window).
4. Reload the tab: it reattaches to the same terminal, with its recent output.
5. Switch back with `⌘.` / `Ctrl+.` (or **Switch to Chat**). The terminal's message is in the chat marked "from terminal", with Claude Code's reply. Send another chat message: the reply carries on the same conversation (ask about what you said in the terminal).
6. While the chat is working on a reply, the toggle is disabled with a short reason, and nothing is interrupted.
7. In the terminal, type `/exit`: the chat drives again by itself.
8. Windows only, Done when 5: in the terminal, paste a multi-line text (it arrives as one paste), resize the window (Claude Code redraws at the new size), check colours, and check that `Ctrl+.` switches back without reaching Claude Code.

Epic 3, Done when 4: its `node-pty` half (the app runs, and the toggle says why it is off) is covered in CI by the installed suite, so it needs no live check; its Developer mode half is check 1.

If a check fails, fix it on `main` and release `0.3.0-rc.2` the same way.

### 4. Release 0.3.0

As in the 0.2.0 checklist, step 6, with the version `0.3.0` and the tag `v0.3.0`. Then move `next` to it too: `npm dist-tag add ogden-agents@0.3.0 next`. Epic 3, Done when 6, is met once `npx ogden-agents` installs `0.3.0`.

## 0.4.0 release checklist (epic 10, epic 4 and permission modes)

`0.4.0` is one release of epic 10 (BMad Method optional per project, CAP-19), epic 4 (planning and the board, CAP-2, CAP-6, CAP-7, CAP-18) and the per-chat permission modes story (user decision 2026-10-02: epic 10 does not release on its own). It goes out after `0.3.0`, in the same two steps, by tag: `0.4.0-rc.1` to `next`, checked live, then `0.4.0` to `latest`. `0.2.0` and `0.3.0` are unchanged. As before, the repository owner does every step by hand.

### 1. Merge the stack to `main`

After `0.3.0` is released, merge to `main` in stack order: epic 10's 10.1, 10.2, 10.5, 10.3, 10.4, 10.6, 10.7 and 10.8; then epic 4's 4.1, 4.2, 4.14, 4.3, 4.5, 4.8, 4.4, 4.6, 4.9, 4.7, 4.10, 4.11, 4.12 and 4.13. 4.13 merges 10.9 (#59, `0.4.0-rc.1` and its installed BMad journey) and the permission modes story (#63) into the stack, so merging 4.13 brings both in: merge #59 and #63 first (4.13 then merges cleanly) or close them as merged through 4.13. 4.13 has the 0.4.0 entry in `CHANGELOG.md`. Wait for CI on `main` to pass. That includes the installed-package end-to-end suite on macOS, Windows and Linux with epic 10's BMad journey, epic 4's planning journey (BMad Method set up from a local fixture, never the network), the permission modes journey and the 0.2.0 upgrade, and the Provenance job.

### 2. Tag the release candidate

As in the 0.2.0 checklist, step 4, with the tag `v0.4.0-rc.1`. Then `npm view ogden-agents dist-tags` shows `next: 0.4.0-rc.1`.

### 3. Live checks with Claude Code

CI runs only a fake agent and a local BMad Method fixture, so these checks need the real ones. Run them with `npx ogden-agents@next` and a signed-in Claude Code, in scratch repos made for it (never one you care about), once on macOS (or Linux) and once on Windows. Write each result under "Live check result" in the plan named with each group before its story moves to done: story 4.13's (`_bmad-output/initiative-ogden-agents/epic-planning-and-board/story-end-to-end-suite-and-release-plan.md`) for epic 4 and the permission modes, story 10.9's (`_bmad-output/initiative-ogden-agents/epic-bmad-optional-per-project/story-end-to-end-suite-and-release-plan.md`) for epic 10, and story 10.1's for its check.

**Epic 4 (story 4.13's plan):**

1. BMad Method setup download on a real network, epic 4 Done when 1: in an empty scratch repo added as a project, turn on Planning. Setup downloads the pinned BMad Method from GitHub (the first time on this computer), shows its steps and ends with "Ready to plan."; `_bmad/` and `.claude/skills/` are in the repo. Settings > the project shows BMad Method as current. Then turn Planning off in another project and check that it shows no Plan or Board and has no `_bmad/`.
2. The tracer, epic 4 Done when 2: on the Plan tab, **Start from an idea** with a one-line idea. Answer Claude Code in the planning session until it writes a brief; the document card's **Open** shows it, and its next step starts the spec session; go on until a spec, then **Turn this spec into tickets**, until Claude Code has written an epic with tickets. Use only the chat and the buttons.
3. Epic 4 Done when 3: turn Board on (it asks to trust the project's scripts first). The board shows the new tickets. Ask Claude Code in a chat to set one ticket's status in its plan file (for example to in-progress): the card moves within seconds, highlighted. Move another ticket to Ready from its card's menu: its plan file now says `ready-for-dev`.
4. Epic 4 Done when 4: with the server running, install another BMad Method module into the repo (for example with `npx bmad-method install`): it appears on the Plan tab, marked New, and one of its actions starts.
5. Epic 4 Done when 5: a copy of a repo with an older or plain upstream BMad Method install opens with the reduced-mode notice on Plan (and on Board if its tickets can't be read); **Upgrade this project** ends with the notices gone.

**Permission modes (story 4.13's plan), with real Claude Code:**

6. A chat starts in **Ask**. Switch it to **Auto**: Claude Code edits an ordinary file without a card, and asking it to edit a protected path (for example `.git/config`, a file under `.claude/`, or `_bmad/scripts/config_utils.py`) still shows a card. Then, in a project with Board on and trusted, change `_bmad/scripts/config_utils.py` yourself (add a comment): the Board shows "This project's BMad Method scripts changed. Run them?" and no tickets until you allow it.
7. With Developer mode off, **Skip all** is not offered. Turn Developer mode on (Settings > Appearance): Skip all is offered behind a red warning; once on, the red banner stays in view while the conversation scrolls and at phone width, and Claude Code runs a command without a card. **Back to Ask** in the banner works. Turn Developer mode off: the chat is back in Ask.

**Epic 10 (story 10.9's plan; story 10.1's for check 9):**

8. Epic 10, Done when 1: add a scratch repo (with a `.claude/skills` of its own) as a new project, with Settings > New projects left at Simple chats. Its header shows only Chats, and no BMad Method notice. Start two chats and talk to Claude Code in both at once. Nothing is written into the repo (`git status` is clean), and no `_bmad/` appears. Ask Claude Code what skills it has: only the repo's own and your own, nothing from Ogden Agents.
9. Story 10.1: in a project's settings, turn a BMad Method feature on and off with a second tab open on the same page: the second tab follows at once. Restart the server: the choice is kept.
10. Welcome's question: in a fresh data folder (set `OGDEN_AGENTS_DATA_DIR` to an empty folder for one run), Welcome asks "Simple chats or BMad Method?" once for the first project, with BMad Method available; Settings > Welcome never asks it again.
11. Epic 10, Done when 3: a repo that already has `_bmad/` shows the offer on its chats page; **Not now** hides it for good, across a reload and a restart. `git status` in that repo is clean.
12. Epic 10, Done when 4: start `0.4.0-rc.1` on a copy of a data folder `0.3.0` used (with projects, chats, a caution level and an Always allow rule). It opens on Projects, not Welcome; every project, chat, caution level and rule is there; every project is Simple chats and every chat is in Ask; a project with `_bmad/` offers its features once.
13. Epic 10, Done when 5: in a simple project, with Developer mode on, **Chat | Terminal** switches to Claude Code's own terminal and back as in epic 3.

Epic 10, Done when 2 and 6 and epic 4, Done when 6 are CI (the installed suite on three OSes) plus these checks.

If a check fails, fix it on `main` and release `0.4.0-rc.2` the same way.

### 4. Release 0.4.0

As in the 0.2.0 checklist, step 6, with the version `0.4.0` and the tag `v0.4.0`. Then move `next` to it too: `npm dist-tag add ogden-agents@0.4.0 next`. Epic 4, Done when 6, is met once `npx ogden-agents` installs `0.4.0`.

## 0.5.0 release checklist (epic 6: Antigravity beside Claude Code)

`0.5.0` is epic 6's release (CAP-15, CAP-3, CAP-5, CAP-16): the agent picker, a default agent per project, and Antigravity as a second chat agent. It goes out after `0.4.0`, in the same two steps, by tag: `0.5.0-rc.1` to `next`, checked live, then `0.5.0` to `latest`. Antigravity ships only if it passes on all three OSes (user, 2026-10-02): any check below failing on any OS is a no-go for Antigravity, and the release then waits for the user's decision (drop entries 5, 7 and 8, as the epic says). As before, the repository owner does every step by hand.

### 1. Merge the stack to `main`

After `0.4.0` is released, merge epic 6 to `main` in stack order: 6.2, 6.3, 6.4, 6.6, 6.5, 6.7, 6.8, 6.9 and 6.10 (spike 6.1, #73, is a findings branch: merge or close it on its own). 6.10 has the `0.5.0-rc.1` version and the 0.5.0 entry in `CHANGELOG.md`. Wait for CI on `main` to pass: that includes the installed-package end-to-end suite on macOS, Windows and Linux with epic 6's agents journey (`tests/e2e-installed/agents-journey.spec.ts`: Claude Code and Antigravity side by side, the picker and default, Antigravity's modes and protected paths, the agent trust gate, Antigravity's install from a local fixture archive, the unsupported message, and `.agents/skills`), and the Provenance job.

### 2. Tag the release candidate

As in the 0.2.0 checklist, step 4, with the tag `v0.5.0-rc.1`. Then `npm view ogden-agents dist-tags` shows `next: 0.5.0-rc.1`.

### 3. Live checks with Antigravity and Claude Code

CI runs only fakes (the fake agent as both agents, a fixture archive on 127.0.0.1), so these need the real ones. Run them with `npx ogden-agents@next`, in scratch repos made for it, **on macOS (Apple silicon), Windows (x64) and Linux (x64)**, each OS on its own. Use a Google account you accept the terms risk for (Google's terms say third-party use of Antigravity sign-in may suspend the account; user decision 2026-10-02) and a Gemini API key from Google AI Studio. Write each result, per OS, under "Live check result" in story 6.10's plan (`_bmad-output/initiative-ogden-agents/epic-every-agent/story-end-to-end-suite-and-release-plan.md`) before the story moves to done.

1. Install, epic 6 Done when 4: Settings > Agents > Antigravity > **Install**. It downloads from Google into the data folder (about 110 to 340 MB) and ends "Installed, needs sign-in" with Version 1.3.0. Nothing appears outside Ogden Agents' data folder except `~/.gemini/antigravity/bin/webm_encoder` (the card says so). On Windows, note how long its first start takes.
2. Google sign-in: **Sign in with your account** opens Google in a browser on that computer (on Linux, check it opens at all: the known Zed issue). The card ends "Installed, signed in". Start an Antigravity chat and get a reply.
3. API key: **Sign out**, then save a Gemini API key on the card. A new Antigravity chat replies. Then check that the key appears nowhere: `grep -r "AIza" <data folder>` finds nothing in `ogden-agents.db`, the event log or `logs/`.
4. Two agents at once, Done when 2: in one Simple project, start a Claude Code chat and an Antigravity chat from the picker, and ask each to run a shell command (for example `ls`). Each shows a permission card that holds the command until you click **Allow once**; both work at the same time. The sidebar names each chat's agent.
5. Default agent: in the project's settings, set **Default agent** to Antigravity; the Chats page preselects it in another open tab without a reload, and **New chat** starts an Antigravity chat.
6. Modes, Done when 3: in the Antigravity chat, the mode picker shows **Auto** unavailable with a reason; with Developer mode on, **Skip all** runs a command without a card, behind the red banner.
7. Protected paths: at "Ask only for risky actions", ask Antigravity to edit an ordinary file (no card), then a file under `.gemini/`, `.agents/` and `_bmad/` (a card each). Also check whether Antigravity reads a `GEMINI.md` in the project root as its instructions (write one with an odd instruction and ask); if it does, say so in the plan (a deferred item).
8. Restart: Quit Ogden Agents from the app, run `npx ogden-agents@next` again, and continue both chats: each remembers what was said before.
9. Terminal toggle, Done when 5: with Developer mode on, the Claude Code chat's **Chat | Terminal** works as in 0.3.0; the Antigravity chat's toggle is disabled and says why.
10. BMad with Antigravity, Done when 6: in a scratch repo whose default agent is Antigravity, turn Planning on. Setup ends "Ready to plan." and the repo has `.agents/skills/` as well as `.claude/skills/`. On Plan, **Start from an idea** in an Antigravity planning session: Antigravity runs the BMad skill (it asks about the idea, as Claude Code would). A Simple project that uses Antigravity gets no `.agents/skills` and no `_bmad/`.
11. Welcome: with `OGDEN_AGENTS_DATA_DIR` set to an empty folder for one run, Welcome asks which agent; choose Antigravity, and the first project's chats start with it.
12. Uninstall: Settings > Agents > Antigravity > **Uninstall**; the picker then shows Antigravity unavailable with a link to Settings > Agents.

When every check has passed on all three OSes, write the final Antigravity row of `agent-matrix.md` from the spike and these results (through `bmad-spec`, leaving no "verify" cell), as epic 6's entry 10 says. If a check fails, fix it on `main` and release `0.5.0-rc.2` the same way.

### 4. Release 0.5.0

As in the 0.2.0 checklist, step 6, with the version `0.5.0` and the tag `v0.5.0`. Then move `next` to it too: `npm dist-tag add ogden-agents@0.5.0 next`. Epic 6, Done when 7, is met once `npx ogden-agents` installs `0.5.0`.

## Later releases

1. On a branch, set the same new version in `package.json`, `packages/server/package.json` and `packages/web/package.json`, and add its entry to `CHANGELOG.md`. Merge to `main`.
2. Tag that `main` commit `v<version>` and push the tag, as in step 4.

For a prerelease, use a version such as `0.2.0-rc.1` and the tag `v0.2.0-rc.1`. It is published to the `next` dist-tag, not `latest`.

## When something goes wrong

| Symptom | Cause and fix |
| --- | --- |
| Guard: "Not on main" | The tag points at a commit that isn't on `main`'s own history (for example a feature-branch commit that was merged into `main`). Delete the tag (`git push origin :refs/tags/vX.Y.Z` and `git tag -d vX.Y.Z`) and tag a `main` commit. |
| Guard: "Version mismatch" | The package versions don't equal the tag. Delete the tag, fix the versions on `main`, and tag again. |
| CI fails | Nothing was published. Fix on `main`, delete the tag, and tag again. |
| Publish: "Already published" (error) | That version is on npm from a different commit. npm never lets a version be reused: release the next patch version. (From the same commit, the job skips publishing and succeeds.) |
| Publish: `ENEEDAUTH`, `E401`, `E403` or `E404` | The trusted publisher is missing or doesn't match (step 3). Fix it on npmjs.com and re-run the failed jobs. Nothing was published. |
| Publish: `E422` | npm's provenance check rejected the package, usually because `repository.url` in the root `package.json` isn't exactly `git+https://github.com/hsmith-dev/ogden-agents.git` (`tests/packaging.test.ts` checks it). Nothing was published. Fix it on `main`, delete the tag, and tag the fixed commit. |
| Registry and provenance fails | The release is published. If the version never showed up, re-run the job. If provenance is missing from a public repository, check the repository was public when the release ran; the next release will carry it. |
| Verify fails on one OS | The release is public but broken there. Never unpublish: fix on `main` and release the next patch version. |
