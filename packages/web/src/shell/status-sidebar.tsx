import { GearSix, PaintBrush, Plus } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarText,
  useSidebar,
} from '@/ui/sidebar';
import { NeedsYouGroup } from './needs-you-group';
import { QuitButton } from './quit-button';
import { ServerStatus } from './server-status';
import { Wordmark } from './wordmark';

export const ADD_PROJECT_UNAVAILABLE = "Adding a project isn't available yet.";

/**
 * The status sidebar (EXPERIENCE.md Information Architecture): Needs you on
 * top, then workspaces with their session rows and Add project, then the
 * footer with Settings, Quit Ogden Agents and the server status. Workspaces and sessions arrive
 * with epic 2; until then it shows its empty state.
 */
export function StatusSidebar() {
  return (
    <Sidebar label="Projects and sessions" data-testid="status-sidebar">
      <StatusSidebarBody />
    </Sidebar>
  );
}

/**
 * The sidebar's content. Below md it is mounted twice (the hidden column and
 * the sheet), so its ids come from useId to stay unique per instance.
 */
function StatusSidebarBody() {
  const projectsId = useId();
  const unavailableId = useId();
  return (
    <>
      <SidebarHeader>
        <Wordmark />
      </SidebarHeader>
      <SidebarContent>
        <NeedsYouGroup items={[]} />
        <SidebarGroup aria-labelledby={projectsId}>
          <SidebarGroupLabel id={projectsId}>Projects</SidebarGroupLabel>
          <SidebarText data-testid="no-projects">No projects yet</SidebarText>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="add-project"
                aria-disabled
                aria-describedby={unavailableId}
                tooltip={ADD_PROJECT_UNAVAILABLE}
                tooltipAlways
                onClick={(event) => event.preventDefault()}
              >
                <Plus aria-hidden />
                <SidebarLabel>Add project</SidebarLabel>
              </SidebarMenuButton>
              <span id={unavailableId} className="sr-only">
                {ADD_PROJECT_UNAVAILABLE}
              </span>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SettingsMenu />
        <QuitButton />
        <ServerStatus />
      </SidebarFooter>
    </>
  );
}

/** Settings sections (Agents and Notifications arrive with later epics). */
function SettingsMenu() {
  const { setSheetOpen } = useSidebar();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton data-testid="settings-menu" tooltip="Settings" onClick={(event) => event.preventDefault()}>
          <GearSix aria-hidden />
          <SidebarLabel>Settings</SidebarLabel>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuLabel>Settings</DropdownMenuLabel>
        <DropdownMenuItem asChild onSelect={() => setSheetOpen(false)}>
          <Link to="/settings/appearance">
            <PaintBrush aria-hidden />
            Appearance
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
