---
title: 'Always allow scoped to a command prefix (AD-40), with a security review'
type: 'feature'
ticket: '8'
created: '2026-10-31'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
baseline_revision: '147801c01aefefe089eee8e28dcc699229a9dc09'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-everyday-polish/epic-everyday-polish.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Today a command card's one Always allow scope already saves a `command_prefix` rule (first one or two words), so the default choice is the wide one, and the card offers it even for chained, redirected or protected-path commands (a rule `cp` saved from `cp x .git/hooks/y`). A rule also matches commands naming paths outside the project, `$VAR` expansion, globs and zsh glob qualifiers (E26-R8, AD-40).

**Approach:** The first scope becomes the exact command (new kind `command_exact`, selected by default); the second is "Commands starting with `<prefix>`", Ogden's prefix. The client sends only a choice (`current` or `prefix`); the server picks from the scopes it computed. One server check decides whether a command can be ruled at all, and both offering and matching use it.

## Boundaries & Constraints

**Always:** prefix is `commandPrefix` of the parsed command, never client text; the decision body carries only `scope: 'current' | 'prefix'`, valid only with `allow_always`; a command rule (exact or prefix) matches only token-equal words (`npm test` never `npm testx`, `npm-test`) and only when the command is "rulable": printable ASCII plus tab, none of `; & | \` < > $ ( ) { } [ ] * ? % \` or a newline, no masked secret, not led by a wrapper, interpreter or assignment (incl. two-word wrappers `npm exec`, `pnpm dlx`, `uv run`, ...), names no protected path, and every word (quotes removed, plus each part after `=`, `:`, `,`, `@`, and in a flag word each part from a `/`, `.` or `~`) resolves inside the project with symlinks followed and touches no protected segment; an unrulable command offers no Always allow and gets a server-sent reason; attended builds, custom agents (`alwaysAsks`) and Skip all offer and match nothing, and Skip all writes no rule; existing rows keep their kind and value and only lose matches; no em or en dashes in UI strings; errors `{error:{code,message}}` under `/api/v1`.

**Never:** a free-typed pattern; trusting any scope text from the client; a new DB migration (kind is a text column); device routes (none exist yet; AD-34's body rule is the device epic's); widening any existing rule.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two scopes | card for `npm test -- cart` | first `Exactly npm test -- cart`, second `Commands starting with npm test` | No error expected |
| Prefix allows args | rule prefix `npm test`; `npm test -- --watch` | allowed by rule | No error expected |
| Word boundary | rule `npm test`; `npm testx`, `npm-test`, `npm "test"` | card | No error expected |
| Chain / pipe / redirect / subst | `npm test && x`, `npm test | x`, `npm test > o`, `npm test 2> o`, `npm test $(x)`, backtick, `${X}`, newline | card, no Always allow, reason | No error expected |
| Outside path | `cat ../x`, `cat /etc/passwd`, `cat --f=/etc/x`, `cat -I../x`, symlink out, `~/x` | card, no Always allow | No error expected |
| Protected | `cp x .git/hooks/y`, symlink to `.git` | card, protected caption, no Always allow | No error expected |
| Wrappers | `env X=1 npm test`, `X=1 npm test`, `sudo`, `bash -c`, `sh -c`, `xargs`, `eval`, `timeout`, `npm exec` | no Always allow; never matched | No error expected |
| Client sends prefix | body `{decision:'allow_always', scope:{kind:'command_prefix',value:'rm'}}` | 400 `invalid_request`, nothing written | 400 |
| Prefix not offered | `scope:'prefix'` on a tool card | 400, nothing written | 400 |
| Skip all | `allow_always` while in Skip all | 400, no rule | 400 |
| Exact rule | rule exact `npm test`; `npm test --watch` | card | No error expected |

</frozen-after-approval>

## Code Map

- `packages/core/src/permission-matching.ts` -- `SHELL_SYNTAX`, `words`, `commandPrefix`, `alwaysAllowScope`, `ruleMatches(rule, kind, command, pathsInside)`, `reachedPath`, `isProtectedSegment`, `commandNamesProtectedPath`. Add `commandRuleRefusal(command)` (text), `commandPathsRulable(workspace, command, extraFolders)` (fs), `alwaysAllowPrefixScope(command)`; `alwaysAllowScope` for execute returns `command_exact`; `ruleMatches` for command kinds requires `pathsInside` (now "command rulable") so a missing argument fails closed.
- `packages/core/src/command-prefix-allowlists.ts` (added by the independent review, 2026-10-31) -- `PREFIX_NEVER_PROGRAMS`, the git, tar, npm/pnpm/yarn and go allowlists, `prefixRefusedFor`, `scriptNameIndex`; `prefixRuleRefusal` in `permission-matching.ts` calls it.
- `packages/core/src/permissions.ts` -- `request()` (lines ~247-335): compute rulable before the transaction, pass to `findRule`, set `offered`/`prefix`/refusal; `Pending` gains `prefixScope`; `decide()` takes `scope` choice.
- `packages/shared/src/events-common.ts:118` `AlwaysAllowScope` kind enum; `events-session.ts:385` `permission.requested` payload (add optional `alwaysAllowPrefix`, `alwaysAllowRefusal`); `chat.ts:437` `PermissionDecisionRequest`; `permissions.ts` `WRAPPER_COMMANDS`, `alwaysAllowRefusal`.
- `packages/server/src/permission-routes.ts` -- passes body to `decide`; unchanged except the body schema.
- `packages/web/src/permissions/permission-card.tsx` -- two-scope radio group under Always allow, record line words; `packages/web/src/chat/transcript.ts:334` maps payload; `packages/web/src/routes/workspace-settings-page.tsx:323` `AlwaysAllowRulesView` (export the section).
- `packages/web/src/settings/settings-groups.ts` -- Projects group; `packages/web/src/router.tsx` settings children.
- Already right, keep: `chat/agents.ts:86` (alwaysAsks and builds pass `attended`), `build-permission-policy.ts` (no rules).
- Tests: `packages/core/test/permissions.test.ts` (~386-590 matcher tests), `packages/server/test/permissions.test.ts`, `packages/web/test/permission-card.test.tsx`, `tests/e2e/permissions.spec.ts` (fake agent `permission <cmd>`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/*` -- `command_exact` kind; payload fields; decision `scope` enum with refine (only with `allow_always`); add wrappers (`timeout`, `stdbuf`, `ionice`, `chroot`, `su`, `runuser`, `setsid`, `caffeinate`, `flock`, `taskset`, `watch`, `strace`, `script`, `unbuffer`, `parallel`, `awk`-family, `uvx`, `pipx`, `source`, `.`) and two-word wrappers.
- [x] `packages/core/src/permission-matching.ts` -- the functions above.
- [x] `packages/core/src/permissions.ts` -- request and decide as above.
- [x] `packages/web/src/permissions/permission-card.tsx`, `chat/transcript.ts` -- scope choice (current selected; arrow keys within; `2` saves selected), refusal from payload first, record "Always allowed: commands starting with npm test".
- [x] `packages/web/src/routes/always-allow-settings-page.tsx` (new), `router.tsx`, `settings-groups.ts` -- `/settings/always-allow` in Projects: each project's rules with Remove; empty text per EXPERIENCE.
- [x] Tests: core matcher table (every matrix row and every bypass the security review tries), Skip all, attended, alwaysAsks; server body tests; card DOM test; `tests/e2e/always-allow-prefix.spec.ts` saves a prefix rule, sees `npm test -- --watch` run, removes it in Settings, sees a card again.

**Acceptance Criteria:**
- Given a card for `npm test -- cart`, when the user presses `2` without changing the choice, then an exact rule is saved and `npm test -- other` still asks.
- Given a pre-existing `command_prefix` row, when a command it matched before and that is rulable arrives, then it still runs without a card; when it is not rulable, it asks.

## Implementation Notes

- One check, two callers: `request()` computes `commandRuleRefusal` (text) and `commandPathsReach` (fs) once, before the transaction; the result sets `alwaysAllowScope` (`command_exact`), `alwaysAllowPrefix`, `alwaysAllowRefusal`, `protectedPath` (a link to `.git` now counts) and the `pathsInside` argument `findRule` passes to `ruleMatches`. `ruleMatches` re-runs the text check itself and defaults `pathsInside` to `false`, so a command rule without the fs check never matches.
- An exact rule's value is the command trimmed at the ends, compared as a whole string (not word-normalised: `"a  b"` inside quotes is a different command).
- `permission.resolved` gains an optional `scope` (the scope an `allow_always` saved) so the record line can say "Always allowed: commands starting with npm test" after a reload; older events fall back to the command. Not in the Code Map; additive and optional, no migration.
- The decision body `scope` is `z.enum(['current','prefix'])` with a refine (only with `allow_always`); core checks the same again and picks `entry.scope` or `entry.prefixScope`, the scopes it computed. A `scope` object, any other string, a prefix on a tool card or on a card with no prefix (Skip all, attended, custom agent, `sed`) is 400 and writes nothing.
- Settings: `/settings/always-allow` (Projects group, "Always allow rules") lists every project's rules through the exported `AlwaysAllowRulesSection`; the project page's own list keeps working. Empty text and the polite "Removed. Ogden will ask next time." follow EXPERIENCE.md; rule rows say "Exactly `x`" or "Commands starting with `x`".

- Verification after review patches (2026-10-31): `pnpm typecheck` clean; `pnpm test` 5134 passed, 30 failed, 10 skipped with the machine at load average 213 to 252 (other sessions); the 18 failing files re-run alone gave 15 failures, all timing (11 timeouts, three `chat-markdown` render budgets, one `cancel` check-in timing), none in permission code or in a test this story touched; a clean full run waits for a quieter machine. Playwright `always-allow-prefix`, `permissions`, `settings-nav`, `caution`, `permission-modes`: 30 passed. Provenance passes.

### Security review (AD-40, 2026-10-31): implementer's self-review

Written by the implementing agent while building, not by a fresh reviewer. Attempts, each now a row in `packages/core/test/permissions.test.ts` "Always allow by how a command starts":

| # | Bypass tried | Result |
|---|---|---|
| S1 | Chains, pipes, background, newline, CR (`&&`, `||`, `;`, `&`, `|`) | Refused (text), reason "runs more than one thing" |
| S2 | Redirection (`>`, `2>`, `<`) | Refused, "redirects input or output" |
| S3 | Substitution and expansion (`$(x)`, backtick, `${X}`, bare `$X`, `*`, `?`, `[ab]`, `{a,b}`, zsh qualifier `src(e:x:)`, `%1`) | Refused, "the shell would expand part of it first" |
| S4 | zsh `=cmd` expansion (`cp x =node` overwrites the program on PATH) | Fixed beyond the plan's list: a word starting with `=` (quotes removed) is refused |
| S5 | Backslash escapes, NBSP, bidi isolates U+2066-2069, any non-ASCII | Refused, "characters Ogden Agents can't check" |
| S6 | Masked secret `[redacted]` | Refused, "holds a hidden secret" |
| S7 | Paths out: `../x`, `src/../../x`, `/etc/passwd`, `--f=/etc/x`, `-I../x`, `-I/etc`, `-I~/x`, `x:../y`, `-d@../x`, `-Wl,-rpath,/x`, `"../x"`, `a"/../../"x`, `~`, a symlink out | Refused, "names a path outside this project" |
| S8 | Protected paths: `.git/hooks/y`, a link to `.git`, `--target-directory=.git/hooks` (missed by the old word split), `src/../.claude/...`, `CLAUDE.md` | Refused with the protected caption |
| S9 | Wrappers: `env`, assignments, `sudo`, `bash -c`, `sh -c`, `xargs`, `eval`, `timeout`, `stdbuf`, `nice`, awk family, `source`, `.`, `uvx`, `pipx`, versioned interpreters (`node18`) | Refused (wrapper list widened) |
| S10 | Two-word wrappers, incl. a flag or quotes hiding the subcommand: `npm exec`, `npm x`, `npm -y exec`, `npm "exec"`, `npm init x`, `pnpm dlx`, `yarn dlx`, `uv run`, `uv tool run`, `poetry run`, `bundle exec`, `docker run`, `docker compose exec` | Refused: the subcommand is looked for in every later word |
| S11 | Word-boundary tricks against a prefix rule: `npm testx`, `npm-test`, `npm "test"`, `NPM test` | No match (token-equal) |
| S12 | A prefix turning a harmless program into a command runner: `find -exec`/`-execdir`, `sed .../e`, `git -c core.pager=...`, `git --config-env`, `git --exec-path`, `git config`, `git rebase --exec`/`-x`, `git fetch --upload-pack`, `git bisect run`, `git submodule foreach`, `tar --to-command`/`--checkpoint-action`/`-I`, `rsync -e`/`--rsync-path`, `zip --unzip-command`, `npm --script-shell`/`--node-options`, `make --eval`, `ssh host cmd`, `vim -c` | Fixed beyond the plan: `prefixRuleRefusal` means no prefix is offered for such a command and no prefix rule matches it; the exact command is still offered (the user approves that literal text) |
| S13 | A caller forgetting the fs check | `ruleMatches` defaults `pathsInside` to `false`: fails closed |
| S14 | Client-sent scope text | 400; the server only reads a `current`/`prefix` choice |

Recorded, not fixed (for the user to read before this is called done):
- R1 A rule for a program that runs project code (`npm test`, `make`, `pytest`, `cargo test`, `./build.sh`) runs whatever the agent has written into the project since. That is the trust "Always allow npm test" grants; it was true of the old prefix rule too. A prefix only widens which arguments; the program's own config files in the project (`.npmrc`, `Makefile`, `curl -K`) are likewise trusted.
- R2 The exec-option tables in S12 are a known-programs list, not a proof: an unknown program whose option runs a command (`some-tool --hook=x`) is still covered by a one-word prefix rule for it. The narrower exact rule is the default for this reason.
- R3 Usability cost of following the plan's flag-word rule literally: in a flag word each part from a `/` counts, so `--out=dist/x` or `-Isrc/include` yields `/x`, an absolute path outside, and the command is unrulable. Fails closed; a smarter split (value only after `=` for `--long` words) would loosen a security check, so it waits for the user.
- R4 `!` (history expansion, interactive shells only), `^` (zsh `extended_glob`, off by default) and `#` are not refused.
- R5 Commands with Windows paths (`C:\x`) are never rulable (backslash refused).
- R6 (review round 2) `npm test #x` and `npm test !x` stay rulable and are matched by an `npm test` rule: `#` starts a comment, and `!` history expansion happens only in interactive shells.
- R7 (review round 2) Two-word wrappers look only at the subcommand position (the first non-flag word; every later word only when a flag comes first), so `npm test init` is `npm test`. `docker compose` (and `podman compose`) is then refused as a two-word wrapper, and `docker-compose`/`podman-compose` `run`/`exec` are refused, so `docker compose exec x` stays refused (review round 2, orchestrator).

Review round 2 fixes (2026-10-31): a quoted first word is unrulable (`"bash" -c x`), and `alwaysAllowRefusal` strips quotes so the card names the wrapper; a quote in the first two words offers no prefix; git's `-C`, `--git-dir`, `--work-tree`, `--namespace`, `--bare`, `--super-prefix` refuse a prefix; no resolvable workspace gives the `unchecked` reason, not "outside"; rule rows show "Added <date>" (the chat it came from is not stored, deferred); "Removed" clears when the rules list next changes.

### Fresh adversarial security review (step 4, 2026-10-31)

Brief: given only the diff and the code, find any command a saved rule would allow but shouldn't (quoting, unicode, whitespace, escapes, path tricks, wrappers, exec options, zsh expansion, chaining, the HTTP route). **Outcome: the fresh subagent did not complete.** A safety classifier stopped it after it had read `permission-matching.ts`, `shared/permissions.ts` and the decision schema, before it ran any attempt; it filed no findings. It flagged for study, untested: quote handling differing between checks (confirmed below as F1), `#` and `!` not refused (R6), git global-option skipping (confirmed as Q2), and whether the server re-derives the prefix (checked: it does). It was not relaunched with a reworded brief. In its place the orchestrator ran the same brief as a probe of 80 real inputs through `ruleMatches`, `alwaysAllowScope`, `alwaysAllowPrefixScope` and `commandPathsReach` against a temp project with a symlink out:

- F1 (confirmed, high): a quoted first word skipped the wrapper check. `"bash" -c x`, `b'a'sh -c x`, `'sudo' rm x` offered both scopes; a prefix rule `"bash"` matched `"bash" -c <anything>`. Fixed.
- F2 (low): a quoted second word went into the prefix (`npm "test"`, `ls "-la"`). Fixed: no prefix offered.
- F3 (medium, narrowing only): the two-word wrapper scan refused `npm run x`, `npm test -- init`. Fixed (R7).
- Blocked as intended: chains, CR, `\v`, NBSP, zero-width space, Cyrillic lookalike, `~`, `~root`, `C:/x`, `@/etc`, `x:/etc`, `--f=/etc`, `-I/etc`, a symlink out (any case), `.GIT`, `"./.git"`, `src/../AGENTS.MD`, `/usr/bin/env`, `env.exe`, `BASH.EXE`, `python3.12`, `pypy3`, `node22`, `busybox`, `command`, `git -c` (quoted too), `git --config-env`, `--exec-path`, `git config`, `git rebase --exec`, `npm --script-shell`, `npm exec` (quoted, flagged), `find -exec` (quoted), `NPM test`, `npm.cmd test`, `npm testx`, `npm-test`. Allowed as intended: `npm test -- --watch`, tab and edge spaces, `ls -la`, `find . -delete` under a `find` rule (R1), `npm test #x` / `!x` (R6).

**Open for the user:** the dedicated fresh security subagent's review is not done; the probe above stands in for it. Run a fresh security review in another session before treating this as signed off.

### Security review (independent, 2026-10-31)

A fresh reviewer added 97 matcher rows to `packages/core/test/permissions.test.ts` ("AD-40 review: what a saved command rule must never auto-approve"), 18 of them confirmed bypasses (`it.fails`): commands a saved prefix rule auto-approved. All 18 now refuse and are plain tests. The lesson: per-option blocklists leak, so for the programs where an option or subcommand can run another command a prefix rule now keeps to an allowlist (`packages/core/src/command-prefix-allowlists.ts`) and refuses anything else. Each allowlist edge has an allowed and a refused row in "AD-40 review fixes: prefix allowlists, each edge allowed and refused".

| # | Finding | Fix |
|---|---|---|
| I1 | `docker container run --privileged ...` approved under a `docker container` rule; `docker create` then `start` ran one too | docker, podman, nerdctl, docker-compose, podman-compose, kubectl, oc, helm never match a prefix rule; `container`, `create`, `start` added to the two-word wrappers (no exact rule either) |
| I2 | git options that run programs, missed by the blocklist: `grep -O`/`--open-files-in-pager` (abbreviated too), a value glued to a short flag (`-x"sh evil.sh"`), abbreviated long options (`--exe=`, `--upload-p=`), `clone -u ./evil.sh`, `clone -c core.hooksPath=...` | git allowlist: global `--no-pager`, `-P`, `--no-optional-locks` only; subcommands `status`, `diff`, `log`, `show`, `branch` (listing only), `rev-parse`, `ls-files`, `blame`, `describe`, `tag` (listing only), `add`, `commit` with `-m`/`--message`/`-am`, `restore`, `checkout -- <paths>`, each with an exact option list. Words are compared exactly and case-sensitively, so an abbreviation, a short cluster or a glued value not on the list refuses; git takes an exact option name over an abbreviation, so a listed name can't mean another option. A bare `--` (unquoted) ends the options |
| I3 | `reachedPath` resolved `..` lexically before symlinks: `hk/../hooks/pre-commit` with `hk` a link to `.git/hooks` reached `.git`; `vendor/../deep` with `vendor` a link out stayed "inside" | resolved one segment at a time with `realpath`, so each link is followed before the `..` after it (as the kernel reads it); segments past the first missing one are joined as written. Applies to file-tool paths too |
| I4 | Missing wrappers: `tcsh`, `csh`, `xcrun`, `nodejs`, `pypy`; `npm exe` (npm takes command abbreviations); `go run pkg@latest` | added to the wrapper list (also `ash`, `mksh`, `xonsh`, `nu`, `elvish`, `ipython`, `irb`, `ts-node`, `tsx`, `pkexec`, `gdb`, `lldb`, `valgrind`, `nodejs<N>`); npm `e`/`ex`/`exe`, `explo`/`explor`, `cr`...`creat`, `ini`/`innit`, `edit`/`ed`/`edi`; `go run`. The rest of the brief's list was already there |
| I5 | bsdtar accepts abbreviated long options (`--use-compress-prog=`) | tar allowlist: list mode only (`-t`/`--list`, old style `tf` too) with `v z j J f`, `f` last in a cluster, `--file`, `-C`/`--directory`, `--verbose`, `--gzip`/`--gunzip`/`--bzip2`/`--xz`; anything else refuses. Extracting is not covered (see R9) |
| I6 | `host:path`, `user@host:path` (rsync, scp, git remotes) and URLs treated as project paths | a path part that is `scheme://...` or has a `:` before any `/` is outside. The script name in `npm`/`pnpm`/`yarn run <script>` (`test:unit`) is a name, not a path, and is passed over |
| I7 | (found while fixing) npm-family prefix rules covered `npm install <pkg>`, whose install scripts run; abbreviations of `exec`; options before the subcommand | npm, pnpm, yarn allowlist: `test`, `run <script>`, `run-script`, `lint`, `build`, with npm options before a bare `--` from a short list (`--silent`, `-s`, `--if-present`, `--workspaces`, `--workspace`, ...); `install`/`ci` with no package and listed flags only; bare `npm`/`pnpm`/`yarn`. Anything else (`npm i`, `yarn eslint`, `yarn add`) asks. `npx`, `pnpx`, `bunx` never match; `bun` stays a wrapper |
| I8 | go: `go test -exec`, `go build -toolexec`, `go vet -vettool` | go allowlist: `test`, `build`, `vet` only, flags from a list (`-v`, `-race`, `-run`, `-count`, `-timeout`, `-o`, `-tags`, ...), one or two dashes, value after `=` or as the next word |

Also never covered by a prefix: `sed`, `ssh`, `scp`, `sftp`, `rsync`, `telnet`, `sudo`, `doas`, `su`, `pkexec`, `runuser`, editors and pagers, `crontab`, and archive or patch tools that write the paths their input names (`unzip`, `7z`, `cpio`, `patch`). `find -exec`, `zip -T`, `make --eval` keep their blocklists (no allowlist for them). Kept: chaining, substitution, redirection and unicode refusals; the server re-derives the prefix; no rules for custom agents, attended builds or Skip all. UI wording is unchanged: the prefix refusal reason is the same string, and no new card text was needed.

Existing saved rules only match fewer commands: every change refuses more (the allowlists sit behind the old text and path checks, and the old blocklists are gone only where an allowlist replaced them). Behaviour changes users will see: a saved `npm install` rule no longer answers `npm install <package>`; a `git` rule answers only the allowlisted subcommands; `rsync`, `docker`, `kubectl`, `git switch`, `git push` rules no longer answer anything; `git show HEAD:path` and other words with `x:` before a slash ask. Tests changed to match: the "Always allow stores the rule" and acceptance 2 tests save `npm install` (no package) instead of `npm install stripe`; the server prefix test uses `npm test -- cart`; `git switch -c topic` and `rsync -a src dst` moved from "keep their prefix" to refused.

Accepted risks after this review (supersedes R2 above; R1, R3 to R7 stand):
- R2 (revised) Programs with no allowlist and not on the never list (`find`, `make`, `cargo`, `pytest`, an unknown `some-tool --hook=x`) still rely on the text and path checks plus a short blocklist; an unknown option that runs a command is still covered by a one-word prefix rule for that program. The exact rule stays the default.
- R8 A `git add`/`commit`/`restore`/`checkout` rule runs the repo's hooks and filters (`.git/hooks`, `core.hooksPath`, clean/smudge filters, `core.fsmonitor`) from git config. `.git` is protected, so writing that config needs a card; the user's global git config is trusted. A one-word `git` rule (from `git --no-pager log`) covers every allowlisted subcommand, writes included.
- R9 `tar` extraction is refused for prefix rules (stricter than the brief): an archive can hold paths the command does not show (`.git/hooks/post-checkout`), and the agent can write an archive with an edit. The exact rule still covers a literal extract the user approved.
- R10 Our word split is a refinement of the shell's (we split on every space, the shell not inside quotes), so a quoted multi-word value is over-checked, never under-checked; a quoted `--` does not end the options.
- R11 Paths are checked when the request arrives; a link created between the check and the run (TOCTOU) is not caught.
- R12 `npm install`/`ci` with no package still runs the project's and its locked dependencies' install scripts (R1 applies).

## Plan Change Log

- 2026-10-31: added `permission.resolved.scope` (optional) for the record line; added `prefixRuleRefusal` and the `=word` refusal from the security review (S4, S12); both only narrow what is offered or matched.
- 2026-10-31 (independent security review): prefix rules for high-risk programs keep to allowlists (`command-prefix-allowlists.ts`, I1 to I8); `reachedPath` resolves segment by segment; remote `host:path` parts are outside; only narrows.

## Review Triage Log

Pass 1 (quick lens and security lens, fresh subagents; the security lens stopped early, see above): 7 quick findings plus 3 from the orchestrator's probe; high 1, medium 3, low 4, false 0, rejected 1, deferred 1.

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| Q1/F1 | Quoted first word skips the wrapper and interpreter check (`"bash" -c`, `"npm" exec`) | high | patch: a quote in the first word makes it unrulable; `alwaysAllowRefusal` strips quotes for the reason |
| Q2 | `git -C`, `--git-dir`, `--work-tree` make git load another folder's config (fsmonitor, pager) under a one-word `git` rule | medium | patch: those global options refuse a prefix |
| Q3/F3 | Two-word wrapper scan refuses ordinary arguments (`npm test -- x`) with a reason naming a subcommand never run | medium | patch: subcommand position only, full scan when a flag comes first; `docker compose`, `docker-compose run/exec` added so `docker compose exec` stays refused |
| Q4 | Old prefix rows for `sed`, `ssh`, `git config` stop matching rulable commands (AC 2) | low | rejected: the security constraints require these rows to narrow; AC 2's "rulable" includes prefix-rulable |
| Q5 | Rules list doesn't show when or in which chat a rule was added (EXPERIENCE.md) | medium | patch: "Added <date>"; the chat is not stored, deferred |
| Q6 | "Removed. Ogden will ask next time." stays forever | low | patch: clears when the list next changes |
| Q7 | No resolvable workspace says "names a path outside this project" | low | patch: `unchecked` reason |
| F2 | Quoted second word goes into the prefix | low | patch: no prefix offered |

## Design Notes

Gap list (today vs AD-40):
1. Today's single scope is already the prefix; AD-40's "current scope" next to it would be identical. Settled (ticket `unknown`): the current scope becomes the exact command, narrower, so the default never widens.
2. Scope offered on chained/redirected/protected commands (rule saved from them). Gap: not offered, reason shown. Deviation from EXPERIENCE Flow 6 failure ("offers only the current scope"): an exact rule for an unrulable command could never match, so offering it would be a false "Always allowed".
3. Shell syntax set covers `; & | \` < > $( ${` newline; missing bare `$VAR`, globs, braces, `( )` (zsh glob qualifiers run code), `%`, backslash, bidi isolates U+2066-2069. Gap: ASCII-only plus the refused set.
4. No path check for commands: `cat /etc/passwd` matched a `cat` rule. Gap: every word resolved inside, protected segments after symlinks.
5. Client sends no scope today (good); the choice is an enum.
6. Rules listed only in project settings; Settings (26.7) has no rules page. Gap: Projects group page.
7. Attended, custom agents and Skip all already refuse; device has no route yet (recorded).

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: full suite passes
- `pnpm exec playwright test tests/e2e/always-allow-prefix.spec.ts tests/e2e/permissions.spec.ts tests/e2e/settings-nav.spec.ts tests/e2e/caution.spec.ts tests/e2e/permission-modes.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
