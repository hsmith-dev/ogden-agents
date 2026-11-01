import { useDeveloperModeOn } from '@/appearance/appearance-provider';
import { SettingsContent, SettingsFrame, SettingsNavColumn, SettingsNavGroup, SettingsNavItem, SettingsNavSubItem, SettingsSelectRow } from '@/ui/settings-nav';
import { Bell, DesktopTower, Folders, Palette, Robot, Sliders, TerminalWindow, type Icon } from '@phosphor-icons/react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useId, type KeyboardEvent } from 'react';
import { currentSettingsPage, settingsGroupFor, visibleSettingsGroups, type SettingsGlyph } from './settings-groups';

const GLYPHS: Record<SettingsGlyph, Icon> = { Robot, Folders, Palette, Bell, TerminalWindow, DesktopTower, Sliders };

/** `↑` and `↓` move focus between the nav's links, stopping at the ends (EXPERIENCE.md Settings navigation). */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[href]')];
  const index = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (index === -1) return;
  event.preventDefault();
  const next = event.key === 'ArrowDown' ? Math.min(index + 1, links.length - 1) : Math.max(index - 1, 0);
  links[next]!.focus();
}

/**
 * Every `/settings/*` page inside the grouped nav (epic 26, E26-R7): seven
 * groups on the left that stay while moving between them, the current
 * group's pages as sub-links; below md, a select under the page header.
 * Pages are fragments (header, body), so the content column puts the header
 * first and the select lands between it and the body with no page edits.
 */
export function SettingsLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const developerMode = useDeveloperModeOn();
  const navigate = useNavigate();
  const selectId = useId();
  const groups = visibleSettingsGroups(pathname, developerMode);
  const currentGroup = settingsGroupFor(pathname);
  const currentPage = currentSettingsPage(pathname);

  return (
    <SettingsFrame>
      <SettingsNavColumn label="Settings" title="Settings" onKeyDown={moveFocus} data-testid="settings-nav">
        {groups.map((group) => {
          const Glyph = GLYPHS[group.glyph];
          const isCurrent = group.id === currentGroup?.id;
          const hasSubPages = group.pages.length > 1;
          return (
            <SettingsNavGroup
              key={group.id}
              subItems={
                isCurrent && hasSubPages
                  ? group.pages.map((page) => (
                      <SettingsNavSubItem key={page.to} asChild current={page.to === currentPage?.to}>
                        <Link to={page.to}>{page.label}</Link>
                      </SettingsNavSubItem>
                    ))
                  : undefined
              }
            >
              {/* With sub-links, the sub-link is the page: the group row is selected text, not a second link to it. */}
              <SettingsNavItem asChild current={isCurrent && !hasSubPages} selected={isCurrent}>
                {isCurrent && hasSubPages ? (
                  <span>
                    <Glyph aria-hidden />
                    {group.label}
                  </span>
                ) : (
                  <Link to={group.pages[0]!.to}>
                    <Glyph aria-hidden />
                    {group.label}
                  </Link>
                )}
              </SettingsNavItem>
            </SettingsNavGroup>
          );
        })}
      </SettingsNavColumn>
      <SettingsContent>
        <SettingsSelectRow
          id={selectId}
          label="Settings page"
          data-testid="settings-select"
          value={currentPage?.to ?? ''}
          onChange={(event) => {
            void navigate({ to: event.target.value });
          }}
        >
          {currentPage === undefined ? <option value="" disabled /> : null}
          {groups.map((group) => (
            <optgroup key={group.id} label={group.label}>
              {group.pages.map((page) => (
                <option key={page.to} value={page.to}>
                  {page.label}
                </option>
              ))}
            </optgroup>
          ))}
        </SettingsSelectRow>
        <Outlet />
      </SettingsContent>
    </SettingsFrame>
  );
}
