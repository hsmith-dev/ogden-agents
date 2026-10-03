# Plain BMad Method fixtures

Two BMad Method installs that Ogden Agents didn't make (entry 4.11, reduced
mode): `plain-repos.ts` holds their files, and each test builds a temp copy
with `createPlainRepo`, so the fixtures themselves are never written.

- **`older`**: the layout the classic installer left before module records
  (`bmod.toml`) existed: `_bmad/_config/manifest.yaml`, `_bmad/bmm/config.yaml`,
  one skill (`bmad-help`) Ogden Agents' label mapping doesn't know, no
  `_bmad/scripts/` and no `_bmad/config.toml`. It lacks both capabilities
  (`plain_labels`, `ticket_tree`).
- **`bmod`**: the module-record layout of an older upstream: a `bmod-method`
  record at version `6.10.0`, a `_bmad/config.toml` with the project's own
  values (its output folder is `docs/planning`), `_bmad/custom/`, a mapped
  skill (`bmad-spec`) the user changed by hand in `.agents/skills`, and a
  `_bmad/scripts/config_utils.py` without `load_central_config`. It has
  `plain_labels` and lacks `ticket_tree`.

Provenance: hand-written for these tests, after the shape of upstream
[`bmad-code-org/BMAD-METHOD`](https://github.com/bmad-code-org/BMAD-METHOD)
installs. The `older` file names are the ones the pinned upstream
`setup.py` lists as classic-installer leftovers (`LEGACY_LEFTOVERS` in
`tests/fixtures/bmad-upstream/skills/bmad/scripts/setup.py`); the `bmod`
layout follows what that `setup.py` writes (`_bmad/config.toml`,
`_bmad/scripts/`, `_bmad/custom/`), with the config script reduced to a
loader that predates `load_central_config`, which the pinned `tickets.py`
imports. No upstream file is copied, so no upstream license applies.

The pinned baseline, where both capabilities are present, is
`tests/fixtures/bmad-upstream/`.
