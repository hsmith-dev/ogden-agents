/**
 * 8.7's candidate finder and relative-link resolution, as pure functions:
 * a chat candidate is path characters with a `/` or an extension, an
 * optional `:line(:col)` or `#Lline`, a leading `./` dropped, trailing dots
 * stripped, never a URL, absolute, `~` or `..` path; a markdown file's
 * relative link is joined with its folder, decoded once, and dropped when
 * it leaves the project, has a scheme or is an anchor.
 */
import { describe, expect, it } from 'vitest';
import { markdownLinkCandidates, parseFileTarget, pathCandidates, resolveRelative, viewerSearch } from '../src/workbench/path-links';

describe('chat path candidates', () => {
  it('finds paths and file:line targets, drops ./ and sentence dots, and dedupes', () => {
    expect(pathCandidates('see `src/a.ts:12`, then ./src/b.ts#L3 and README.md. Also src/a.ts:40 and pkg/__init__.py!')).toEqual(['src/a.ts', 'src/b.ts', 'README.md', 'pkg/__init__.py']);
    expect(parseFileTarget('src/a.ts:12')).toEqual({ path: 'src/a.ts', line: 12 });
    expect(parseFileTarget('src/a.ts:12:4')).toEqual({ path: 'src/a.ts', line: 12 });
    expect(parseFileTarget('./src/a.ts#L7')).toEqual({ path: 'src/a.ts', line: 7 });
    expect(parseFileTarget('src/a.ts')).toEqual({ path: 'src/a.ts' });
    expect(parseFileTarget('.env')).toEqual({ path: '.env' });
    expect(parseFileTarget('@types/node')).toEqual({ path: '@types/node' });
  });

  it('never offers a URL, an absolute, ~, .., backslash, scheme or plain word', () => {
    const text = [
      'https://x.io/a.ts',
      'http://localhost:3000/src/a.ts',
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      '//host/a.ts',
      '/etc/passwd',
      '~/notes.md',
      '../x.ts',
      'a/../../x.ts',
      'C:\\x\\y.ts',
      'src\\a.ts',
      '%2e%2e/x.ts',
      'hello',
      'word.',
      'src/a.ts:0',
    ].join(' ');
    expect(pathCandidates(text)).toEqual([]);
    for (const token of ['/etc/passwd', '../x.ts', 'a//b.ts', 'src/a.ts:0', 'hello', 'javascript:alert(1)', 'C:/x.ts', 'a b.ts']) expect(parseFileTarget(token), token).toBeNull();
  });

  it('offers at most 100 paths per message', () => {
    expect(pathCandidates(Array.from({ length: 150 }, (_, i) => `src/f${i}.ts`).join(' '))).toHaveLength(100);
  });
});

describe('markdown relative links', () => {
  it("joins with the file's folder, takes #L as the line, drops ?query and decodes once", () => {
    expect(resolveRelative('docs/guide/x.md', './a.ts#L3')).toEqual({ path: 'docs/guide/a.ts', line: 3 });
    expect(resolveRelative('docs/x.md', '../src/a.ts')).toEqual({ path: 'src/a.ts' });
    expect(resolveRelative('README.md', 'src/a.ts?raw=1#L12-L14')).toEqual({ path: 'src/a.ts', line: 12 });
    expect(resolveRelative('README.md', 'my%20notes.md')).toEqual({ path: 'my notes.md' });
    expect(resolveRelative('docs/x.md', '%2e%2e/src/a.ts')).toEqual({ path: 'src/a.ts' });
    expect(resolveRelative('README.md', '<src/a.ts> "Title"')).toEqual({ path: 'src/a.ts' });
    expect(resolveRelative('README.md', 'src/a.ts "Title"')).toEqual({ path: 'src/a.ts' });
    expect(resolveRelative('README.md', 'src/a.ts#intro')).toEqual({ path: 'src/a.ts' });
  });

  it('is null for anchors, schemes, //host, absolute, ~, backslashes, encoded escapes and anything leaving the project', () => {
    for (const href of [
      '#intro',
      'https://ok.io',
      'javascript:x',
      'JavaScript:alert(1)',
      'data:text/html,<script>',
      'file:///etc/passwd',
      'mailto:a@b.c',
      '//host/a.ts',
      '/etc/passwd',
      '~/x.md',
      '..\\x',
      'src\\a.ts',
      '../../etc/passwd',
      '%2e%2e/%2e%2e/etc/passwd',
      '%2Fetc%2Fpasswd',
      '%5c..%5cx',
      'a%3Ab',
      '%E0%A4%A',
      '',
    ]) {
      expect(resolveRelative('docs/x.md', href), href).toBeNull();
    }
  });

  it("collects a file's link targets, images too, and none for external links", () => {
    expect(markdownLinkCandidates('docs/x.md', '[a](./a.ts#L3) ![i](img.png) [b](../../etc/passwd) [c](https://ok.io) [d](javascript:x) [e](./a.ts)')).toEqual(['docs/a.ts', 'docs/img.png']);
  });

  it('builds the in-app viewer search, never an absolute path', () => {
    expect(viewerSearch({ path: 'src/a.ts', line: 12 }, 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3')).toEqual({ path: 'src/a.ts', line: 12, session: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3' });
    expect(viewerSearch({ path: 'src/a.ts' }, undefined)).toEqual({ path: 'src/a.ts' });
  });
});
