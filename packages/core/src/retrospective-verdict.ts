/**
 * An epic's retrospective as the board shows it (epic 7, story 7.4): only the
 * `verdict` and `date` of the file's frontmatter, never the prose (AD-10,
 * E7-R4). The file is the skill's (`bmad-retrospective` writes it); a missing
 * or unreadable verdict is no verdict plus the one plain notice line, never a
 * guess. No script runs and nothing is written.
 */
import { EpicRetrospective, RETROSPECTIVE_UNREADABLE_TEXT, RetrospectiveVerdict } from '@ogden-agents/shared';

/** The frontmatter's lines, or `undefined` when the text does not open with a `---` block that closes. */
function frontmatterLines(text: string): string[] | undefined {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return undefined;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  return end === -1 ? undefined : lines.slice(1, end);
}

/** A scalar as written: trimmed, one pair of matching quotes removed, a trailing ` #` comment dropped from an unquoted value. */
function scalar(raw: string): string {
  const value = raw.trim();
  const quoted = /^(['"])(.*)\1$/.exec(value);
  if (quoted !== null) return quoted[2]!;
  return value.replace(/\s+#.*$/, '').trim();
}

/** The retrospective at `path` (repo-relative) whose file text is `content`. */
export function readRetrospectiveFrontmatter(path: string, content: string): EpicRetrospective {
  const fields = new Map<string, string>();
  for (const line of frontmatterLines(content) ?? []) {
    const match = /^(verdict|date):[ \t]*(.*)$/.exec(line);
    // The first of each key counts: a later duplicate is the file's own mistake.
    if (match !== null && !fields.has(match[1]!)) fields.set(match[1]!, scalar(match[2]!));
  }
  const verdict = RetrospectiveVerdict.safeParse(fields.get('verdict'));
  const date = EpicRetrospective.shape.date.safeParse(fields.get('date') === '' ? undefined : (fields.get('date') ?? null));
  return EpicRetrospective.parse({
    path,
    verdict: verdict.success ? verdict.data : null,
    date: date.success ? date.data : null,
    problem: verdict.success ? null : RETROSPECTIVE_UNREADABLE_TEXT,
  });
}
