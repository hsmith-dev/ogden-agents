import { SCRIPT_TRUST_ALLOW, SCRIPT_TRUST_CHANGED_TEXT, SCRIPT_TRUST_CHANGED_TITLE, SCRIPT_TRUST_FAILED, SCRIPT_TRUST_TEXT, SCRIPT_TRUST_TITLE } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { keepSaved } from '@/api/keep-saved';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { Text } from '@/ui/typography';
import { trustProjectScripts } from '@/workspaces/workspace-settings-api';

/**
 * The inline trust prompt (story 4.2; user decision 2026-10-02, "Trust once
 * per project"): shown where a surface was refused with
 * `scripts_not_trusted` (the Board). It says Ogden Agents will run this
 * project's BMad Method scripts, and **Allow** asks the server to trust the
 * project (`PUT …/bmad/script-trust`), then stores the new settings and
 * calls `onTrusted` so the surface fetches again. The server's guard, not
 * this prompt, decides what runs (AD-22). A refusal shows its reason and
 * leaves the prompt. With `changed` (story 4.13, `scripts_changed`: the
 * project's scripts aren't the ones the user allowed) it says so, and Allow
 * allows them as they are now.
 */
export function ScriptTrustPrompt({ wsId, onTrusted, changed = false }: { wsId: string; onTrusted: () => void; changed?: boolean }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const allow = () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    trustProjectScripts(wsId).then(
      async (settings) => {
        await keepSaved(queryClient, ['workspace-settings', wsId], settings);
        setBusy(false);
        onTrusted();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(failure instanceof Error && failure.message !== '' ? failure.message : SCRIPT_TRUST_FAILED);
      },
    );
  };
  return (
    <div className="flex max-w-(--space-chat-column) flex-col gap-2" data-testid="script-trust-prompt" data-changed={changed ? 'true' : undefined}>
      <Notice
        aria-labelledby="script-trust-title"
        action={
          <Button data-testid="script-trust-allow" aria-disabled={busy} onClick={allow}>
            {SCRIPT_TRUST_ALLOW}
          </Button>
        }
      >
        <span className="flex flex-col gap-1">
          <span id="script-trust-title">{changed ? SCRIPT_TRUST_CHANGED_TITLE : SCRIPT_TRUST_TITLE}</span>
          <span className="text-caption text-muted-foreground">{changed ? SCRIPT_TRUST_CHANGED_TEXT : SCRIPT_TRUST_TEXT}</span>
        </span>
      </Notice>
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="script-trust-error">
          {error}
        </Text>
      )}
    </div>
  );
}
