import { MAX_PANES_PER_INSTALL, MAX_PANES_PER_PROJECT } from '@ogden-agents/shared';
import { useState } from 'react';
import { useAppearance } from '@/appearance/appearance-provider';
import { DEVELOPER_MODE_NEEDED } from '@/terminal/terminals-view';
import { useLaunchers } from '@/terminal/panes-api';
import { useSaveTerminalsSettings, useTerminalsSettings } from '@/terminal/terminals-settings';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { CheckboxOption } from '@/ui/checkbox';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Notice } from '@/ui/notice';
import { PageBody, PageSection } from '@/ui/page';
import { Switch } from '@/ui/switch';
import { Text } from '@/ui/typography';

/** The longest text of an argument field (the server's own limit). */
const MAX_ARGS_LENGTH = 500;

/**
 * `/settings/terminals` (epic 16, story 16.9; E16-R3, R7): Developer mode's
 * Terminals settings. The surface can be hidden; notifications are opt in per
 * program (and per terminal, on the terminal); what the pane's environment adds
 * is opt in (a proxy address can hold a password, the SSH agent lets a terminal
 * use your keys); each program's own arguments are the ones you type here.
 * Developer mode only: without it the page says so and the server refuses.
 */
export function TerminalsSettingsPage() {
  const { appearance } = useAppearance();
  const settings = useTerminalsSettings(appearance.developerMode);
  const save = useSaveTerminalsSettings();
  const launchers = useLaunchers(appearance.developerMode);
  const [args, setArgs] = useState<Record<string, string>>({});
  const programs = (launchers.list.data?.launchers ?? []).filter((one) => one.launcher.kind === 'cli');
  const current = settings.data;
  return (
    <>
      <WorkspaceHeader title="Terminals" />
      <PageBody data-testid="terminals-settings-page">
        {!appearance.developerMode ? (
          <Notice data-testid="terminals-settings-developer-mode">{DEVELOPER_MODE_NEEDED}</Notice>
        ) : current === undefined ? (
          settings.isError ? <Notice variant="blocked">{settings.error instanceof Error ? settings.error.message : "Ogden Agents couldn't load the Terminals settings."}</Notice> : null
        ) : (
          <PageSection aria-label="Terminals settings">
            <Field id="terminals-hidden" layout="inline" label="Hide Terminals" description="Takes the Terminals tab out of every project. Your terminals and their layouts are kept.">
              <Switch id="terminals-hidden" data-testid="terminals-hidden" checked={current.hidden} aria-describedby="terminals-hidden-description" onCheckedChange={(hidden) => save.mutate({ hidden })} />
            </Field>
            <Field id="terminals-notify" control="group" label="Notify me" description="A sound or a notice, as set in Settings, Notifications, when a terminal seems to need you. Only the project and the terminal's name are shown, never what it printed. You can also turn it on for one terminal, on the terminal.">
              {programs.length === 0 ? (
                <Text variant="caption">Programs show here once they are found. Press Detect on the Terminals page.</Text>
              ) : (
                programs.map(({ launcher }) => (
                  <CheckboxOption
                    key={launcher.id}
                    id={`terminals-notify-${launcher.id}`}
                    data-testid={`terminals-notify-${launcher.id}`}
                    label={launcher.label}
                    checked={current.notifyLaunchers.includes(launcher.id)}
                    onCheckedChange={(on) => save.mutate({ notifyLaunchers: on === true ? [...current.notifyLaunchers, launcher.id] : current.notifyLaunchers.filter((id) => id !== launcher.id) })}
                  />
                ))
              )}
            </Field>
            {programs.map(({ launcher }) => (
              <Field key={launcher.id} id={`terminals-args-${launcher.id}`} label={`${launcher.label} arguments`} description="Filled in when you start it. Ogden Agents adds nothing of its own, and never anything that skips the program's questions.">
                <Input
                  id={`terminals-args-${launcher.id}`}
                  data-testid={`terminals-args-${launcher.id}`}
                  maxLength={MAX_ARGS_LENGTH}
                  value={args[launcher.id] ?? current.launcherArgs[launcher.id] ?? ''}
                  onChange={(event) => setArgs((now) => ({ ...now, [launcher.id]: event.target.value }))}
                  onBlur={() => {
                    const value = args[launcher.id];
                    if (value !== undefined && value !== (current.launcherArgs[launcher.id] ?? '')) save.mutate({ launcherArgs: { ...current.launcherArgs, [launcher.id]: value } });
                  }}
                />
              </Field>
            ))}
            <Field id="terminals-proxies" layout="inline" label="Pass my proxy settings" description="A terminal gets your proxy variables. A proxy address can hold a password, so this is off unless you turn it on.">
              <Switch id="terminals-proxies" data-testid="terminals-proxies" checked={current.passProxies} aria-describedby="terminals-proxies-description" onCheckedChange={(passProxies) => save.mutate({ passProxies })} />
            </Field>
            <Field id="terminals-ssh" layout="inline" label="Let terminals use my SSH keys" description="A terminal can use the keys your SSH agent holds. Off unless you turn it on.">
              <Switch id="terminals-ssh" data-testid="terminals-ssh" checked={current.passSshAgent} aria-describedby="terminals-ssh-description" onCheckedChange={(passSshAgent) => save.mutate({ passSshAgent })} />
            </Field>
            {save.isError ? (
              <Notice variant="blocked" role="alert" data-testid="terminals-settings-error">
                {save.error instanceof Error ? save.error.message : "Ogden Agents couldn't save that setting. Try again."}
              </Notice>
            ) : null}
            <Text variant="caption" data-testid="terminals-limits">
              A project can have {MAX_PANES_PER_PROJECT} terminals open at once, and Ogden Agents {MAX_PANES_PER_INSTALL}.
            </Text>
            <Text variant="caption" data-testid="terminals-chat-note">
              A chat's own terminal switch is separate. If you open the same session in a terminal here while Ogden Agents also drives it in the chat, the two can disagree. Use the chat's Terminal switch for that.
            </Text>
          </PageSection>
        )}
      </PageBody>
    </>
  );
}
