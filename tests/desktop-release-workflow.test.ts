/**
 * The release workflow's desktop part, checked on the file (story 13.9, AD-23): the user's updater
 * key and the code-signing secrets exist only in the `desktop-release` environment's job, the
 * unsigned path names no environment and no secret, the GitHub Release waits for the desktop files,
 * the npm publish job is untouched, and nothing here can create a tag. The behaviour is checked by
 * the release dry run and the first real release.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const text = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const workflow = parse(text) as { jobs: Record<string, any>; on: Record<string, unknown> };
const jobs = workflow.jobs;

describe('release.yml, desktop jobs', () => {
  it('keeps the npm publish job and its environment exactly as they were', () => {
    expect(jobs.publish.environment).toBe('npm-release');
    expect(jobs.publish.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(jobs.publish.needs).toEqual(['guard', 'ci']);
    expect(jobs.publish.if).toContain("vars.NPM_PUBLISH == 'true'");
  });

  it('builds signed updates only in the desktop-release environment and only when DESKTOP_SIGNING is true', () => {
    expect(jobs['desktop-signed'].environment).toBe('desktop-release');
    expect(jobs['desktop-signed'].if).toContain("vars.DESKTOP_SIGNING == 'true'");
    expect(Object.keys(jobs['desktop-signed'].env)).toContain('TAURI_SIGNING_PRIVATE_KEY');
    expect(jobs['desktop-signed'].permissions).toEqual({ contents: 'read' });
  });

  it('the unsigned path names no environment and reads no secret', () => {
    const unsigned = JSON.stringify(jobs['desktop-unsigned']);
    expect(jobs['desktop-unsigned'].environment).toBeUndefined();
    expect(unsigned).not.toMatch(/\$\{\{\s*secrets\./);
    expect(jobs['desktop-unsigned'].if).toContain("vars.DESKTOP_SIGNING != 'true'");
  });

  it('no secret appears outside the desktop-release job, except the repository token of the release job', () => {
    for (const [name, job] of Object.entries(jobs)) {
      if (name === 'desktop-signed') continue;
      expect(JSON.stringify(job), name).not.toMatch(/\$\{\{\s*secrets\.(TAURI|APPLE|WINDOWS)/);
    }
    // The composite action reads no secret: the calling job passes them as environment.
    expect(readFileSync(join(ROOT, '.github', 'actions', 'desktop-build', 'action.yml'), 'utf8')).not.toMatch(/\$\{\{\s*secrets\./);
  });

  it('the GitHub Release waits for the desktop files and attaches them, and no desktop job has write access', () => {
    expect(jobs['github-release'].needs).toContain('desktop-assets');
    expect(jobs['github-release'].if).toContain("needs.desktop-assets.result == 'success'");
    expect(JSON.stringify(jobs['github-release'])).toContain('desktop/*');
    for (const name of ['desktop-signed', 'desktop-unsigned', 'desktop-assets']) expect(jobs[name].permissions, name).toEqual({ contents: 'read' });
    expect(jobs['github-release'].permissions).toEqual({ contents: 'write' });
  });

  it('the guard checks the desktop versions too, and the workflow never creates or pushes a tag', () => {
    expect(text).toContain('packages/desktop/src-tauri/tauri.conf.json');
    expect(text).not.toMatch(/git (tag|push)/);
    expect(text).not.toContain('gh release create "$TAG"" --tag');
    // The one release it creates by name is the permanent channel prerelease, targeted at the commit.
    expect(text).toContain('gh release create desktop-channel-next --target "$GITHUB_SHA" --prerelease');
  });

  it('a dry run (workflow_dispatch) builds the desktop files and creates no release', () => {
    expect(Object.keys(workflow.on)).toContain('workflow_dispatch');
    expect(jobs['github-release'].if).toContain("github.event_name == 'push'");
    expect(jobs['desktop-assets'].if).not.toContain("github.event_name == 'push'");
  });
});
