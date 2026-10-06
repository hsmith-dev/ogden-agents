/**
 * Story 3.9 (3.5 review F5): the terminal's backlog keeps its newest output,
 * starting at a line break where it can, and never inside an escape sequence,
 * so a viewer that reattaches never replays half a colour, a cursor move or
 * a title.
 */
import { describe, expect, it } from 'vitest';
import { trimBacklog } from '../src/chat/terminal.js';
import { TERMINAL_BACKLOG_CHARS } from '../src/index.js';

const ESC = '\x1b';

/** `prefix + sequence + rest`, with the cut `into` characters into `sequence`. */
const cutInside = (sequence: string, into: number, rest: string) => {
  const prefix = 'old output\n';
  const text = `${prefix}${sequence}${rest}`;
  return { text, max: text.length - prefix.length - into };
};

describe('trimBacklog (story 3.9)', () => {
  it('keeps short output as it is, and the default limit is TERMINAL_BACKLOG_CHARS', () => {
    expect(trimBacklog('hello\n')).toBe('hello\n');
    const long = `old\n${'x'.repeat(TERMINAL_BACKLOG_CHARS)}`;
    expect(trimBacklog(long)).toHaveLength(TERMINAL_BACKLOG_CHARS);
  });

  it('a cut outside any sequence starts at the next line break, as before; with none, at the cut', () => {
    expect(trimBacklog('aaaa\nbbbb\ncccc', 12)).toBe('bbbb\ncccc');
    expect(trimBacklog('aaaaaaaaaa', 4)).toBe('aaaa');
    // A sequence that ended before the cut doesn't move it.
    expect(trimBacklog(`${ESC}[31mred\nmore\nlast`, 9)).toBe('last');
  });

  it('a cut just after an ESC that a line feed follows keeps that line feed as the break (3.9 review F2)', () => {
    // `old` + ESC + LF + `next` + LF + `last`: cutting right after the ESC starts at the line after the LF, not the one after.
    const text = `old${ESC}\nnext\nlast`;
    expect(trimBacklog(text, text.length - 4)).toBe('next\nlast');
  });

  it('with no line break after the cut, never starts on the second half of an emoji (3.9 review F3)', () => {
    const text = 'abc\u{1F600}def';
    // Cut inside the emoji (between its two UTF-16 halves): the replay starts after it.
    expect(trimBacklog(text, 'def'.length + 1)).toBe('def');
    // A cut before it keeps it whole.
    expect(trimBacklog(text, 'def'.length + 2)).toBe('\u{1F600}def');
  });

  it('a cut inside a CSI (a 256-colour SGR) starts after it, at the next line break', () => {
    const { text, max } = cutInside(`${ESC}[38;5;196m`, 4, 'red text\nnext line');
    expect(trimBacklog(text, max)).toBe('next line');
  });

  it('a cut inside a CSI with no line break after it starts right after the sequence', () => {
    const { text, max } = cutInside(`${ESC}[2J`, 2, 'screen');
    expect(trimBacklog(text, max)).toBe('screen');
  });

  it('a cut inside an OSC ended by BEL starts after the BEL', () => {
    const { text, max } = cutInside(`${ESC}]0;window title\x07`, 6, 'prompt$ ');
    expect(trimBacklog(text, max)).toBe('prompt$ ');
  });

  it('a cut inside an OSC ended by ST (ESC \\), even between its two characters, starts after the ST', () => {
    const sequence = `${ESC}]8;;https://example.com${ESC}\\`;
    const inPayload = cutInside(sequence, 5, 'link');
    expect(trimBacklog(inPayload.text, inPayload.max)).toBe('link');
    const inTerminator = cutInside(sequence, sequence.length - 1, 'link');
    expect(trimBacklog(inTerminator.text, inTerminator.max)).toBe('link');
  });

  it('a cut inside a DCS string (up to ST) starts after it (review F1)', () => {
    const { text, max } = cutInside(`${ESC}P1$r0m${ESC}\\`, 3, 'after dcs');
    expect(trimBacklog(text, max)).toBe('after dcs');
  });

  it('a cut inside an APC string (up to BEL) starts after it (review F1)', () => {
    const { text, max } = cutInside(`${ESC}_Gi=1;payload\x07`, 4, 'after apc');
    expect(trimBacklog(text, max)).toBe('after apc');
  });

  it('a cut inside a two-byte ESC sequence (or one with an intermediate byte) starts after it', () => {
    const save = cutInside(`${ESC}7`, 1, 'after');
    expect(trimBacklog(save.text, save.max)).toBe('after');
    const charset = cutInside(`${ESC}(B`, 2, 'after');
    expect(trimBacklog(charset.text, charset.max)).toBe('after');
  });

  it('a sequence with no terminator in reach falls back to the line-break cut', () => {
    const text = `old\n${ESC}]0;title that never ends\nthen a line`;
    expect(trimBacklog(text, text.length - 6)).toBe('then a line');
    expect(trimBacklog(`${ESC}[38;5;1`, 3)).toBe('5;1');
  });
});
