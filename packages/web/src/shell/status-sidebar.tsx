import { GearSix, PaintBrush, Plus, Wrench } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
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
import { AddProjectDialog } from '@/workspaces/add-project-dialog';
import { useWorkspaces } from '@/workspaces/workspace-api';
import { NeedsYouGroup } from './needs-you-group';
import { NewTabButton } from './new-tab-button';
import { QuitButton } from './quit-button';
import { ServerStatus } from './server-status';
import { Wordmark } from './wordmark';
import { WorkspaceSwitcher } from './workspace-switcher';

/**
 * The status sidebar (EXPERIENCE.md Information Architecture): the workspace
 * switcher in the header, Needs you on top, then workspaces with their
 * session rows and Add project, then the footer with Settings, New tab, Quit
 * Ogden Agents and the server status. The workspace rows arrive with story
 * 2.11; until then the switcher is the way between projects.
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
  const workspaces = useWorkspaces();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <SidebarHeader>
        <Wordmark />
        {/* The rail has no room for it; Add project stays below. */}
        <WorkspaceSwitcher className="ml-auto md:max-lg:hidden" />
      </SidebarHeader>
      <SidebarContent>
        <NeedsYouGroup items={[]} />
        <SidebarGroup aria-labelledby={projectsId}>
          <SidebarGroupLabel id={projectsId}>Projects</SidebarGroupLabel>
          {workspaces.data?.length === 0 ? <SidebarText data-testid="no-projects">No projects yet</SidebarText> : null}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="add-project"
                tooltip="Add project"
                // Keep the sheet open under the dialog; navigating to the project closes it.
                onClick={(event) => {
                  event.preventDefault();
                  setAdding(true);
                }}
              >
                <Plus aria-hidden />
                <SidebarLabel>Add project</SidebarLabel>
              </SidebarMenuButton>
              <AddProjectDialog open={adding} onOpenChange={setAdding} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SettingsMenu />
        <NewTabButton />
        <QuitButton />
        <ServerStatus />
      </SidebarFooter>
    </>
  );
}

/** Settings sections: Appearance and Tools (Agents and Notifications arrive with later epics). */
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
        <DropdownMenuItem asChild onSelect={() => setSheetOpen(false)}>
          <Link to="/settings/tools">
            <Wrench aria-hidden />
            Tools
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
