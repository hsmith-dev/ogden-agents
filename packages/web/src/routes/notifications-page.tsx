import { useState } from 'react';
import { playChime } from '@/notifications/chime';
import { desktopPermission, requestDesktopPermission } from '@/notifications/desktop';
import { NEED_KINDS, useNotificationSettings } from '@/notifications/notification-settings';
import { NEED_KIND_LABELS, type DesktopPermission } from '@/notifications/notifier';
import type { NeedKind } from '@/shell/sidebar-model';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { CheckboxOption } from '@/ui/checkbox';
import { Field } from '@/ui/field';
import { Notice } from '@/ui/notice';
import { PageBody, PageSection } from '@/ui/page';
import { Slider } from '@/ui/slider';
import { Switch } from '@/ui/switch';
import { WebhookSettings } from '@/notifications/webhook-settings';

/** What each kind of need means, under its checkbox. */
const KIND_DESCRIPTIONS: Record<NeedKind, string> = {
  permission: 'An agent asks before it runs a command or changes a file.',
  waiting: 'A chat is waiting for you to answer.',
  check_in: 'An agent has sent nothing for 10 minutes while it works.',
  sign_in: 'A chat stopped until its agent is signed in again.',
  run_blocked: 'A build stopped and needs you.',
  run_review: 'A build passed its checks and waits for your review.',
};

/** The volume as a percentage, in steps of five. */
const VOLUME_SCALE = { min: 0, max: 100, step: 5 } as const;

/** Why desktop notifications can't be on, in one sentence, or nothing when they can. */
export function permissionSentence(permission: DesktopPermission): string | undefined {
  if (permission === 'unsupported') return "This browser can't show notifications. The sound and the Needs you list still tell you.";
  if (permission === 'denied') return "Your browser is blocking notifications from Ogden Agents. Allow them in your browser's settings for this site, then turn this on again.";
  return undefined;
}

/**
 * `/settings/notifications` (backlog story 8): desktop notifications and the
 * sound for when a chat needs you, saved in this browser. The browser's
 * permission is asked only when the user turns desktop notifications on here.
 */
export function NotificationsPage() {
  const { settings, update } = useNotificationSettings();
  // Read on every render: another tab may have been granted it since (its settings change re-renders this one).
  const [, setAnswered] = useState(0);
  const permission = desktopPermission();
  const [asking, setAsking] = useState(false);
  const blocked = permissionSentence(permission);
  const desktopOn = settings.desktop && permission === 'granted';

  const setDesktop = async (on: boolean) => {
    if (!on) {
      update({ desktop: false });
      return;
    }
    if (asking) return;
    let now = desktopPermission();
    if (now === 'default') {
      setAsking(true);
      now = await requestDesktopPermission();
      setAsking(false);
    }
    setAnswered((n) => n + 1);
    update({ desktop: now === 'granted' });
  };

  return (
    <>
      <WorkspaceHeader title="Notifications" />
      <PageBody>
        <PageSection aria-label="Notification settings">
          <Field
            id="desktop-notifications"
            layout="inline"
            label="Desktop notifications"
            description="Shows a notification on your computer when a chat needs you. It names the project, the chat and what kind of decision it is, never what the agent wants to run. Your browser asks you to allow it the first time."
          >
            <Switch
              id="desktop-notifications"
              data-testid="desktop-notifications"
              aria-describedby={blocked === undefined ? 'desktop-notifications-description' : 'desktop-notifications-description desktop-notifications-blocked'}
              checked={desktopOn}
              // Not disabled while the browser asks: that would drop keyboard focus to the page.
              disabled={permission === 'unsupported'}
              aria-busy={asking || undefined}
              onCheckedChange={(on) => void setDesktop(on)}
            />
          </Field>
          {/* The live region is always there, so a refusal's sentence is announced when it appears. */}
          <div role="status">
            {blocked === undefined ? null : (
              <Notice variant="info" infoGlyph id="desktop-notifications-blocked" data-testid="desktop-notifications-blocked">
                {blocked}
              </Notice>
            )}
          </div>
          <Field
            id="notification-sound"
            layout="inline"
            label="Sound"
            description="Plays a short chime when a chat needs you. Browsers play sound only in a tab you have clicked in since it opened, so click in an Ogden Agents tab once after opening or reloading it."
          >
            <Switch
              id="notification-sound"
              data-testid="notification-sound"
              aria-describedby="notification-sound-description"
              checked={settings.sound}
              onCheckedChange={(on) => update({ sound: on })}
            />
          </Field>
          <Field id="notification-volume" control="group" label="Volume">
            <div className="flex items-center gap-4">
              <Slider
                data-testid="notification-volume"
                aria-labelledby="notification-volume-label"
                {...VOLUME_SCALE}
                disabled={!settings.sound}
                value={[Math.round(settings.volume * 100)]}
                onValueChange={([value]) => update({ volume: (value ?? 0) / 100 })}
              />
              <Button variant="outline" data-testid="test-sound" disabled={!settings.sound} onClick={() => playChime(settings.volume)}>
                Test sound
              </Button>
            </div>
          </Field>
          <Field id="notification-kinds" control="group" label="Notify me when" description="Every one of these still shows in Needs you.">
            <div role="group" aria-labelledby="notification-kinds-label" aria-describedby="notification-kinds-description" className="flex flex-col">
              {NEED_KINDS.map((kind) => (
                <CheckboxOption
                  key={kind}
                  id={`notify-${kind}`}
                  data-testid={`notify-${kind}`}
                  label={NEED_KIND_LABELS[kind]}
                  description={KIND_DESCRIPTIONS[kind]}
                  checked={settings.kinds[kind]}
                  onCheckedChange={(checked) => update({ kinds: { ...settings.kinds, [kind]: checked === true } })}
                />
              ))}
            </div>
          </Field>
          <Field
            id="notify-only-when-away"
            layout="inline"
            label="Only when Ogden Agents isn't in front"
            description="Stays quiet while an Ogden Agents tab is the one you are looking at. The Needs you list and the tab title still count what needs you."
          >
            <Switch
              id="notify-only-when-away"
              data-testid="notify-only-when-away"
              aria-describedby="notify-only-when-away-description"
              checked={settings.onlyWhenAway}
              onCheckedChange={(on) => update({ onlyWhenAway: on })}
            />
          </Field>
        </PageSection>
        <WebhookSettings />
      </PageBody>
    </>
  );
}
