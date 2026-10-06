/**
 * The text rules every string of the orchestration contracts shares (epic 15): a line or a block of clean text, bounded, with no control,
 * format, separator, private or unassigned character. Internal to the shared package: not exported from its index.
 */
import { z } from 'zod';

/** Control characters other than tab and line feed, and the invisible and direction controls that disguise text. */
const BAD_TEXT_CHARS = /(?![\t\n])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}]/u;
/** The same, plus tab and line feed: a single line. */
const BAD_LINE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}]/u;
/** Whether `text` is clean data: no control, format (tag characters, direction marks, zero width), separator, private or unassigned characters, lone surrogates included. */
const wellFormed = (text: string, pattern: RegExp): boolean => !pattern.test(text);
export const BAD_TEXT = 'bad_text';

export const line = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((text) => wellFormed(text, BAD_LINE_CHARS), BAD_TEXT)
    .refine((text) => text.trim() !== '', BAD_TEXT);
export const block = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((text) => wellFormed(text, BAD_TEXT_CHARS), BAD_TEXT)
    .refine((text) => text.trim() !== '', BAD_TEXT);
