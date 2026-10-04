import { Browsers } from '@phosphor-icons/react';
import { useState } from 'react';
import { requestNewTabLink } from '@/events/server-control';
import { SidebarLabel, SidebarMenuButton, SidebarText } from '@/ui/sidebar';

/**
 * New tab, in the sidebar footer (AD-15 as amended): a copied URL or a
 * bookmark opens a tab without a token, so this asks the server for a fresh
 * launch link and opens it; the new tab gets its own token.
 *
 * The tab is opened blank at once, inside the click, so the browser doesn't
 * treat it as a pop-up, and is sent to the link once it arrives.
 */
export function NewTabButton() {
  const [error, setError] = useState<string | undefined>(undefined);
  const onClick = () => {
    setError(undefined);
    const opened = window.open('about:blank', '_blank');
    if (opened !== null) opened.opener = null;
    requestNewTabLink().then(
      (link) => {
        if (opened === null) window.open(link, '_blank', 'noopener');
        else opened.location.href = link;
      },
      (failure: unknown) => {
        opened?.close();
        setError(failure instanceof Error ? failure.message : "Couldn't open a new tab. Try again.");
      },
    );
  };
  return (
    <>
      <SidebarMenuButton data-testid="new-tab" tooltip="New tab" onClick={onClick}>
        <Browsers aria-hidden />
        <SidebarLabel>New tab</SidebarLabel>
      </SidebarMenuButton>
      {error === undefined ? null : (
        <SidebarText role="alert" data-testid="new-tab-error">
          {error}
        </SidebarText>
      )}
    </>
  );
}
