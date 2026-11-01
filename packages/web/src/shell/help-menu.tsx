import { AppWindow, HandWaving, Keyboard, Question } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useAppShortcut } from '@/appearance/app-shortcut-api';
import { Dialog, DialogContent } from '@/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { ShortcutTable } from '@/ui/shortcut-table';
import { SidebarLabel, SidebarMenuButton, useSidebar } from '@/ui/sidebar';
import { showAppShortcutTip } from './app-shortcut-offer';
import { keyboardShortcuts } from './keyboard-shortcuts';

/** The words of Help's items, for tests and the e2e helper. */
export const HELP_ITEMS = { shortcuts: 'Keyboard shortcuts', appShortcut: 'Add the app shortcut', welcome: 'Welcome' } as const;

/**
 * Help, in the sidebar footer after Settings (epic 26, 26.5): Keyboard
 * shortcuts (a dialog listing them), Add the app shortcut (it shows the
 * shortcut banner again; only on a computer that can have it and doesn't
 * yet), and Welcome, which moved here from Settings.
 */
export function HelpMenu() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { setSheetOpen } = useSidebar();
  const { data } = useAppShortcut();
  const tip = data !== undefined && data.supported && !data.installed;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* The menu opens on press; the click must not close the drawer under it. */}
          <SidebarMenuButton data-testid="help-menu" tooltip="Help" onClick={(event) => event.preventDefault()}>
            <Question aria-hidden />
            <SidebarLabel>Help</SidebarLabel>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
            <Keyboard aria-hidden />
            {HELP_ITEMS.shortcuts}
          </DropdownMenuItem>
          {tip ? (
            <DropdownMenuItem
              onSelect={() => {
                showAppShortcutTip();
                // The banner is in the workspace area, under the drawer on a phone.
                setSheetOpen(false);
              }}
            >
              <AppWindow aria-hidden />
              {HELP_ITEMS.appShortcut}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link to="/welcome">
              <HandWaving aria-hidden />
              {HELP_ITEMS.welcome}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent data-testid="keyboard-shortcuts" title="Keyboard shortcuts" description="Letter and number keys work when you are not typing in a field.">
          <ShortcutTable groups={keyboardShortcuts()} />
        </DialogContent>
      </Dialog>
    </>
  );
}
