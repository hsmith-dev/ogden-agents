import {
  BMAD_SETUP_FAILED,
  BMAD_UPGRADE_CANCEL,
  BMAD_UPGRADE_CONFIRM,
  BMAD_UPGRADE_CONFIRM_TEXT,
  BMAD_UPGRADE_CONFIRM_TITLE,
  BMAD_UPGRADE_DONE_TEXT,
  BMAD_UPGRADE_LABEL,
} from '@ogden-agents/shared';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from '@/ui/alert-dialog';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { BmadSetupView, upgradeComplete, useBmadSetup } from './bmad-setup-panel';

/**
 * The reduced-mode notice (entry 4.11; DESIGN.md Reduced-mode notice,
 * EXPERIENCE.md, AD-14): inline where the missing feature would be, one
 * quiet `info` panel with the info glyph holding one sentence per missing
 * capability, and one outline **Upgrade this project**. Never a toast, never
 * red. Upgrade asks once in an accessible confirmation (focus starts on
 * Cancel; Esc cancels; focus returns to Upgrade), then runs the setup in its
 * upgrade mode through the server with the same progress list as Set up;
 * when it completes the setup, catalog and tickets are fetched again
 * (`useSetupInvalidation`), so the notice goes once the capabilities are
 * there. A failure says why in plain words, and the notice's Upgrade is the
 * retry. The end (done or failed) is announced in a persistent polite live
 * region. Every text comes from `@ogden-agents/shared`.
 */

/**
 * Upgrade this project's confirmation: what it writes and what it keeps,
 * Cancel or Upgrade. It has no trigger of its own, so closing it (Esc,
 * Cancel, Upgrade) gives focus back to `returnFocus` (the Upgrade button).
 */
export function UpgradeConfirmDialog({
  open,
  onConfirm,
  onCancel,
  returnFocus,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  returnFocus?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent
        title={BMAD_UPGRADE_CONFIRM_TITLE}
        description={BMAD_UPGRADE_CONFIRM_TEXT}
        data-testid="upgrade-confirm-dialog"
        onCloseAutoFocus={(event) => {
          const button = returnFocus?.current;
          if (button === null || button === undefined || !button.isConnected) return;
          event.preventDefault();
          button.focus();
        }}
      >
        <AlertDialogCancel data-testid="upgrade-confirm-cancel">{BMAD_UPGRADE_CANCEL}</AlertDialogCancel>
        {/* Not destructive (it adds and repairs), so a primary button, never red; a plain button, so focus starts on Cancel. */}
        <Button data-testid="upgrade-confirm" onClick={onConfirm}>
          {BMAD_UPGRADE_CONFIRM}
        </Button>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The outline Upgrade this project button: `onUpgrade` asks for the confirmation. Waits (`aria-disabled`) while `busy`. */
export function UpgradeButton({ busy, onUpgrade, buttonRef }: { busy: boolean; onUpgrade: () => void; buttonRef?: RefObject<HTMLButtonElement | null> }) {
  return (
    <Button ref={buttonRef} variant="outline" aria-disabled={busy} onClick={busy ? undefined : onUpgrade} data-testid="reduced-mode-upgrade">
      {BMAD_UPGRADE_LABEL}
    </Button>
  );
}

/** One notice holding each sentence in `texts` and the one Upgrade button; nothing when `texts` is empty. */
export function ReducedModeNoticeView({
  texts,
  busy,
  onUpgrade,
  buttonRef,
}: {
  texts: readonly string[];
  busy: boolean;
  onUpgrade: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  if (texts.length === 0) return null;
  return (
    <Notice infoGlyph data-testid="reduced-mode-notice" action={<UpgradeButton busy={busy} onUpgrade={onUpgrade} buttonRef={buttonRef} />}>
      <span className="flex flex-col gap-1">
        {texts.map((text) => (
          <span key={text} data-testid="reduced-mode-text">
            {text}
          </span>
        ))}
      </span>
    </Notice>
  );
}

/**
 * The notice for one workspace (a project with `_bmad/`, so any run here is
 * an upgrade), with its own Upgrade: confirmation, then the progress of any
 * running setup, its failure, or the done line below the notice. Keep it
 * mounted where it is (with `texts` empty once nothing is missing) so a run
 * it showed keeps its done line; when the notice goes and focus fell to the
 * page, focus moves to the done line. Nothing renders when there is nothing
 * to say, but the live region stays.
 */
export function ReducedModeNotice({ wsId, texts, className }: { wsId: string; texts: readonly string[]; className?: string }) {
  const setup = useBmadSetup(wsId);
  const [confirming, setConfirming] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const area = useRef<HTMLDivElement | null>(null);
  const busy = setup.phase === 'running' || setup.phase === 'starting';
  const progress = setup.phase !== 'idle' || setup.reason !== undefined;
  const done = setup.phase === 'done' && upgradeComplete(setup.completed);
  const announcement = done ? BMAD_UPGRADE_DONE_TEXT : setup.phase === 'failed' ? (setup.reason ?? BMAD_SETUP_FAILED) : '';

  // The notice (and its focused Upgrade button) went: focus the done line instead of leaving it on the page.
  useEffect(() => {
    if (!done) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    area.current?.querySelector<HTMLElement>('[data-testid="bmad-upgrade-done"]')?.focus();
  }, [done, texts.length]);

  return (
    <>
      <span role="status" aria-live="polite" className="sr-only" data-testid="reduced-mode-announcement">
        {announcement}
      </span>
      {texts.length === 0 && !progress ? null : (
        <div ref={area} className={className ?? 'flex max-w-(--space-chat-column) flex-col gap-3'} data-testid="reduced-mode-area">
          <ReducedModeNoticeView texts={texts} busy={busy} onUpgrade={() => setConfirming(true)} buttonRef={button} />
          {progress ? (
            <BmadSetupView mode="upgrade" phase={setup.phase} steps={setup.steps} reason={setup.reason} completed={setup.completed} onSetUp={() => setConfirming(true)} />
          ) : null}
        </div>
      )}
      <UpgradeConfirmDialog
        open={confirming}
        returnFocus={button}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          setup.start(true);
        }}
      />
    </>
  );
}
