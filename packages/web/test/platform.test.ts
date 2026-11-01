import { describe, expect, it } from 'vitest';
import { otherWayShortcutLabel } from '../src/chat/send-mode';
import { isApplePlatform, modifierShortcutLabel } from '../src/ui/platform';

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64)';

describe('the one platform test (epic 26 sweep)', () => {
  it('Apple devices use Cmd; Windows and Linux use Ctrl', () => {
    expect([MAC, IPAD, WINDOWS, LINUX].map((platform) => isApplePlatform(platform))).toEqual([true, true, false, false]);
    expect(modifierShortcutLabel('K', MAC)).toBe('⌘K');
    expect(modifierShortcutLabel('K', WINDOWS)).toBe('Ctrl+K');
  });

  it('every label goes through it: send the other way too', () => {
    expect(otherWayShortcutLabel(MAC)).toBe('⌘ Enter');
    expect(otherWayShortcutLabel(LINUX)).toBe('Ctrl+Enter');
  });
});
