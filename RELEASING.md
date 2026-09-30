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

## First release (0.1.0) checklist

Steps 1 to 3 are one-time setup and need the repository owner.

### 1. Make the repository public

GitHub → `hsmith-dev/ogden-agents` → Settings → General → Danger Zone → Change repository visibility → Public.

npm only records provenance for packages published from a public repository. The workflow still publishes from a private one, without provenance.

### 2. Configure the npm trusted publisher

On npmjs.com, signed in as an owner of `ogden-agents`: the package page → Settings → Trusted Publisher → GitHub Actions, with exactly:

| Field | Value |
| --- | --- |
| Organization or user | `hsmith-dev` |
| Repository | `ogden-agents` |
| Workflow filename | `release.yml` |
| Environment name | `npm-release` |

Save. The values are case-sensitive and must match the workflow: renaming `release.yml` or the `npm-release` environment breaks publishing until this setting is updated. If publish fails with `ENEEDAUTH`, `E401`, `E403` or `E404`, this setting is missing or doesn't match.

After the first successful release, you can also set Settings → Publishing access to "Require two-factor authentication and disallow tokens", so only trusted publishing can publish.

Optional: GitHub → Settings → Environments → `npm-release` (created by the first run if it doesn't exist) → limit deployment to tags matching `v*.*.*`, and add yourself as a required reviewer to approve each publish by hand.

### 3. Merge epic 1 to `main`

Merge the epic 1 story branches to `main` in order, and wait for CI on `main` to pass. `main` must hold the versions `0.1.0` (root, server and web `package.json`), a root `package.json` with `"private": false`, and the 0.1.0 entry in `CHANGELOG.md`.

### 4. Tag

On the `main` commit to release:

```sh
git switch main && git pull
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

### 5. Watch the release

GitHub → Actions → Release. All jobs should go green: guard, CI, publish, then the registry and provenance check and the six verify jobs. Then check:

```sh
npm view ogden-agents version     # 0.1.0
npx ogden-agents@0.1.0            # starts and opens the page
```

The package page on npmjs.com shows a provenance badge linking back to the workflow run.

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
| Publish: `ENEEDAUTH`, `E401`, `E403` or `E404` | The trusted publisher is missing or doesn't match (step 2). Fix it on npmjs.com and re-run the failed jobs. Nothing was published. |
| Publish: `E422` | npm's provenance check rejected the package, usually because `repository.url` in the root `package.json` isn't exactly `git+https://github.com/hsmith-dev/ogden-agents.git` (`tests/packaging.test.ts` checks it). Nothing was published. Fix it on `main`, delete the tag, and tag the fixed commit. |
| Registry and provenance fails | The release is published. If the version never showed up, re-run the job. If provenance is missing from a public repository, check the repository was public when the release ran; the next release will carry it. |
| Verify fails on one OS | The release is public but broken there. Never unpublish: fix on `main` and release the next patch version. |
