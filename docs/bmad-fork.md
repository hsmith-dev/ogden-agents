# Ogden Agents' BMad Method fork

Ogden Agents runs BMad Method from its own maintained fork, [`hsmith-dev/BMAD-METHOD`](https://github.com/hsmith-dev/BMAD-METHOD): upstream [`bmad-code-org/BMAD-METHOD`](https://github.com/bmad-code-org/BMAD-METHOD) plus the few patches Ogden Agents needs (architecture AD-13).

User decision, 2026-10-04: "We should only be forking BMad and maintaining it with changes from BMad, we do not want to push anything to upstream." Upstream is fetched, never written to: no pushes, pull requests, issues or comments on `bmad-code-org` repositories, and no pull request from the fork to upstream.

## Branches and tags

| Name in the fork | What it is |
| --- | --- |
| `upstream` | The upstream commit the patches sit on (an exact copy of an upstream commit, never edited). |
| `ogden-agents` | `upstream` plus Ogden Agents' patches, one commit each. Rebased on every sync. |
| `ogden-agents/<date>` tags | One per sync, on the `ogden-agents` commit of that day (`.2`, `.3`... when a day has more). Never moved or deleted. |
| `main` | Left as GitHub's default branch; not used by Ogden Agents. |

A release pins one tag's commit in `packages/adapters/src/bmad-source/bmad-lock.json` (`ref` is the tag, never the branch, because a rebase rewrites the branch while the tag keeps every released commit downloadable), with `base` naming the upstream commit it sits on. The download and its verification are the same as for any pin (CONTRIBUTING.md).

Current pin: tag `ogden-agents/2026-10-04`, commit `642c4e5`, on upstream `1cbcfa2` (the upstream commit Ogden Agents pinned before the fork, kept to avoid unrelated changes).

## Ogden Agents' patches

| Patch | Why |
| --- | --- |
| `feat(ticket): add --config-utils to name the config merge script` | `tickets.py` imports the BMad config script from `<project>/_bmad/scripts/config_utils.py`. With `--config-utils PATH` Ogden Agents points it at a private snapshot of the trusted project's scripts, written from the very bytes it checked, so a change after the check never runs. |

A new patch is a commit on `ogden-agents` with a test in upstream's own suite. Keep each one small so it rebases cleanly.

## Syncing with upstream

`scripts/bmad-fork-sync.mjs` does steps 1 to 5 in a local clone of the fork. It fetches upstream, never pushes there (the `upstream` remote's push URL is disabled), and pushes only to `hsmith-dev/BMAD-METHOD`, and only with `--push`.

```sh
git clone https://github.com/hsmith-dev/BMAD-METHOD.git ../BMAD-METHOD-fork
node scripts/bmad-fork-sync.mjs --clone ../BMAD-METHOD-fork --base <upstream commit>      # rebase, check, tag
node scripts/bmad-fork-sync.mjs --clone ../BMAD-METHOD-fork --base <upstream commit> --push  # the same, then push to the fork
```

1. **Fetch upstream**: `git fetch upstream` (`upstream` = `bmad-code-org/BMAD-METHOD`, fetch only).
2. **Move the `upstream` branch** to the chosen upstream commit (`--base`; default upstream `main`). Pick a commit on upstream `main`.
3. **Rebase `ogden-agents`**: `git rebase --onto <new base> <old base> ogden-agents`. On a conflict the script stops; resolve it, `git rebase --continue`, and do the rest by hand. Drop a patch upstream has since made unnecessary.
4. **Run upstream's checks**: `uv sync --frozen && uv run --frozen pre-commit run --all-files` (ruff, the validators and upstream's pytest, `tickets.py`'s tests included).
5. **Tag** the new `ogden-agents` commit `ogden-agents/<date>` and **push** `upstream`, `ogden-agents` (with a lease) and the tag to the fork.
6. **Move Ogden Agents' pin** (an Ogden Agents pull request, as in CONTRIBUTING.md, "Bumping a pin"): paste the entry the script printed into `bmad-lock.json`, run `node scripts/bmad-lock.mjs --print` for its `contentHash`, then `node scripts/bmad-lock.mjs --check`; copy the changed fixture files into `tests/fixtures/bmad-upstream/`; run `pnpm test`; note it in `CHANGELOG.md`.

CI's `BMad pins` job re-checks the pin on every push: the tarball's content hash, the commit in the tag's history, and the `base` in upstream `main`'s history and an ancestor of the commit. It only reads from GitHub.
