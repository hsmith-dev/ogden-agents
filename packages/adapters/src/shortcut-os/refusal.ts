/**
 * A refusal the user reads as it is (story 2.4): the app shortcut can't be
 * added or removed, in plain words that name no path. Any other failure
 * (a disk error, say) is wrapped in one by the adapter, with the original
 * kept as `cause` for the log's error code.
 */
export class ShortcutRefusal extends Error {
  override name = 'ShortcutRefusal';
}
