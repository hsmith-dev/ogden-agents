import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Notice } from '@/ui/notice';
import { shortcutLocation, useAppShortcut, useAppShortcutActions } from './app-shortcut-api';

/** The one-line Dock hint (macOS): no Dock preference is ever edited (story 2.4). */
export const DOCK_HINT = 'To keep it in the Dock, drag Ogden Agents from Applications to the Dock.';

/**
 * The app shortcut setting in Appearance (E2-R10, story 2.4): add or remove
 * the Ogden Agents shortcut, naming where it goes on this computer. Hidden
 * where a shortcut can't be added; a refusal shows in a blocked notice.
 */
export function AppShortcutSetting() {
  const { data } = useAppShortcut();
  const { add, remove } = useAppShortcutActions();
  if (data === undefined || !data.supported) return null;
  const where = shortcutLocation(data.platform);
  const failed = add.error ?? remove.error;
  const busy = add.isPending || remove.isPending;
  return (
    <>
      <Field
        id="app-shortcut"
        control="group"
        layout="inline"
        label="App shortcut"
        description={
          <>
            {data.installed ? `Ogden Agents is in ${where}.` : `Add Ogden Agents to ${where} to open it without a terminal.`}
            {data.platform === 'darwin' ? <> {DOCK_HINT}</> : null}
          </>
        }
      >
        {data.installed ? (
          <Button variant="outline" data-testid="app-shortcut-action" aria-describedby="app-shortcut-description" disabled={busy} onClick={() => remove.mutate()}>
            Remove
          </Button>
        ) : (
          <Button variant="outline" data-testid="app-shortcut-action" aria-describedby="app-shortcut-description" disabled={busy} onClick={() => add.mutate()}>
            Add
          </Button>
        )}
      </Field>
      {failed === null ? null : (
        <Notice variant="blocked" role="alert" data-testid="app-shortcut-error">
          {failed.message}
        </Notice>
      )}
    </>
  );
}
