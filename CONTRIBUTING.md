# Contributing

Development setup, commands and CI are in the README's [Develop](README.md#develop) section. This file covers the two forks Ogden Agents ships.

## Bundled forks

Ogden Agents works with BMad Method. Each release ships its own pinned copies of two forks inside the npm package (architecture AD-13), so every machine and every epic runs the same versions and nothing is fetched at install or run time:

| Fork | Upstream | Vendored as |
| --- | --- | --- |
| [`hsmith-dev/BMAD-METHOD`](https://github.com/hsmith-dev/BMAD-METHOD) | [`bmad-code-org/BMAD-METHOD`](https://github.com/bmad-code-org/BMAD-METHOD) | `vendor/bmad-method/skills/`, a copy of the fork's `skills/` |
| [`hsmith-dev/bmad-loop`](https://github.com/hsmith-dev/bmad-loop) | [`bmad-code-org/bmad-loop`](https://github.com/bmad-code-org/bmad-loop) | `vendor/bmad-loop/bmad_loop-<version>-py3-none-any.whl`, built with `uv build --wheel` |

`forks.lock` records, for each fork, the GitHub repo, its upstream, the tag, the full commit SHA, the vendored path and a content hash of the vendored files. For bmad-loop it also pins the wheel's build backend (`buildConstraints`), so a rebuild produces the same files. `vendor/` and `forks.lock` are committed, and `vendor/` ships in the package.

CI runs `node scripts/vendor-forks.mjs --check` on every OS. It downloads each fork at its locked commit, re-derives the skills and rebuilds the wheel, and fails, naming the file, if anything in `vendor/` differs (contents, or a skill's executable bit outside Windows) or a hash doesn't match the lock. It also fails if a fork's `tag` no longer points at the locked `commit`. Only files git tracks or would track count, so ignored files such as `.DS_Store` don't. Skill hashes normalize CRLF to LF, so a Windows checkout passes. The wheel is compared by its file list and each file's contents, not its archive bytes, because wheels embed timestamps.

### Branches and tags

Each fork has two branches besides its default `main`:

- **`upstream`** mirrors upstream's branch exactly. It never carries our commits.
- **`ogden-agents`** is `upstream` plus one commit per patch, and each patch is also opened as a pull request upstream. There are no patches yet.

Releases of a fork are tags on `ogden-agents`, named `v<upstream version>-ogden-agents.<n>`, for example `v6.13.0-next-ogden-agents.0` or `v0.13.0-ogden-agents.0`. `<n>` starts at 0 for each upstream version and goes up by one for each new tag on it.

### Adding a patch

1. Branch from `upstream`, make the change, and open a pull request against upstream.
2. Cherry-pick the same single commit onto `ogden-agents`, and keep it as one commit (squash any follow-ups into it) so each patch maps to one upstream pull request. Name the pull request in the commit message.
3. Tag `ogden-agents` with the next `v<upstream version>-ogden-agents.<n>` and bump the pin below.

### Syncing with upstream

1. Fast-forward `upstream` to upstream's branch.
2. Rebase `ogden-agents` onto `upstream`. Drop any patch upstream has merged: once upstream has the change, the fork no longer carries it.
3. Tag the result (`<n>` restarts at 0 on a new upstream version) and bump the pin.

### Bumping a pin

Needs the network and [`uv`](https://docs.astral.sh/uv/).

1. In `forks.lock`, set the fork's `tag` and its full `commit` SHA (`git rev-parse <tag>^{commit}` in the fork).
2. Run `node scripts/vendor-forks.mjs`. It rewrites `vendor/` from the locked commits and updates each `contentHash` (and the bmad-loop `vendored` path if the version changed).
3. Run `node scripts/vendor-forks.mjs --check`, then commit `forks.lock` and `vendor/` together.

To change the bmad-loop build backend, edit `buildConstraints` and re-run the script. Changing the lock's commit without re-vendoring fails `--check` with a hash mismatch.
