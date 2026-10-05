import { useState } from 'react';
import type { UpdateCheckOutcome } from '@ogden-agents/shared';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { useUpdateActions, useUpdateNotice } from '@/updates/update-api';
import { availableSentence, channelLabel, HOW_TO_UPDATE, updateCommand } from '@/updates/update-model';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Notice } from '@/ui/notice';
import { PageBody, PageSection } from '@/ui/page';
import { Switch } from '@/ui/switch';

/** What Check now found, in plain words (the newer version has its own sentence). */
const OUTCOME_WORDS: Record<Exclude<UpdateCheckOutcome, 'newer'>, string> = {
  current: 'You have the newest version.',
  failed: 'Ogden could not reach npm. Try again later.',
  offline: 'Ogden is set to stay offline, so it did not check.',
};

/** "Never", or the time of the last check in the reader's own format. */
export function lastCheckedText(iso: string | null): string {
  if (iso === null) return 'Not yet';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? 'Not yet' : at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * `/settings/about` (story 13.7): the running version and its channel, when
 * npm was last asked about a newer one, Check now, and the switch for the
 * check when Ogden starts. The server asks npm, never this page.
 */
export function AboutPage() {
  const { data, isError } = useUpdateNotice();
  const { save, check } = useUpdateActions();
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
            <p className="m-0 text-label text-muted-foreground" role={isError ? 'alert' : undefined}>
              {isError ? "Ogden couldn't read its version." : 'Loading.'}
            </p>
          ) : (
            <>
              <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-label" data-testid="about-details">
                <dt className="text-muted-foreground">Version</dt>
                <dd className="m-0" data-testid="about-version">
                  {data.current}
                </dd>
                <dt className="text-muted-foreground">Channel</dt>
                <dd className="m-0" data-testid="about-channel">
                  {channelLabel(data.channel)}
                </dd>
                <dt className="text-muted-foreground">Last checked</dt>
                <dd className="m-0" data-testid="about-last-checked">
                  {lastCheckedText(data.lastCheckedAt)}
                </dd>
              </dl>
              {data.available === null ? null : (
                <Notice data-testid="about-available">
                  {availableSentence(data.available)} {HOW_TO_UPDATE} <code className="font-mono">{updateCommand(data, data.available)}</code> in a terminal.
                </Notice>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" data-testid="check-now" disabled={check.isPending} onClick={checkNow}>
                  Check now
                </Button>
                {/* Announced politely when the answer arrives; empty (but present) before. */}
                <p className="m-0 text-label text-muted-foreground" role="status" data-testid="check-result">
                  {check.isPending ? 'Checking.' : check.isError ? check.error.message : outcome === undefined ? '' : outcome === 'newer' ? (data.available === null ? '' : availableSentence(data.available)) : OUTCOME_WORDS[outcome]}
                </p>
              </div>
              <Field
                id="check-updates-on-start"
                layout="inline"
                label="Check for new versions when Ogden starts"
                description={
                  data.offline
                    ? 'OGDEN_AGENTS_OFFLINE is set, so Ogden does not check.'
                    : 'Ogden asks npm for the public list of versions of ogden-agents, once each time it starts. Nothing about you or your projects is sent.'
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
            </>
          )}
        </PageSection>
      </PageBody>
    </>
  );
}
