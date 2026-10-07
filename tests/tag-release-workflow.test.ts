/**
 * The Tag release workflow, checked on the file: it runs only for main, tags only a version that is
 * the same in every manifest and has changelog notes, never moves or replaces a tag, publishes
 * nothing itself, and starts the Release workflow on the tag with the repository token (no stored
 * credential). The behaviour is checked by the first release it cuts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const text = readFileSync(join(ROOT, '.github', 'workflows', 'tag-release.yml'), 'utf8');
const workflow = parse(text) as { jobs: Record<string, any>; on: Record<string, any>; permissions: unknown; concurrency: unknown };
const job = workflow.jobs.tag;
const steps: Array<{ name?: string; if?: string; run?: string; env?: Record<string, string> }> = job.steps;
const step = (name: string) => {
  const found = steps.find((s) => s.name === name);
  if (!found) throw new Error(`no step named ${name}`);
  return found;
};

describe('tag-release.yml', () => {
  it('runs for pushes to main that touch package.json, and by hand, and only ever on main', () => {
    expect(workflow.on.push).toEqual({ branches: ['main'], paths: ['package.json'] });
    expect(Object.keys(workflow.on)).toContain('workflow_dispatch');
    expect(Object.keys(workflow.on)).not.toContain('pull_request');
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
  });

  it('has write access only to contents (the tag) and actions (starting the release), and never names a secret', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toEqual({ contents: 'write', actions: 'write' });
    expect(job.environment).toBeUndefined();
    expect(text).not.toMatch(/\$\{\{\s*secrets\./);
    expect(text).toContain('GH_TOKEN: ${{ github.token }}');
  });

  it('checks every manifest version and the changelog before the tag exists', () => {
    const versions = step('Read the version and check it is the same in every package').run!;
    for (const file of ['packages/server/package.json', 'packages/web/package.json', 'packages/desktop/package.json', 'packages/desktop/src-tauri/tauri.conf.json']) {
      expect(versions).toContain(file);
    }
    expect(step('The changelog has notes for this version').run).toContain('scripts/release-notes.mjs');
    const names = steps.map((s) => s.name);
    expect(names.indexOf('The changelog has notes for this version')).toBeLessThan(names.indexOf('Create the tag on this commit'));
  });

  it('skips when the tag exists, and never deletes, moves or force-pushes one', () => {
    expect(step('Is the version tagged already?').run).toContain('git ls-remote --exit-code --tags origin');
    expect(step('Create the tag on this commit').if).toBe("steps.existing.outputs.exists != 'true'");
    expect(step('Start the Release workflow on the tag').if).toBe("steps.existing.outputs.exists != 'true'");
    expect(step('Create the tag on this commit').run).toContain('git tag -a "$TAG" -m "Release $TAG" "$GITHUB_SHA"');
    expect(text).not.toMatch(/git tag -[a-z]*f|git push[^\n]*(--force|-f\b|--delete|:refs)|git tag -d/);
  });

  it('publishes nothing itself: it only starts the Release workflow on the tag', () => {
    expect(step('Start the Release workflow on the tag').run).toContain('gh workflow run release.yml --ref "$TAG"');
    expect(text).not.toMatch(/gh release|npm publish/);
  });

  it('is one job, never cancelled halfway', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['tag']);
    expect(workflow.concurrency).toEqual({ group: 'tag-release', 'cancel-in-progress': false });
  });
});
