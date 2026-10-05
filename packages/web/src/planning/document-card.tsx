import { DOCUMENT_CARD_CAPTION, DOCUMENT_NEXT_FAILED, DOCUMENT_OPEN_LABEL, documentCardLabel, documentFileName, type CatalogNext, type Session } from '@ogden-agents/shared';
import { ArrowRight, FileText } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { Text } from '@/ui/typography';
import { DocumentSheet } from './document-sheet';
import { startPlanningSession } from './planning-api';

export interface DocumentCardProps {
  wsId: string;
  /** The document, relative to the repo. */
  path: string;
  /** The next suggested step, when the catalog names one. */
  next: CatalogNext | null;
  /** The next step's planning session started: the caller opens it. */
  onStarted: (session: Session) => void;
}

/**
 * A document card (story 4.7, E4-R6; EXPERIENCE.md Planning session): where
 * a planning session wrote a BMad Method document, its file name with its
 * path in mono, Open (a read-only side sheet) and the next suggested step as
 * the one ink button, which starts a planning session on the next skill with
 * the document's path as its idea. A failure to start says why inline.
 */
export function DocumentCard({ wsId, path, next, onStarted }: DocumentCardProps) {
  const name = documentFileName(path);
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const openButton = useRef<HTMLButtonElement>(null);

  const startNext = () => {
    if (next === null || starting) return;
    setStarting(true);
    setError(undefined);
    startPlanningSession(wsId, next.skill, path, undefined, DOCUMENT_NEXT_FAILED)
      .then((session) => {
        setStarting(false);
        onStarted(session);
      })
      .catch((failure: unknown) => {
        setStarting(false);
        setError(failure instanceof Error && failure.message !== '' ? failure.message : `${DOCUMENT_NEXT_FAILED}. Try again.`);
      });
  };

  return (
    <section
      aria-label={documentCardLabel(name)}
      data-testid="document-card"
      data-path={path}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-(--panel-padding) text-card-foreground"
    >
      <div className="flex min-w-0 items-start gap-2">
        <FileText aria-hidden className="mt-0.5 size-(--icon) shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <Text variant="caption">{DOCUMENT_CARD_CAPTION}</Text>
          <Text variant="label" className="break-words" data-testid="document-card-name">
            {name}
          </Text>
          <Text variant="mono-compact" className="break-all" data-testid="document-card-path">
            {path}
          </Text>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {next === null ? null : (
          <Button onClick={startNext} aria-disabled={starting || undefined} aria-busy={starting || undefined} data-testid="document-card-next" data-skill={next.skill}>
            {next.label}
            <ArrowRight aria-hidden />
          </Button>
        )}
        <Button ref={openButton} variant="outline" onClick={() => setOpen(true)} data-testid="document-card-open">
          {DOCUMENT_OPEN_LABEL}
        </Button>
      </div>
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="document-card-error">
          {error}
        </Text>
      )}
      {open ? (
        <DocumentSheet
          wsId={wsId}
          path={path}
          onClose={() => setOpen(false)}
          onCloseAutoFocus={(event) => {
            // Focus goes back to Open.
            event.preventDefault();
            openButton.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}
