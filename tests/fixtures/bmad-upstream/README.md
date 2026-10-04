# Pinned upstream fixture

A stand-in for the pinned upstream BMad Method tree (story 4.14), so the
server's real-`uv` board test can download, verify and run `tickets.py`
without the network, and the real-`uv` setup tests (story 4.3) can run
`setup.py` from a verified copy: the tests pack this folder into a codeload-style
tarball (`tests/fixtures/tar.ts`) and pins its content hash in a test lock.

`skills/bmad-ticket/scripts/tickets.py` is an unchanged copy of
`skills/bmad-ticket/scripts/tickets.py` from upstream
[`bmad-code-org/BMAD-METHOD`](https://github.com/bmad-code-org/BMAD-METHOD)
at commit `1cbcfa272fe65787c06a1fa164a901f46117cca7`, the commit
`packages/adapters/src/bmad-source/bmad-lock.json` pins. Upstream's license
(MIT) applies to it. When the pin moves, copy the file again from the new
commit.

`skills/bmad/` (without its `scripts/tests/`), `skills/bmod-method/` and
`skills/bmod-core-tools/` are unchanged copies of the same folders at the
same commit (story 4.3): `setup.py`, the runtime payload and the module
records BMad Method's setup reads. Copy them again too when the pin moves.

`skills/bmad-product-brief/` is an unchanged copy of the same folder at the
same commit (entry 4.12): the label trust's verified case, a repo skill
whose folder equals the pinned copy's. Copy it again too when the pin moves.
