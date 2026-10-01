import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';

export const READ_ONLY_WORDS = 'The terminal is driving this session.';

export interface ReadOnlyBannerProps {
  onSwitchToChat(): void;
  /** A switch is in flight: the button waits. */
  switching: boolean;
  /** Whether the read-only conversation is shown beside the terminal (`xl` only). */
  peekOpen: boolean;
  onTogglePeek(): void;
  /** The id of the conversation the peek button shows and hides. */
  peekId: string;
}

/**
 * Above the terminal panel while it drives (DESIGN.md Read-only banner;
 * EXPERIENCE.md "Terminal driving"): one sentence, Switch to Chat, and, at
 * `xl`, Show conversation for the read-only transcript beside the terminal
 * (closed by default; user decision 2026-10-01).
 */
export function ReadOnlyBanner({ onSwitchToChat, switching, peekOpen, onTogglePeek, peekId }: ReadOnlyBannerProps) {
  return (
    <Banner
      data-testid="read-only-banner"
      action={
        <span className="flex items-center gap-1">
          <Button
            variant="link" size="sm"
            className="hidden xl:inline-flex"
            aria-expanded={peekOpen}
            aria-controls={peekId}
            onClick={onTogglePeek}
            data-testid="peek-toggle"
          >
            {peekOpen ? 'Hide conversation' : 'Show conversation'}
          </Button>
          <Button variant="link" size="sm" onClick={onSwitchToChat} aria-disabled={switching || undefined} data-testid="banner-switch-to-chat">
            Switch to Chat
          </Button>
        </span>
      }
    >
      {READ_ONLY_WORDS}
    </Banner>
  );
}
