import type { PaneLauncherStatus } from '@ogden-agents/shared';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { Text } from '@/ui/typography';

/** What the list says under a program Ogden Agents did not find. */
export const INSTALL_YOURSELF = 'Install it yourself, then press Detect.';

/** The longest text of an argument field (the server's own limit). */
const MAX_ARGS_LENGTH = 500;

const STATE_WORDS = { found: 'Found', not_found: 'Not found', failed: 'Did not answer' } as const;

/**
 * The programs a terminal can run (epic 16, story 16.5; E16-R5, R9): each
 * agent's own CLI, found on this computer by looking, never installed by
 * Ogden Agents. A found program starts in a new terminal with only the
 * arguments typed in its own field; a missing one shows its vendor's install
 * page and "Install it yourself, then press Detect". The user signs in inside
 * the program, so Ogden Agents sees no sign in. Copilot says it is for
 * interactive use only.
 */
export function LauncherList({
  statuses,
  detecting,
  onDetect,
  onStart,
  disabled,
  failed,
  defaults = {},
}: {
  statuses: readonly PaneLauncherStatus[];
  detecting: boolean;
  onDetect: () => void;
  onStart: (launcherId: string, args: string) => void;
  disabled: boolean;
  failed: boolean;
  /** Each program's own arguments from Settings, Terminals: what its field starts with. */
  defaults?: Readonly<Record<string, string>>;
}) {
  const [args, setArgs] = useState<Record<string, string>>({});
  const programs = statuses.filter((status) => status.launcher.kind === 'cli');
  if (programs.length === 0 && !failed) return null;
  return (
    <details className="rounded-lg border border-border p-3" data-testid="launchers" open={failed || undefined}>
      <summary className="cursor-pointer text-label">Start a program in a terminal</summary>
      <div className="mt-3 flex flex-col gap-3">
        <Text variant="caption" className="text-muted-foreground">
          Each program is started the way you would start it yourself. You sign in inside the program; Ogden Agents never sees or keeps that sign in, and never installs anything.
        </Text>
        {failed ? (
          <Text variant="caption" role="status" data-testid="launchers-failed">
            Ogden Agents couldn't look for programs. Press Detect to try again.
          </Text>
        ) : null}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {programs.map(({ launcher, detection }) => (
            <li key={launcher.id} data-testid="launcher" data-launcher={launcher.id} data-state={detection.state} className="flex flex-wrap items-center gap-2">
              <Text variant="label" className="min-w-28">
                {launcher.label}
              </Text>
              <Text variant="caption" data-testid="launcher-state">
                {STATE_WORDS[detection.state]}
                {detection.version === undefined ? '' : `, ${detection.version}`}
              </Text>
              {detection.state === 'found' ? (
                <>
                  <input
                    aria-label={`Arguments for ${launcher.label}`}
                    data-testid="launcher-args"
                    placeholder="Arguments (optional)"
                    maxLength={MAX_ARGS_LENGTH}
                    value={args[launcher.id] ?? defaults[launcher.id] ?? ''}
                    onChange={(event) => setArgs((current) => ({ ...current, [launcher.id]: event.target.value }))}
                    className="h-(--control-height) min-w-40 flex-1 rounded-md border border-border bg-transparent px-2 text-label"
                  />
                  <Button size="sm" aria-label={`Start ${launcher.label}`} disabled={disabled || detecting} onClick={() => onStart(launcher.id, args[launcher.id] ?? defaults[launcher.id] ?? '')} data-testid="launcher-start">
                    Start
                  </Button>
                </>
              ) : (
                <Text variant="caption" data-testid="launcher-missing">
                  {detection.state === 'failed' ? `It is installed but did not answer. Try it in a terminal yourself, then press Detect. ` : `${INSTALL_YOURSELF} `}
                  {launcher.installUrl === undefined || detection.state === 'failed' ? null : (
                    <a href={launcher.installUrl} target="_blank" rel="noopener noreferrer" className="underline" data-testid="launcher-install-link">
                      Install page
                    </a>
                  )}
                </Text>
              )}
              {launcher.termsNote === 'interactive_only' ? (
                <Text variant="caption" data-testid="launcher-interactive">
                  For your own interactive use only. Ogden Agents never types into it for you.
                </Text>
              ) : null}
            </li>
          ))}
        </ul>
        <div role="status" aria-live="polite" className="sr-only" data-testid="launchers-live">
          {detecting ? 'Looking for programs' : ''}
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={onDetect} disabled={detecting} data-testid="launchers-detect">
            Detect
          </Button>
        </div>
      </div>
    </details>
  );
}
