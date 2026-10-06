/**
 * The README's Download section (story 13.11, E13-R9): one file per computer, the unsigned-app steps for
 * macOS and Windows, the requirements, the checksum file, and the anchor the release notes link to.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readme = readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8');
const section = /^## Download\n([\s\S]*?)^## /m.exec(readme)?.[1] ?? '';

describe('README Download section', () => {
  it('exists as the section the release notes link to', () => {
    expect(section.length).toBeGreaterThan(200);
  });

  it('names a file for each computer and the checksum file', () => {
    for (const file of ['_universal.dmg', '_x64-setup.exe', '_arm64-setup.exe', '_amd64.AppImage', '_aarch64.AppImage', 'SHA256SUMS-desktop.txt']) expect(section).toContain(file);
  });

  it('gives the steps for opening an unsigned app on each OS, and the requirements', () => {
    for (const phrase of ['Privacy & Security', 'Open Anyway', 'More info', 'Run anyway', 'WebView2', '13.5', 'chmod +x', 'FUSE', 'GDK_BACKEND=x11', 'Secret Service']) expect(section).toContain(phrase);
  });

  it('says nothing about a terminal to run, and has no dashes in its sentences', () => {
    expect(section).not.toMatch(/\bnpx\b.*\bin a terminal/i);
    expect(section.replaceAll(/`[^`]*`/g, '')).not.toMatch(/[–—]/);
  });
});
