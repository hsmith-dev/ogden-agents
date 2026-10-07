import { useId } from 'react';
import { Button } from '@/ui/button';
import { Text } from '@/ui/typography';

export interface InstallToolCardProps {
  /** The tool's display name, for the headline. */
  label: string;
  /** The exact command Ogden would run, shown verbatim. */
  command: string;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A dev tool's install confirmation (CAP-25, AC2): the exact real command,
 * then Install or Cancel, with no terminal at any point. Visually and
 * interactively modeled on the chat permission card
 * (`@/permissions/permission-card`, CAP-4) — the headline, the command in a
 * `<pre>` block and a plain button row — since this is the same kind of
 * moment (confirm a real action before Ogden takes it), even though it has
 * no chat session to answer: there is no agent, no transcript and no
 * permission request behind this card, only the install endpoint, which
 * always runs its own stored command for this tool, never whatever the
 * client sends.
 */
export function InstallToolCard({ label, command, disabled = false, onConfirm, onCancel }: InstallToolCardProps) {
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-headline`}
      data-testid="install-tool-card"
      className="flex flex-col gap-3 rounded-lg border border-border border-l-(length:--rail-signal) border-l-signal bg-card p-(--panel-padding)"
    >
      <h2 id={`${id}-headline`} className="m-0 text-heading text-foreground">
        Install {label}
      </h2>
      <Text variant="caption">This is {label}'s own official install command. Ogden Agents runs it only once you confirm, with no terminal.</Text>
      <pre data-testid="install-tool-command" className="m-0 whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 font-mono text-mono text-foreground">
        {command}
      </pre>
      <div className="flex flex-wrap items-start gap-2">
        <Button aria-disabled={disabled} onClick={disabled ? undefined : onConfirm} data-testid="install-tool-confirm">
          Install
        </Button>
        <Button variant="outline" aria-disabled={disabled} onClick={disabled ? undefined : onCancel} data-testid="install-tool-cancel">
          Cancel
        </Button>
      </div>
    </section>
  );
}
