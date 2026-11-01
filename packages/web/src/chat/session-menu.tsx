import { ArrowsLeftRight, DotsThree, ListBullets, ListDashes } from '@phosphor-icons/react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { DETAIL_MENU_WORDS, type ChatDetail } from './detail-level';

/** The handoff action's words, in the header menu and on a usage-limit notice. */
export const CONTINUE_WITH_ANOTHER_AGENT = 'Continue with another agent';

/**
 * The chat's header menu. The detail item names the other level ("Show every
 * step" in Normal, "Show less detail" in Verbose; epic 26 story 4), on every
 * chat. Continue with another agent (handoff, user decision 2026-10-04) only
 * when `onContinue` is given (the install has several agents): while the chat
 * can't be handed over (the agent works or waits, the terminal drives), the
 * item stays reachable by keyboard with its reason read under it, and does
 * nothing.
 */
export function SessionMenu({
  detail,
  onDetail,
  blockedReason,
  onContinue,
}: {
  detail: ChatDetail;
  onDetail: (next: ChatDetail) => void;
  blockedReason?: string | undefined;
  onContinue?: (() => void) | undefined;
}) {
  const blocked = blockedReason !== undefined;
  const next: ChatDetail = detail === 'normal' ? 'verbose' : 'normal';
  const DetailIcon = next === 'verbose' ? ListBullets : ListDashes;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Chat actions" data-testid="session-menu">
          <DotsThree aria-hidden weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="session-menu-content">
        <DropdownMenuItem data-testid="session-menu-detail" data-detail={detail} onSelect={() => onDetail(next)}>
          <DetailIcon aria-hidden />
          {DETAIL_MENU_WORDS[detail]}
        </DropdownMenuItem>
        {onContinue === undefined ? null : (
          <>
            <DropdownMenuItem
              data-testid="session-menu-continue"
              aria-disabled={blocked || undefined}
              aria-describedby={blocked ? 'session-menu-continue-reason' : undefined}
              className={blocked ? 'opacity-50' : undefined}
              onSelect={(event) => {
                if (blocked) {
                  event.preventDefault();
                  return;
                }
                onContinue();
              }}
            >
              <ArrowsLeftRight aria-hidden />
              {CONTINUE_WITH_ANOTHER_AGENT}…
            </DropdownMenuItem>
            {blocked ? (
              <DropdownMenuLabel id="session-menu-continue-reason" className="max-w-72 text-caption font-normal text-muted-foreground" data-testid="session-menu-continue-reason">
                {blockedReason}
              </DropdownMenuLabel>
            ) : null}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
