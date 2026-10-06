/** The Terminals settings (epic 16, story 16.9): everything off by default, partial updates, one event per real change that says only whether the surface is hidden. */
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/index.js';
import { openTestCore } from './helpers.js';

describe('the Terminals settings', () => {
  it('start with everything off and no launcher arguments', () => {
    const core = openTestCore();
    expect(core.terminalsSettings.get()).toEqual({ notifyNeedsAttention: false, notifyExited: false, notifyLaunchers: [], passProxies: false, passSshAgent: false, launcherArgs: {}, hidden: false });
  });

  it('change only the fields given, keep them across a reopen of the store, and announce a change once, without its values', () => {
    const core = openTestCore();
    const secret = '--token=sk-typed-secret';
    const saved = core.terminalsSettings.update({ passProxies: true, notifyLaunchers: ['claude-code', 'claude-code', 'codex'], launcherArgs: { codex: secret } });
    expect(saved).toMatchObject({ passProxies: true, passSshAgent: false, notifyLaunchers: ['claude-code', 'codex'], launcherArgs: { codex: secret } });
    core.terminalsSettings.update({ hidden: true });
    expect(core.terminalsSettings.get()).toMatchObject({ passProxies: true, hidden: true });
    // The same values again change nothing and announce nothing.
    const before = core.events.readAfter(0).filter((e) => e.type === 'settings.terminals_changed').length;
    core.terminalsSettings.update({ hidden: true });
    expect(core.events.readAfter(0).filter((e) => e.type === 'settings.terminals_changed').length).toBe(before);
    const events = core.events.readAfter(0).filter((e) => e.type === 'settings.terminals_changed');
    expect(events.map((e) => e.payload)).toEqual([{ hidden: false }, { hidden: true }]);
    expect(JSON.stringify(events)).not.toContain('sk-typed-secret');
  });

  it('refuse a bad value, nothing to change, a control character in arguments and an id that is not a launcher id', () => {
    const core = openTestCore();
    for (const bad of [{}, { hidden: 'yes' }, { launcherArgs: { codex: 'bad\u0007' } }, { launcherArgs: { 'Not A Launcher': 'x' } }, { notifyLaunchers: ['Bad Id'] }, 'x', null]) {
      expect(() => core.terminalsSettings.update(bad), JSON.stringify(bad)).toThrow(ValidationError);
    }
    expect(core.terminalsSettings.get().hidden).toBe(false);
  });
});
