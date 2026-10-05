import {
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENTS,
  WEBHOOK_URL_HIDDEN,
  type NotificationEvent,
  type WebhookTarget,
  type WebhookTestResult,
} from '@ogden-agents/shared';
import { useState, type FormEvent } from 'react';
import { Button } from '@/ui/button';
import { CheckboxOption } from '@/ui/checkbox';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { Text } from '@/ui/typography';
import { addWebhook, fetchNotificationSettings, removeWebhook, testWebhook, updateWebhookEvents, useNotificationSettingsQuery, useSetNotificationSettings } from './webhooks-api';

/** Plain words for each event, under its checkbox. */
const EVENT_DESCRIPTIONS: Record<NotificationEvent, string> = {
  blocked: 'A build stopped and needs you.',
  ready_for_review: 'A build passed its checks and waits for your review.',
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The events as a checkbox group; `onChange` gets the new list (at least one stays on). */
function EventChoices({ idPrefix, label = 'Send when', events, onChange, disabled = false }: { idPrefix: string; label?: string; events: readonly NotificationEvent[]; onChange: (events: NotificationEvent[]) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col">
      {NOTIFICATION_EVENTS.map((event) => (
        <CheckboxOption
          key={event}
          id={`${idPrefix}-${event}`}
          data-testid={`${idPrefix}-${event}`}
          label={NOTIFICATION_EVENT_LABELS[event]}
          description={EVENT_DESCRIPTIONS[event]}
          disabled={disabled}
          checked={events.includes(event)}
          onCheckedChange={(checked) => onChange(NOTIFICATION_EVENTS.filter((each) => (each === event ? checked === true : events.includes(each))))}
        />
      ))}
    </div>
  );
}

/** One webhook: where it goes (its masked host), what it gets, Send test with the result inline, Remove. */
function WebhookRow({ target }: { target: WebhookTarget }) {
  const setSettings = useSetNotificationSettings();
  const [result, setResult] = useState<WebhookTestResult | { error: string } | undefined>();
  const [busy, setBusy] = useState<'test' | 'save' | 'remove' | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const run = (what: 'test' | 'save' | 'remove', work: () => Promise<unknown>) => {
    if (busy !== undefined) return;
    setBusy(what);
    setFailure(undefined);
    work()
      .catch((error: unknown) => setFailure(errorText(error)))
      .finally(() => setBusy(undefined));
  };
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid="webhook" data-id={target.id}>
      <Text variant="label" data-testid="webhook-host">
        Sends to {target.host}
      </Text>
      <Text variant="caption">{WEBHOOK_URL_HIDDEN}</Text>
      <EventChoices
        idPrefix={`webhook-${target.id}`}
        label={`Send to ${target.host} when`}
        events={target.events}
        disabled={busy !== undefined}
        onChange={(events) => {
          // At least one event stays on: remove the webhook to stop all of them.
          if (events.length === 0) return;
          run('save', async () => setSettings(await updateWebhookEvents(target.id, events)));
        }}
      />
      <span className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          data-testid="webhook-test"
          aria-label={`Send test to ${target.host}`}
          aria-disabled={busy !== undefined || undefined}
          onClick={() =>
            run('test', async () => {
              setResult(undefined);
              try {
                setResult(await testWebhook(target.id));
              } catch (error) {
                setResult({ error: errorText(error) });
              }
            })
          }
        >
          Send test
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="webhook-remove"
          aria-label={`Remove the webhook to ${target.host}`}
          aria-disabled={busy !== undefined || undefined}
          onClick={() => run('remove', async () => setSettings(await removeAndRead(target.id)))}
        >
          Remove
        </Button>
      </span>
      {/* Always mounted, so a result is announced when it appears. */}
      <div role="status">
        {result === undefined ? null : (
          <Text variant="caption" data-testid="webhook-test-result" data-ok={'error' in result ? 'false' : String(result.ok)}>
            {'error' in result ? result.error : result.ok ? `Test sent. ${result.message}` : `The test failed. ${result.message}`}
          </Text>
        )}
      </div>
      {failure === undefined ? null : (
        <Text variant="caption" role="alert" className="text-state-error" data-testid="webhook-error">
          {failure}
        </Text>
      )}
    </li>
  );
}

/** Removes a webhook, then reads the settings that are left. */
async function removeAndRead(id: string) {
  await removeWebhook(id);
  return fetchNotificationSettings();
}

/** Add a webhook: its address (kept in the keychain, never shown again) and the events it gets. */
function AddWebhook() {
  const setSettings = useSetNotificationSettings();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<NotificationEvent[]>([...NOTIFICATION_EVENTS]);
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (adding || url.trim() === '' || events.length === 0) return;
    setAdding(true);
    setFailure(undefined);
    addWebhook(url.trim(), events)
      .then(
        (settings) => {
          setSettings(settings);
          setUrl('');
        },
        (error: unknown) => setFailure(errorText(error)),
      )
      .finally(() => setAdding(false));
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={submit} data-testid="webhook-add-form">
      <Field id="webhook-url" label="Web address" description="Starts with https://. It is kept in your keychain and not shown again.">
        <Input id="webhook-url" data-testid="webhook-url" autoComplete="off" spellCheck={false} value={url} onChange={(event) => setUrl(event.target.value)} aria-describedby="webhook-url-description" />
      </Field>
      <EventChoices idPrefix="webhook-new" events={events} onChange={setEvents} />
      <Button type="submit" variant="secondary" className="self-start" data-testid="webhook-add" disabled={adding || url.trim() === '' || events.length === 0}>
        Add webhook
      </Button>
      {failure === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="webhook-add-error">
          {failure}
        </Notice>
      )}
    </form>
  );
}

/**
 * Settings, Notifications: webhooks (story 11.4; EXPERIENCE.md Notifications
 * settings). Off until the user adds one. Each webhook gets a short message
 * with the project, the story and what happened when a build is blocked or
 * ready for review, never code. Its address is a secret: kept in the
 * keychain, listed back by its domain only.
 */
export function WebhookSettings() {
  const settings = useNotificationSettingsQuery();
  return (
    <PageSection title="Webhooks" aria-label="Webhooks" data-testid="webhook-settings">
      <Text variant="caption">
        Ogden Agents sends a short message to a web address you choose when a build is blocked or ready for review. The message names the project and the story, never code. Nothing is sent until you add one.
      </Text>
      {settings.isError ? (
        <Notice variant="blocked" role="alert" data-testid="webhooks-error">
          {settings.error.message}
        </Notice>
      ) : settings.data === undefined ? null : settings.data.webhooks.length === 0 ? (
        <Text variant="caption" data-testid="webhooks-none">
          No webhooks yet.
        </Text>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Your webhooks" data-testid="webhook-list">
          {settings.data.webhooks.map((target) => (
            <WebhookRow key={target.id} target={target} />
          ))}
        </ul>
      )}
      <AddWebhook />
    </PageSection>
  );
}
