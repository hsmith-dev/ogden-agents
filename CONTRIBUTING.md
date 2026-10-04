# Contributing

Development setup, commands and CI are in the README's [Develop](README.md#develop) section. This file covers how Ogden Agents uses BMad Method.

## Pinned upstream BMad

Ogden Agents works with BMad Method. It carries no forks and the npm package ships no BMad files (architecture AD-13). Instead, each release pins upstream BMad Method to one commit and a content hash in `packages/adapters/src/bmad-source/bmad-lock.json` (bundled into the server):

| Source | Upstream | What is used |
| --- | --- | --- |
| `bmad-method` | [`bmad-code-org/BMAD-METHOD`](https://github.com/bmad-code-org/BMAD-METHOD) | the commit's `skills/` folder (`include: "skills/"`) |

The entry records the repo, the `ref` (branch or tag) the commit must be in the history of, the full `commit`, the `version` upstream gives it, the `include` folder and the `contentHash`: sha256 over every selected file's path and contents, in sorted path order, with text normalized from CRLF to LF. The hash is over contents, not archive bytes, because GitHub's tarball bytes aren't stable.

At run time Ogden Agents downloads a pinned tarball only when the user asks (Download BMad Method on the Board, and later Set up and Update), never on startup or a page load. It verifies the content hash in memory, refuses a mismatch or any unsafe entry (links, paths outside the folder), and writes only the verified regular files into `<data folder>/bmad/<source>/<commit>/`. BMad's scripts Ogden Agents runs itself (`tickets.py`, `setup.py`) run only from there, never from a project's own copy. After an upgrade that moves a pin, the user downloads again.

The hashing, tar reading and safe selection live in one module, `packages/adapters/src/bmad-source/archive.ts`, used by both the app and the CI check.

CI's `bmad-pins` job runs `node scripts/bmad-lock.mjs --check`: it downloads each pinned commit's tarball, recomputes the content hash through `archive.ts`, and fails if it doesn't match the lock, or if GitHub's compare API says the commit is not in the history of the lock's `ref`. No test touches the network.

### Changes Ogden Agents needs in BMad

Open them as pull requests upstream. Ogden Agents uses a change once upstream merges it and the pin moves; until then it works without it, or keeps the piece on its own side (such as the plain-language skill labels, which live in Ogden Agents' own `packages/adapters/src/bmad-catalog/skill-labels.json`, keyed by skill name).

### Bumping a pin

Needs the network.

1. In `bmad-lock.json`, set the source's full `commit` SHA (and `ref` and `version` if they changed).
2. Run `node scripts/bmad-lock.mjs --print` and copy each printed `contentHash` into the lock.
3. Run `node scripts/bmad-lock.mjs --check`.
4. When the BMad Method commit changes, copy `skills/bmad-ticket/scripts/tickets.py` from it into `tests/fixtures/bmad-upstream/` (the real-`uv` board test runs it), and run `pnpm test`.
5. Note the new versions in `CHANGELOG.md`: users download the new pin once after upgrading.
