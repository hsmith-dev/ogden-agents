import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOnboarding, ONBOARDING_FILE, ValidationError } from '../src/index.js';
import { tempDir } from './helpers.js';

function setup(projects = false) {
  const dataDir = tempDir();
  const codes: string[] = [];
  const onboarding = createOnboarding({ dataDir, hasProjects: () => projects, onError: (code) => codes.push(code) });
  return { dataDir, file: join(dataDir, ONBOARDING_FILE), onboarding, codes };
}

describe('onboarding', () => {
  it("keeps Welcome's first-project answer once given, through a later save without it (story 10.2)", () => {
    const { onboarding, file } = setup();
    expect(onboarding.set({ welcomeCompleted: false, firstProjectChoice: 'bmad_method' })).toEqual({ welcomeCompleted: false, firstProjectChoice: 'bmad_method' });
    expect(onboarding.set({ welcomeCompleted: true })).toEqual({ welcomeCompleted: true, firstProjectChoice: 'bmad_method' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ welcomeCompleted: true, firstProjectChoice: 'bmad_method' });
    expect(onboarding.get()).toEqual({ welcomeCompleted: true, firstProjectChoice: 'bmad_method' });
  });

  it('reads a missing record as not completed in a data folder with no projects, and writes nothing', () => {
    const { onboarding, file, codes } = setup();
    expect(onboarding.get()).toEqual({ welcomeCompleted: false });
    expect(existsSync(file)).toBe(false);
    expect(codes).toEqual([]);
  });

  it('reads a missing record as completed when the data folder already has projects, and keeps that answer', () => {
    const { onboarding, file } = setup(true);
    expect(onboarding.get()).toEqual({ welcomeCompleted: true });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ welcomeCompleted: true });
  });

  it('reads a corrupt record as missing and reports only a code', () => {
    const { onboarding, file, codes } = setup();
    writeFileSync(file, '{nope');
    expect(onboarding.get()).toEqual({ welcomeCompleted: false });
    writeFileSync(file, JSON.stringify({ welcomeCompleted: 'yes' }));
    expect(onboarding.get()).toEqual({ welcomeCompleted: false });
    expect(codes).toEqual(['corrupt']);
  });

  it('reports a corrupt record once while it stays corrupt, leaves it as it is, and again once it is corrupt after being usable (9.5 F7)', () => {
    const { onboarding, file, codes } = setup();
    writeFileSync(file, '{nope');
    for (let i = 0; i < 4; i++) expect(onboarding.get()).toEqual({ welcomeCompleted: false });
    expect(codes).toEqual(['corrupt']);
    expect(readFileSync(file, 'utf8')).toBe('{nope');
    onboarding.set({ welcomeCompleted: false });
    expect(onboarding.get()).toEqual({ welcomeCompleted: false });
    writeFileSync(file, 'garbage');
    expect(onboarding.get()).toEqual({ welcomeCompleted: false });
    expect(onboarding.get()).toEqual({ welcomeCompleted: false });
    expect(codes).toEqual(['corrupt', 'corrupt']);
  });

  it('a corrupt record with existing projects counts as done', () => {
    const { onboarding, file } = setup(true);
    writeFileSync(file, 'garbage');
    expect(onboarding.get()).toEqual({ welcomeCompleted: true });
  });

  it('keeps what is set, readable only by the user, with no temp file left behind', () => {
    const { onboarding, file, dataDir } = setup();
    expect(onboarding.set({ welcomeCompleted: true })).toEqual({ welcomeCompleted: true });
    expect(onboarding.get()).toEqual({ welcomeCompleted: true });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dataDir)).toEqual([ONBOARDING_FILE]);
    // A second instance on the same folder (a restart) reads the same answer.
    expect(createOnboarding({ dataDir, hasProjects: () => false }).get()).toEqual({ welcomeCompleted: true });
    expect(onboarding.set({ welcomeCompleted: false })).toEqual({ welcomeCompleted: false });
    expect(onboarding.get()).toEqual({ welcomeCompleted: false });
  });

  it('a kept not-completed record wins over existing projects', () => {
    const { onboarding, dataDir } = setup();
    onboarding.set({ welcomeCompleted: false });
    expect(createOnboarding({ dataDir, hasProjects: () => true }).get()).toEqual({ welcomeCompleted: false });
  });

  it('refuses a wrong shape and leaves the stored state unchanged', () => {
    const { onboarding, file } = setup();
    onboarding.set({ welcomeCompleted: true });
    expect(() => onboarding.set({ welcomeCompleted: 'no' })).toThrow(ValidationError);
    expect(() => onboarding.set(null)).toThrow(ValidationError);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ welcomeCompleted: true });
  });
});
