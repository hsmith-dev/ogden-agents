## What and why

<!-- One or two sentences. Link the issue or story. -->

## Checklist

- [ ] `pnpm typecheck` and `pnpm test` pass locally (CI decides)
- [ ] Tests use no real agent, keychain, network or `~/.claude`
- [ ] No keys or tokens in code, tests or docs
- [ ] User-facing copy is plain language, no dashes
- [ ] If a plan or the deferred-work index changed: `PROVENANCE_BASE=origin/main pnpm provenance` passes
- [ ] Nothing here is aimed at `bmad-code-org/BMAD-METHOD` (see CONTRIBUTING.md)

Merge with a merge commit.
