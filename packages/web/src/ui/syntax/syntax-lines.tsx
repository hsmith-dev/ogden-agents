import { useCallback, useMemo, type ReactNode } from 'react';
import { languageFor, TOKEN_CLASSES, useHighlightedLines, type Segment } from './highlight';

/** One line's segments, each coloured by its token (none: foreground). */
export function SyntaxSegments({ segments }: { segments: readonly Segment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.token === undefined ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <span key={index} className={TOKEN_CLASSES[segment.token]} data-token={segment.token}>
            {segment.text}
          </span>
        ),
      )}
    </>
  );
}

/**
 * A `renderLine` for a file's `lines` by its `path`'s language (story 8.7 on
 * 8.3's highlighter): the same lazy Lezer colour as a diff, plain at once and
 * coloured once the grammar has loaded; `undefined` for a language with no
 * grammar, so the viewer shows the text exactly as sent.
 */
export function useSyntaxRenderLine(path: string, lines: readonly string[]): ((line: string, index: number) => ReactNode) | undefined {
  const language = useMemo(() => languageFor(path), [path]);
  const segments = useHighlightedLines(lines, language);
  const render = useCallback(
    (line: string, index: number): ReactNode => {
      const shown = segments[index];
      // Segments are for these lines; a mismatch (never expected) shows the text as sent.
      return shown === undefined || shown.map((segment) => segment.text).join('') !== line ? line : <SyntaxSegments segments={shown} />;
    },
    [segments],
  );
  return language === undefined ? undefined : render;
}
