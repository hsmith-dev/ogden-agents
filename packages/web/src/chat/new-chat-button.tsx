import { NotePencil } from '@phosphor-icons/react';
import { useAppearance } from '@/appearance/appearance-provider';
import { Button } from '@/ui/button';
import { Kbd } from '@/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { useOpenNewChat } from './new-chat';

/** The words of every New chat way in (EXPERIENCE.md New chat). */
export const NEW_CHAT = 'New chat';

/**
 * A chat header's New chat (epic 26, E26-R2; EXPERIENCE.md New chat): an
 * outline icon button that opens the project's new-chat draft. In Developer
 * mode its tooltip shows its keys, `g n`, as the project tabs' do.
 */
export function NewChatButton({ wsId }: { wsId: string }) {
  const openNewChat = useOpenNewChat();
  const { appearance } = useAppearance();
  const button = (
    <Button variant="outline" size="icon" aria-label={NEW_CHAT} data-testid="header-new-chat" onClick={() => openNewChat(wsId)}>
      <NotePencil aria-hidden />
    </Button>
  );
  if (!appearance.developerMode) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent data-testid="header-new-chat-hint">
        <span className="flex items-center gap-1">
          <Kbd>g</Kbd>
          <Kbd>n</Kbd>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
