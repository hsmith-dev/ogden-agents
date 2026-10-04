/**
 * Plain-Node scripts can't import the TypeScript API_ROUTES constant, so they
 * spell the paths out. This test fails if any of those literals drifts from
 * the shared routes (story 1.11 review).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ROUTES } from '../packages/shared/src/api.ts';

const ROOT = join(import.meta.dirname, '..');
const FILES = ['scripts/smoke-installed.mjs', 'tests/fixtures/fake-server.mjs'];
const known = new Set<string>(Object.values(API_ROUTES));

describe('API route literals in plain-Node scripts', () => {
  for (const file of FILES) {
    it(`${file} uses only paths from API_ROUTES`, () => {
      const source = readFileSync(join(ROOT, file), 'utf8');
      const literals = [...source.matchAll(/(\/api\/[A-Za-z0-9/_-]+)(?=['"`\s,)])/g)].map((m) => m[1]!);
      expect(literals.length).toBeGreaterThan(0);
      expect(literals.filter((path) => !known.has(path))).toEqual([]);
    });
  }
});
