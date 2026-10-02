# Pinned upstream fixture

A stand-in for the pinned upstream BMad Method tree (story 4.14), so the
server's real-`uv` board test can download, verify and run `tickets.py`
without the network: the test packs this folder into a codeload-style
tarball (`tests/fixtures/tar.ts`) and pins its content hash in a test lock.

`skills/bmad-ticket/scripts/tickets.py` is an unchanged copy of
`skills/bmad-ticket/scripts/tickets.py` from upstream
[`bmad-code-org/BMAD-METHOD`](https://github.com/bmad-code-org/BMAD-METHOD)
at commit `1cbcfa272fe65787c06a1fa164a901f46117cca7`, the commit
`packages/adapters/src/bmad-source/bmad-lock.json` pins. Upstream's license
(MIT) applies to it. When the pin moves, copy the file again from the new
commit.
