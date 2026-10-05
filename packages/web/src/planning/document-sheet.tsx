import { DOCUMENT_LOADING_TEXT, DOCUMENT_NOT_FOUND_TEXT, DOCUMENT_TRUNCATED_TEXT, documentFileName } from '@ogden-agents/shared';
import { ChatApiError } from '@/api/http';
import { Markdown } from '@/ui/markdown';
import { Notice } from '@/ui/notice';
import { Sheet, SheetContent } from '@/ui/sheet';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { useDocument } from './planning-api';

export interface DocumentSheetProps {
  wsId: string;
  path: string;
  /** Esc or Close. */
  onClose: () => void;
  /** Where focus goes once it has closed (the card's Open button). */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * A written document, read-only, in a side sheet (story 4.7): its file name
 * as the title, its path in mono, then its Markdown rendered as the safe
 * subset (`ui/markdown.tsx`: no HTML, links as text, frontmatter hidden).
 * Loading, 404 ("isn't there any more") and error states; a document cut at
 * the size limit says so above it. Esc closes it. Editing is epic 8's.
 */
export function DocumentSheet({ wsId, path, onClose, onCloseAutoFocus }: DocumentSheetProps) {
  const document = useDocument(wsId, path);
  const data = document.data?.document;
  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        side="right"
        title={documentFileName(path)}
        data-testid="document-sheet"
        data-path={path}
        {...(onCloseAutoFocus === undefined ? {} : { onCloseAutoFocus })}
        className="w-160 [&>h2]:break-words [&>h2]:pt-(--panel-padding) [&>h2]:pr-12 [&>h2]:pl-(--panel-padding)"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-(--panel-padding)" data-testid="document-sheet-body">
          <Text variant="mono-compact" className="break-all" data-testid="document-sheet-path">
            {path}
          </Text>
          {data === undefined ? (
            document.error !== null ? (
              <Text variant="caption" role="alert" data-testid="document-sheet-error">
                {document.error instanceof ChatApiError && document.error.status === 404 ? DOCUMENT_NOT_FOUND_TEXT : document.error.message}
              </Text>
            ) : (
              <div className="flex flex-col gap-2" data-testid="document-sheet-loading">
                <Skeleton />
                <Skeleton />
                <span role="status" className="sr-only">
                  {DOCUMENT_LOADING_TEXT}
                </span>
              </div>
            )
          ) : (
            <>
              {/* A failed refetch (the file deleted, say) keeps the text it had, with a quiet line above. */}
              {document.error === null ? null : (
                <Notice data-testid="document-sheet-refetch-error">
                  {document.error instanceof ChatApiError && document.error.status === 404 ? DOCUMENT_NOT_FOUND_TEXT : document.error.message}
                </Notice>
              )}
              {data.truncated ? <Notice data-testid="document-sheet-truncated">{DOCUMENT_TRUNCATED_TEXT}</Notice> : null}
              <Markdown source={data.content} data-testid="document-sheet-content" />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
