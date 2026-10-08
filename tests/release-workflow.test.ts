/**
 * The Release workflow's guard and publish jobs, checked on the file (RELEASING.md, "Releasing,
 * going forward"): versions are continuous and date-based (`YYYY.M.D-N`), so every release
 * publishes to npm's `latest` dist-tag and is never marked a GitHub prerelease. The desktop jobs
 * are checked separately in tests/desktop-release-workflow.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const text = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const workflow = parse(text) as { jobs: Record<string, any> };
const jobs = workflow.jobs;

/** The `Versions match the tag` step's inline script, as a plain string for pattern checks. */
const versionStep = jobs.guard.steps.find((s: { name?: string }) => s.name === 'Versions match the tag').run as string;

describe('release.yml, versions and dist-tags', () => {
  it('the guard validates the date-based format, not classic semver', () => {
    const match = /VERSION_PATTERN = \/(.*)\/;/.exec(versionStep);
    expect(match, 'no VERSION_PATTERN found in the guard\'s version step').not.toBeNull();
    const pattern = new RegExp(match![1]!);
    for (const good of ['2026.10.7-1', '2026.10.7-2', '2026.10.8-1']) expect(pattern.test(good), good).toBe(true);
    for (const bad of ['2026.10.07-1', '2026.10.7-01', '2026.10.7', '1.0.0', '0.5.0-rc.1']) expect(pattern.test(bad), bad).toBe(false);
  });

  it('every release always publishes to the latest dist-tag; there is no more prerelease split', () => {
    expect(versionStep).toContain('const distTag = "latest";');
    expect(versionStep).not.toContain('includes("-") ? "next" : "latest"');
  });

  it('the GitHub Release is never marked a prerelease for a version tag', () => {
    const createStep = jobs['github-release'].steps.find((s: { name?: string }) => s.name === 'Create the release if needed and attach the assets').run as string;
    expect(createStep).not.toContain('--prerelease');
    expect(createStep).not.toContain('DIST_TAG');
    expect(createStep).toContain('gh release create "$TAG" --verify-tag --draft --title "$TAG" --notes-file release/notes.md');
  });

  it('npm publish still uses the guard\'s dist-tag output (now always latest), unchanged mechanically', () => {
    const publishStep = jobs.publish.steps.find((s: { name?: string }) => s.name === 'Publish').run as string;
    expect(publishStep).toContain('--tag "$DIST_TAG"');
    expect(jobs.publish.env.DIST_TAG).toBe('${{ needs.guard.outputs.dist-tag }}');
  });
});
