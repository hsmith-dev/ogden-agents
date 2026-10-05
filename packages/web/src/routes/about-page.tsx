import { useState } from 'react';
import type { UpdateCheckOutcome } from '@ogden-agents/shared';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { useUpdateActions, useUpdateNotice } from '@/updates/update-api';
import { UpdateHowTo } from '@/updates/update-how-to';
import { availableSentence, channelLabel, sourcesLabel, updateChannelLabel } from '@/updates/update-model';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Notice } from '@/ui/notice';
import { PageBody, PageSection } from '@/ui/page';
import { Switch } from '@/ui/switch';
import { Text } from '@/ui/typography';

/** What Check now found, in plain words (the newer version has its own sentence). */
const outcomeWords = (outcome: Exclude<UpdateCheckOutcome, 'newer'>, sources: string): string =>
  outcome === 'current' ? 'You have the newest version.' : outcome === 'failed' ? `Ogden could not reach ${sources}. Try again later.` : 'Ogden is set to stay offline, so it did not check.';

/** "Never", or the time of the last check in the reader's own format. */
export function lastCheckedText(iso: string | null): string {
  if (iso === null) return 'Not yet';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? 'Not yet' : at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * `/settings/about` (story 13.7): the running version and its channel, when
 * GitHub Releases (and npm, for npm installs) were last asked about a newer one, Check now, and the switch for the
 * check when Ogden starts. The server asks, never this page.
 */
export function AboutPage() {
  const { data, isError } = useUpdateNotice();
  const { save, check, channel } = useUpdateActions();
  const [outcome, setOutcome] = useState<UpdateCheckOutcome | undefined>(undefined);

  const checkNow = () => {
    setOutcome(undefined);
    check.mutate(undefined, { onSuccess: (result) => setOutcome(result.outcome) });
  };

  return (
    <>
      <WorkspaceHeader title="About" />
      <PageBody>
        <PageSection aria-label="About Ogden Agents">
          {data === undefined ? (
            <Text variant="label" tone="muted" role={isError ? 'alert' : undefined}>
              {isError ? "Ogden couldn't read its version." : 'Loading.'}
            </Text>
          ) : (
            <>
              <Text as="dl" variant="label" className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2" data-testid="about-details">
                <Text as="dt" variant="label" tone="muted">Version</Text>
                <dd className="m-0" data-testid="about-version">
                  {data.current}
                </dd>
                <Text as="dt" variant="label" tone="muted">Channel</Text>
                <dd className="m-0" data-testid="about-channel">
                  {channelLabel(data.channel)}
                </dd>
                <Text as="dt" variant="label" tone="muted">Checks</Text>
                <dd className="m-0" data-testid="about-sources">
                  {data.offline ? 'Nothing (Ogden is set to stay offline)' : sourcesLabel(data.sources)}
                </dd>
                <Text as="dt" variant="label" tone="muted">Last checked</Text>
                <dd className="m-0" data-testid="about-last-checked">
                  {lastCheckedText(data.lastCheckedAt)}
                </dd>
              </Text>
              {data.shell === 'desktop' ? (
                // Inside the desktop app (story 13.3): the app finds updates through its own channel, not npm. The channel row is a stub that 13.10 wires to the shell.
                <Field id="app-update-channel" layout="inline" label="Update channel" description="Stable gets finished versions. Preview also gets early versions to try.">
                  <div className="flex gap-2" role="group" aria-label="Update channel">
                    {(['stable', 'next'] as const).map((value) => (
                      <Button key={value} variant="outline" size="sm" aria-pressed={data.appChannel === value} disabled={channel.isPending} onClick={() => channel.mutate(value)}>
                        {updateChannelLabel(value)}
                      </Button>
                    ))}
                  </div>
                </Field>
              ) : null}
              {data.shell === 'desktop' && data.app !== null && data.app.update.notes !== '' ? (
                <div data-testid="about-update-notes">
                  <Text variant="label" tone="muted">What is new in {data.app.update.version}</Text>
                  <Text as="p" variant="label" className="whitespace-pre-wrap">{data.app.update.notes}</Text>
                </div>
              ) : null}
              {data.shell === 'desktop' || data.available === null ? null : (
                <Notice data-testid="about-available">
                  {availableSentence(data.available)} <UpdateHowTo notice={data} available={data.available} />
                </Notice>
              )}
              {data.shell === 'desktop' ? null : (<>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" data-testid="check-now" disabled={check.isPending} onClick={checkNow}>
                  Check now
                </Button>
                {/* Announced politely when the answer arrives; empty (but present) before. */}
                <Text variant="label" tone="muted" role="status" data-testid="check-result">
                  {check.isPending ? 'Checking.' : check.isError ? check.error.message : outcome === undefined ? '' : outcome === 'newer' ? (data.available === null ? '' : availableSentence(data.available)) : outcomeWords(outcome, sourcesLabel(data.sources))}
                </Text>
              </div>
              <Field
                id="check-updates-on-start"
                layout="inline"
                label="Check for new versions when Ogden starts"
                description={
                  data.offline
                    ? 'OGDEN_AGENTS_OFFLINE is set, so Ogden does not check.'
                    : `Ogden asks ${sourcesLabel(data.sources)} for the newest published version of Ogden Agents, once each time it starts. Nothing about you or your projects is sent.`
                }
              >
                <Switch
                  id="check-updates-on-start"
                  data-testid="check-updates-on-start"
                  aria-describedby="check-updates-on-start-description"
                  checked={data.enabled}
                  disabled={save.isPending}
                  onCheckedChange={(enabled) => save.mutate(enabled)}
                />
              </Field>
              {save.isError ? (
                <Notice variant="blocked" role="alert" data-testid="check-updates-error">
                  {save.error.message}
                </Notice>
              ) : null}
              </>)}
            </>
          )}
        </PageSection>
      </PageBody>
    </>
  );
}
