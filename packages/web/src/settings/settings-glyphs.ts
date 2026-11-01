import { Bell, DesktopTower, Folders, Palette, Robot, Sliders, TerminalWindow, type Icon } from '@phosphor-icons/react';
import type { SettingsGlyph } from './settings-groups';

/** Each settings group's Phosphor glyph (DESIGN.md settings-nav), for the nav and the command palette's Settings actions. */
export const SETTINGS_GLYPHS: Record<SettingsGlyph, Icon> = { Robot, Folders, Palette, Bell, TerminalWindow, DesktopTower, Sliders };
