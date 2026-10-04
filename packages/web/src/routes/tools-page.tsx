import type { ToolchainStatus } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { DownloadSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { installUv, progressText } from '@/toolchain/toolchain-api';
import { UV_STATUS_KEY, useUvStatus } from '@/toolchain/use-uv-status';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Notice } from '@/ui/notice';
import { PageBody, PageSection } from '@/ui/page';
import { Progress } from '@/ui/progress';
import { Skeleton } from '@/ui/skeleton';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';

/**
 * `/settings/tools`: whether uv, which BMad Method's scripts run through, is
 * ready, and a one-click install of Ogden Agents' own copy when it isn't
 * (AD-21: no terminal). Nothing downloads until the user clicks Install.
 */
export function ToolsPage() {
  return (
    <>
      <WorkspaceHeader title="Tools" />
      <PageBody>
        <PageSection aria-label="Tools">
          <UvField />
        </PageSection>
      </PageBody>
    </>
  );
}

function UvField() {
  const queryClient = useQueryClient();
  const query = useUvStatus();
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | undefined>(undefined);

  const install = () => {
    setRequesting(true);
    setRequestError(undefined);
    installUv().then(
      (uv) => {
        setRequesting(false);
        queryClient.setQueryData(UV_STATUS_KEY, uv);
      },
      (failure: unknown) => {
        setRequesting(false);
        setRequestError(failure instanceof Error ? failure.message : "uv couldn't be installed. Try again.");
      },
    );
  };

  return (
    <Field
      id="uv"
      control="group"
      label="uv"
      description="Needed only for BMad Method features, which a project turns on in its settings; chats don't use it. If it's missing then, Ogden Agents installs its own copy in its data folder; nothing else on your computer changes."
    >
      <div role="group" aria-labelledby="uv-label" aria-describedby="uv-description" data-testid="uv-status" data-state={query.data?.state ?? (query.isError ? 'error' : 'loading')} className="flex flex-col gap-3">
        {query.data === undefined ? (
          query.isError ? (
            <Notice
              variant="blocked"
              action={
                <Button variant="primary" onClick={() => void query.refetch()}>
                  Try again
                </Button>
              }
            >
              {query.error.message}
            </Notice>
          ) : (
            <>
              <Skeleton />
              <span role="status" className="sr-only">
                Checking for uv
              </span>
            </>
          )
        ) : (
          <UvStatusView status={query.data} requesting={requesting} onInstall={install} />
        )}
        {requestError === undefined ? null : (
          <Text variant="caption" role="alert" data-testid="uv-request-error">
            {requestError}
          </Text>
        )}
      </div>
    </Field>
  );
}

function UvStatusView({ status, requesting, onInstall }: { status: ToolchainStatus; requesting: boolean; onInstall: () => void }) {
  switch (status.state) {
    case 'ready':
      return (
        <StateGlyph
          state="done"
          label={
            status.source === 'private'
              ? `Ready: uv ${status.version}, installed by Ogden Agents`
              : `Ready: uv ${status.version}, found on this computer`
          }
        />
      );
    case 'installing':
      return (
        <>
          <StateGlyph state="working" label="Installing uv" />
          <Progress
            aria-label="Downloading uv"
            data-testid="uv-progress"
            value={status.total === null ? null : status.bytes}
            max={status.total ?? 100}
          />
          <Text variant="caption" aria-live="polite">
            {progressText(status.bytes, status.total)}
          </Text>
          <div className="flex">
            <Button aria-disabled>Installing...</Button>
          </div>
        </>
      );
    case 'missing':
      return (
        <>
          <StateGlyph state="idle" label="Not installed" />
          {status.reason === undefined ? null : <Text variant="caption">{status.reason}</Text>}
          <div className="flex">
            <InstallButton requesting={requesting} onInstall={onInstall} label="Install uv" />
          </div>
        </>
      );
    case 'failed':
      return (
        <Notice
          variant="blocked"
          glyphLabel="Not installed"
          data-testid="uv-failed"
          action={status.canInstall ? <InstallButton requesting={requesting} onInstall={onInstall} label="Try again" /> : undefined}
        >
          {status.reason}
        </Notice>
      );
  }
}

function InstallButton({ requesting, onInstall, label }: { requesting: boolean; onInstall: () => void; label: string }) {
  return (
    <Button aria-disabled={requesting} onClick={requesting ? undefined : onInstall}>
      <DownloadSimple aria-hidden />
      {requesting ? 'Starting...' : label}
    </Button>
  );
}
