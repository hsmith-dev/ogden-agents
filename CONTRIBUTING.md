# Contributing

Thanks for looking. Ogden Agents is a small open source project (MIT) run by one maintainer, so please keep changes small and focused. By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, follow [SECURITY.md](SECURITY.md) and not a public issue.

## Setup and checks

- Use **pnpm** (never npm or yarn) and Node.js 24 or later. `pnpm install`, then `pnpm typecheck` and `pnpm test`. The README's [Develop](README.md#develop) section lists the rest, including `pnpm e2e`.
- Run the full `pnpm test` before you push a code change. CI runs it on macOS, Windows and Linux and decides whether a PR can merge.
- **Tests never use a real agent, the real keychain, the real network or your real `~/.claude`.** Use the fakes and injected clients the existing tests use. A test that needs one of those is a bug in the test.
- Keep user-facing copy in plain language, and don't use dashes in it.
- Never put a real key or token in code, tests or docs. Test fixtures use obviously fake values such as `sk-ant-api03-..._TEST_ONLY_...`; CI's secret scan fails on anything that looks real.

## How work is planned: BMad

This project is built with the BMad Method. Work is tracked as epics and stories under `_bmad-output/`, and each story has a plan file, a review, and a triage log. For anything bigger than a small fix, open an issue first so the change can be agreed before you write it. Maintainers follow the same flow with the BMad skills. [AGENTS.md](AGENTS.md) has the conventions and known pitfalls; coding agents and people should read it first.

## Branches, pull requests and provenance

- Branch from `main`, one branch per change, with a short name such as `fix/...`, `docs/...` or `story/<id>-...`. Do not push to `main`.
- One focused pull request per change. Fill in the pull request template. CI must be green.
- Plans carry a `baseline_revision`, and `_bmad-output/` keeps an index of deferred work. If you touch either, run `PROVENANCE_BASE=origin/main pnpm provenance` and fix what it reports. CI runs the same check.
- Maintainers merge with a **merge commit** (`gh pr merge N --merge`), not squash or rebase, so each branch's history stays readable. Use `--force-with-lease`, and only on your own branch.
- Never push to, open a pull request against, or comment on `bmad-code-org/BMAD-METHOD`. Changes to BMad go to this project's fork, [`hsmith-dev/BMAD-METHOD`](https://github.com/hsmith-dev/BMAD-METHOD), as described in [docs/bmad-fork.md](docs/bmad-fork.md).

## Using BMad Method inside Ogden Agents

The rest of this file covers how Ogden Agents uses BMad Method.

## Pinned BMad Method, from Ogden Agents' fork

Ogden Agents works with BMad Method from its own maintained fork, and the npm package ships no BMad files (architecture AD-13). Each release pins the fork to one commit and a content hash in `packages/adapters/src/bmad-source/bmad-lock.json` (bundled into the server):

| Source | Repo | Built on | What is used |
| --- | --- | --- | --- |
| `bmad-method` | [`hsmith-dev/BMAD-METHOD`](https://github.com/hsmith-dev/BMAD-METHOD), tag `ogden-agents/<date>` | upstream [`bmad-code-org/BMAD-METHOD`](https://github.com/bmad-code-org/BMAD-METHOD) | the commit's `skills/` folder (`include: "skills/"`) |

How the fork is kept in step with upstream, and why nothing is ever pushed upstream, is in [docs/bmad-fork.md](docs/bmad-fork.md).

The entry records the repo, the `ref` (for the fork, a tag that never moves) the commit must be in the history of, the full `commit`, the upstream `base` it is built on (`repo`, `ref`, `commit`), the `version` upstream gives it, the `include` folder and the `contentHash`: sha256 over every selected file's path and contents, in sorted path order, with text normalized from CRLF to LF. The hash is over contents, not archive bytes, because GitHub's tarball bytes aren't stable.

At run time Ogden Agents downloads a pinned tarball only when the user asks (Download BMad Method on the Board, and later Set up and Update), never on startup or a page load. It verifies the content hash in memory, refuses a mismatch or any unsafe entry (links, paths outside the folder), and writes only the verified regular files into `<data folder>/bmad/<source>/<commit>/`. BMad's scripts Ogden Agents runs itself (`tickets.py`, `setup.py`) run only from there, never from a project's own copy. After an upgrade that moves a pin, the user downloads again.

The hashing, tar reading and safe selection live in one module, `packages/adapters/src/bmad-source/archive.ts`, used by both the app and the CI check.

CI's `bmad-pins` job runs `node scripts/bmad-lock.mjs --check`: it downloads each pinned commit's tarball, recomputes the content hash through `archive.ts`, and fails if it doesn't match the lock, if GitHub's compare API says the commit is not in the history of the lock's `ref`, or if the `base` is not in upstream's history or not an ancestor of the commit. It only reads from GitHub. No test touches the network.

### Changes Ogden Agents needs in BMad

Make them as commits on the fork's `ogden-agents` branch, with a test in upstream's own suite, then tag and move the pin (docs/bmad-fork.md). Never open them upstream. A piece that needn't live in BMad stays on Ogden Agents' side (such as the plain-language skill labels, in `packages/adapters/src/bmad-catalog/skill-labels.json`, keyed by skill name).

### Bumping a pin

Needs the network.

1. In `bmad-lock.json`, set the source's full `commit` SHA, its `ref` (the fork's new tag) and `base`, and `version` if it changed (`node scripts/bmad-fork-sync.mjs` prints the entry).
2. Run `node scripts/bmad-lock.mjs --print` and copy each printed `contentHash` into the lock.
3. Run `node scripts/bmad-lock.mjs --check`.
4. When the BMad Method commit changes, copy `skills/bmad-ticket/scripts/tickets.py` and the other fixture folders from it into `tests/fixtures/bmad-upstream/` (the real-`uv` board and setup tests run them), and run `pnpm test`.
5. Note the new versions in `CHANGELOG.md`: users download the new pin once after upgrading.
