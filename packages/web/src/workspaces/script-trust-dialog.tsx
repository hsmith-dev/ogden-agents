import { SCRIPT_TRUST_ALLOW, SCRIPT_TRUST_CANCEL, SCRIPT_TRUST_TEXT, SCRIPT_TRUST_TITLE } from '@ogden-agents/shared';
import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent } from '@/ui/alert-dialog';

/**
 * The confirm dialog before turning on a BMad Method piece that runs the
 * project's own scripts in a project not yet trusted (story 4.2): Workspace
 * settings opens it from a piece's switch or the main switch. **Allow**
 * calls `onAllow` (which trusts the project, then saves the pieces);
 * **Cancel**, Esc or a click outside closes it and changes nothing. While
 * `busy` Allow does nothing; `error` says why the last Allow failed.
 */
export function ScriptTrustDialog({
  open,
  busy,
  error,
  onAllow,
  onCancel,
}: {
  open: boolean;
  busy: boolean;
  error: string | undefined;
  onAllow: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <AlertDialogContent title={SCRIPT_TRUST_TITLE} description={SCRIPT_TRUST_TEXT} error={error} data-testid="script-trust-dialog">
        <AlertDialogCancel data-testid="script-trust-cancel">{SCRIPT_TRUST_CANCEL}</AlertDialogCancel>
        <AlertDialogConfirm data-testid="script-trust-confirm" aria-disabled={busy} onClick={() => (busy ? undefined : onAllow())}>
          {SCRIPT_TRUST_ALLOW}
        </AlertDialogConfirm>
      </AlertDialogContent>
    </AlertDialog>
  );
}
