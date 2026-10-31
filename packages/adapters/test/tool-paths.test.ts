/** Every path an ACP tool call names (`toolCallPaths`): a list-valued path field names each of its paths. */
import { describe, expect, it } from 'vitest';
import { toolCallPaths } from '../src/acp-base/tool-paths.js';

describe('toolCallPaths', () => {
  it('names each non-empty string of a path field that holds a list, so a path outside the project is never skipped', () => {
    const toolCall = { toolCallId: 't1', rawInput: { paths: ['src/a.ts', '', 42, '/etc/x'], path: 'src' } };
    expect(toolCallPaths(toolCall, '/repo', { pathFields: ['path', 'paths'], patternFields: [] }).sort()).toEqual(['/etc/x', 'src', 'src/a.ts']);
  });
});
