import { modifierShortcutLabel } from '@/ui/platform';
import type { ShortcutTableGroup, ShortcutTableRow } from '@/ui/shortcut-table';

/*
 * The keyboard shortcuts Ogden Agents has (EXPERIENCE.md Keyboard), the one
 * table behind Help's Keyboard shortcuts dialog (epic 26, 26.5). Each row is
 * a shortcut that exists in the code; add a row here when one is added.
 */

/** A shortcut row and a group of them: the shapes Help's `ShortcutTable` renders. */
export type KeyboardShortcut = ShortcutTableRow;
export type KeyboardShortcutGroup = ShortcutTableGroup;

/** The groups and their shortcuts, as this computer writes them (`⌘.` on Apple devices, `Ctrl+.` elsewhere). */
export function keyboardShortcuts(platform?: string): readonly KeyboardShortcutGroup[] {
  return [
    {
      label: 'Go to',
      shortcuts: [
        { keys: [[modifierShortcutLabel('K', platform)]], action: 'Command palette' },
        { keys: [['g'], ['n']], action: 'New chat', where: 'In a project; elsewhere opens the palette' },
        { keys: [[modifierShortcutLabel('N', platform)]], action: 'New chat', where: 'In the desktop app; a browser tab keeps it' },
        { keys: [['g'], ['c']], action: 'Chats', where: 'In a project' },
        { keys: [['g'], ['s']], action: 'Workbench Search', where: 'In a project' },
        { keys: [['g'], ['p']], action: 'Plan', where: 'In a project, with Planning on' },
        { keys: [['g'], ['b']], action: 'Board', where: 'In a project, with the Board on' },
        { keys: [['g'], ['r']], action: 'Runs', where: 'In a project, with Builds on' },
        { keys: [['g'], ['o']], action: 'Orchestrate', where: 'In a project, with Orchestration on' },
        { keys: [['g'], ['t']], action: 'Terminals', where: 'In a project, in Developer mode' },
        { keys: [['g'], ['y']], action: 'The next Needs you item' },
      ],
    },
    {
      label: 'Sidebar',
      shortcuts: [
        { keys: [[']']], action: 'Next Needs you row', where: 'In Needs you' },
        { keys: [['[']], action: 'Previous Needs you row', where: 'In Needs you' },
        { keys: [['F2']], action: 'Rename the chat', where: 'On a chat row' },
      ],
    },
    {
      label: 'Chat',
      shortcuts: [
        { keys: [['Enter']], action: 'Send', where: 'In the message box' },
        { keys: [['1']], action: 'Allow once', where: 'On a permission card' },
        { keys: [['2']], action: 'Always allow', where: 'On a permission card' },
        { keys: [['3']], action: 'Deny', where: 'On a permission card' },
        { keys: [[modifierShortcutLabel('.', platform)]], action: 'Switch between Chat and Terminal', where: 'In Developer mode' },
      ],
    },
  ];
}
