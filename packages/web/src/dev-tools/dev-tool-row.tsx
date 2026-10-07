import type { DevToolStatus } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DEV_TOOLS_QUERY_KEY, installDevTool, removeDevTool } from '@/dev-tools/dev-tools-api';
import { InstallToolCard } from '@/dev-tools/install-tool-card';
import { Button } from '@/ui/button';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';

/**
 * One dev tool's row on `/settings/dev-tools` (CAP-25, AC1-3): its real
 * installed state (`StateGlyph`, never found by running it), Install (which
 * opens the confirmation card and runs the server's own stored command only
 * once confirmed), and a plain reason when a decline or a failure leaves it
 * not installed. A custom tool (not one of the seed catalog's) also offers
 * Remove.
 */
export function DevToolRow({ tool }: { tool: DevToolStatus }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [removing, setRemoving] = useState(false);

  const install = () => {
    setInstalling(true);
    setError(undefined);
    installDevTool(tool.id).then(
      (status) => {
        setInstalling(false);
        setConfirming(false);
        queryClient.setQueryData<DevToolStatus[]>(DEV_TOOLS_QUERY_KEY, (current) => current?.map((each) => (each.id === status.id ? status : each)));
      },
      (failure: unknown) => {
        setInstalling(false);
        setConfirming(false);
        setError(failure instanceof Error ? failure.message : `${tool.label} couldn't be installed. Try again.`);
      },
    );
  };

  const remove = () => {
    setRemoving(true);
    removeDevTool(tool.id).then(
      () => {
        queryClient.setQueryData<DevToolStatus[]>(DEV_TOOLS_QUERY_KEY, (current) => current?.filter((each) => each.id !== tool.id));
      },
      (failure: unknown) => {
        setRemoving(false);
        setError(failure instanceof Error ? failure.message : `${tool.label} couldn't be removed. Try again.`);
      },
    );
  };

  return (
    <div data-testid={`dev-tool-${tool.id}`} className="flex flex-col gap-3 border-b border-border py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StateGlyph state={tool.installed ? 'done' : 'idle'} label={tool.installed ? `${tool.label}: installed` : `${tool.label}: not installed`} />
        {tool.installed ? null : tool.installCommand === null ? (
          <Text variant="caption">No known install command for this computer.</Text>
        ) : confirming ? null : (
          <Button aria-disabled={installing} onClick={installing ? undefined : () => setConfirming(true)} data-testid={`install-${tool.id}`}>
            Install
          </Button>
        )}
        {tool.source === 'custom' ? (
          <Button variant="outline" aria-disabled={removing} onClick={removing ? undefined : remove} data-testid={`remove-${tool.id}`}>
            Remove
          </Button>
        ) : null}
      </div>
      {confirming && tool.installCommand !== null ? (
        <InstallToolCard label={tool.label} command={tool.installCommand} disabled={installing} onConfirm={install} onCancel={() => setConfirming(false)} />
      ) : null}
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid={`dev-tool-error-${tool.id}`}>
          {error}
        </Text>
      )}
    </div>
  );
}
