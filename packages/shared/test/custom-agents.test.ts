/** Shared custom agent helpers (epic 21, story 21.3): Test's plain lines and the joined command line. */
import { describe, expect, it } from 'vitest';
import { customAgentTestLines, joinCommandLine } from '../src/index.js';

const NONE = { resume: false, load: false, image: false, audio: false, embeddedContext: false };

describe('customAgentTestLines', () => {
  it('names the agent, or says it gave no name', () => {
    expect(customAgentTestLines({ ...NONE, name: 'Goose', version: '1.2' })[0]).toBe('It started and says it is Goose 1.2.');
    expect(customAgentTestLines({ ...NONE, name: '  ' })[0]).toBe("It started. It didn't say its name.");
    expect(customAgentTestLines(NONE)[0]).toBe("It started. It didn't say its name.");
  });

  it('prefers resume over load, and lists what messages can carry', () => {
    expect(customAgentTestLines({ ...NONE, resume: true, load: true })[1]).toBe('It can pick a chat up where it left off.');
    expect(customAgentTestLines({ ...NONE, load: true })[1]).toBe('It can reopen a chat by replaying it.');
    expect(customAgentTestLines({ ...NONE, image: true, audio: true, embeddedContext: true })[2]).toBe('Messages to it can include images and audio and file contents.');
    expect(customAgentTestLines(NONE)[2]).toBe('Messages to it are text only.');
  });

  it('never uses a dash as punctuation (Voice and Tone)', () => {
    for (const line of customAgentTestLines({ ...NONE, name: 'x', resume: true, image: true })) expect(line).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('joinCommandLine', () => {
  it('stores the program alone, or with its arguments', () => {
    expect(joinCommandLine(' goose ', '')).toBe('goose');
    expect(joinCommandLine('goose', ' acp --verbose ')).toBe('goose acp --verbose');
  });

  it('quotes a program with a space and escapes backslashes and quotes inside the quotes', () => {
    expect(joinCommandLine('/Applications/My Agent/bin/agent', 'acp')).toBe('"/Applications/My Agent/bin/agent" acp');
    expect(joinCommandLine('C:\\Program Files\\Agent\\agent.exe', '')).toBe('"C:\\\\Program Files\\\\Agent\\\\agent.exe"');
    expect(joinCommandLine('C:\\tools\\agent.exe', '')).toBe('C:\\tools\\agent.exe');
  });
});
