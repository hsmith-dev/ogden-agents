import type { DevToolUnattendedAllowance } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { keepSaved } from '@/api/keep-saved';
import { devToolsAllowlistQueryKey, setDevToolUnattendedAllowed, useDevToolsAllowlist } from '@/dev-tools/dev-tools-api';
import { CheckboxOption } from '@/ui/checkbox';
import { Field } from '@/ui/field';
import { Notice } from '@/ui/notice';
import { Text } from '@/ui/typography';
import { createLatestGate } from '@/workspaces/workspace-settings-api';

/**
 * A project's generic dev tools' unattended-build allowance (CAP-25, AC5-6;
 * deny by default, matching epic 5's existing sandbox posture): one checkbox
 * per tool already installed on this computer, off by default. An
 * unattended build can reach a tool only once its checkbox here is on for
 * this project; a chat's own use of an installed tool needs none of this
 * (CAP-4's permission card already covers it, unchanged). Nothing to show
 * when no tool is installed yet.
 */
export function DevToolsAllowlistSection({ wsId }: { wsId: string }) {
  const query = useDevToolsAllowlist(wsId);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const latest = useRef(createLatestGate()).current;

  if (query.data !== undefined && query.data.length === 0) return null;

  const toggle = (toolId: string, allowed: boolean) => {
    const ticket = latest.next();
    setSaving(toolId);
    setError(undefined);
    setDevToolUnattendedAllowed(wsId, toolId, allowed).then(
      async (tools) => {
        if (!latest.isLatest(ticket)) return;
        await keepSaved(queryClient, devToolsAllowlistQueryKey(wsId), tools);
        setSaving(undefined);
      },
      (failure: unknown) => {
        if (!latest.isLatest(ticket)) return;
        setSaving(undefined);
        setError(failure instanceof Error ? failure.message : "That allowance couldn't be saved. Try again.");
      },
    );
  };

  return (
    <Field
      id="dev-tools-allowlist"
      control="group"
      label="Developer tools for unattended builds"
      description="Off by default for every tool. An unattended build can use a tool only once you allow it here, for this project; a chat can already use any installed tool like any other command."
    >
      {query.data === undefined ? (
        query.isError ? <Notice variant="blocked">{query.error.message}</Notice> : null
      ) : (
        query.data.map((tool: DevToolUnattendedAllowance) => (
          <CheckboxOption
            key={tool.id}
            id={`dev-tools-allow-${tool.id}`}
            data-testid={`dev-tools-allow-${tool.id}`}
            label={tool.label}
            checked={tool.allowed}
            disabled={saving === tool.id}
            onCheckedChange={(on) => toggle(tool.id, on === true)}
          />
        ))
      )}
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="dev-tools-allowlist-error">
          {error}
        </Text>
      )}
    </Field>
  );
}
