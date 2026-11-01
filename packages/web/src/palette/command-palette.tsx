import { useParams, useRouterState } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAppearance } from '@/appearance/appearance-provider';
import { isInsideOverlay } from '@/shell/keyboard-guard';
import {
  CommandPalette as CommandPaletteSurface,
  CommandPaletteEmpty,
  CommandPaletteField,
  CommandPaletteGroup,
  CommandPaletteList,
  CommandPaletteMatch,
  CommandPaletteOption,
  CommandPaletteStatus,
} from '@/ui/command-palette';
import { StateGlyph } from '@/ui/state-glyph';
import { rankItems, type RankedItem } from './palette-match';
import {
  PALETTE_EMPTY_ORDER,
  PALETTE_GROUP_LABELS,
  PALETTE_GROUP_ORDER,
  PALETTE_SOURCES,
  RECENT_CHATS_LABEL,
  useNewChatInItems,
  type PaletteContext,
  type PaletteGroupId,
  type PaletteItem,
} from './palette-sources';
import { closeCommandPalette, openCommandPalette, paletteReturnTarget, paletteState, setCommandPaletteMode, usePaletteState } from './palette-store';
import { recordRecentChat } from './recent-chats';

/**
 * The command palette (epic 26 story 3; EXPERIENCE.md Command palette):
 * Cmd/Ctrl+K anywhere, the composer too, opens it (and closes it again).
 * The empty query shows Recent chats, Actions and Projects; typing matches
 * Chats, Projects, Files (the current project's, by name; 8.11), Tickets
 * (the current project's, with the Board on) and Actions. `↑` `↓` move
 * (wrapping), staying on the same row as later results (Files) arrive;
 * Enter runs, Esc closes with focus back
 * where it was; a run that navigates leaves focus to the destination.
 * "New chat in..." lists the projects; Esc or Backspace on its empty field
 * goes back to everything. Mounted once per tab in the shell, where it also
 * records each chat opened for Recent chats.
 */

export const PALETTE_TITLE = 'Command palette';
export const PALETTE_PLACEHOLDER = 'Search projects, chats, files and actions';
export const NEW_CHAT_IN_PREFIX = 'New chat in...';
export const NEW_CHAT_IN_PLACEHOLDER = 'Search projects';

/** The no-match line, with typographic quotes. */
export const nothingMatches = (query: string) => (query.trim() === '' ? 'Nothing matches.' : `Nothing matches “${query}”.`);

/** The polite count. */
export const resultCount = (count: number) => (count === 1 ? '1 result' : `${count} results`);

/** Whether a key press is Cmd/Ctrl+K: Ctrl+K inside a terminal is the shell's (kill line); Cmd+K always counts. */
export function isPaletteKey(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target' | 'isComposing'>): boolean {
  if (event.altKey || event.shiftKey || event.isComposing) return false;
  const key = event.key.toLowerCase();
  // A non-Latin layout (Cyrillic, Greek) types another letter on the K key: its physical key counts there; a Latin layout (Dvorak) keeps its own `k`.
  const isK = key === 'k' || (!/^[a-z]$/.test(key) && event.code === 'KeyK');
  if (!isK) return false;
  if (event.metaKey) return true;
  if (!event.ctrlKey) return false;
  const target = event.target;
  return !(target instanceof Element && target.closest('.xterm') !== null);
}

const inPalette = (target: EventTarget | null) => target instanceof Element && target.closest('[data-slot="command-palette"]') !== null;

/** The chat on screen (`/w/:wsId/s/:sesId`), if any. */
function useChatOnScreen(pathname: string, wsId: string | undefined, sesId: string | undefined): string | undefined {
  return wsId !== undefined && sesId !== undefined && /^\/w\/[^/]+\/s\/[^/]+\/?$/.test(pathname) ? sesId : undefined;
}

function Glyph({ item }: { item: PaletteItem }) {
  if ('state' in item.glyph) return <StateGlyph state={item.glyph.state} labelMode="none" />;
  const Icon = item.glyph.icon;
  return <Icon aria-hidden />;
}

export function CommandPalette() {
  const { open, mode } = usePaletteState();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const params = useParams({ strict: false }) as { wsId?: string; sesId?: string };
  const sesId = useChatOnScreen(pathname, params.wsId, params.sesId);
  const { appearance } = useAppearance();
  const [query, setQuery] = useState('');
  // The selected row's id (`null`: the first row), so rows arriving later (Files) never move it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Whether closing puts focus back where it was: not after a run that navigates.
  const returnFocus = useRef(true);
  const baseId = useId();
  const listId = `${baseId}-list`;

  // Recent chats: each chat opened in this tab.
  useEffect(() => {
    if (params.wsId !== undefined && sesId !== undefined) recordRecentChat(params.wsId, sesId);
  }, [params.wsId, sesId]);

  // Cmd/Ctrl+K: opens, or closes an open palette. Capture phase, so it wins over a field's own keys.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isPaletteKey(event)) return;
      const active = document.activeElement;
      if (paletteState().open) {
        event.preventDefault();
        closeCommandPalette();
        return;
      }
      // Never a second modal over an open dialog, alert dialog or menu.
      if ((isInsideOverlay(active) && !inPalette(active)) || (isInsideOverlay(event.target) && !inPalette(event.target))) return;
      event.preventDefault();
      openCommandPalette();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Each open, and each mode, starts on an empty field at the first row.
  useEffect(() => {
    setQuery('');
    setSelectedId(null);
    if (open) returnFocus.current = true;
  }, [open, mode]);

  const ctx: PaletteContext = { open, mode, query, wsId: params.wsId, sesId, pathname, developerMode: appearance.developerMode };
  // A constant list: the same hooks in the same order on every render.
  const sourced: PaletteItem[] = [];
  for (const source of PALETTE_SOURCES) sourced.push(...source.useItems(ctx));
  const newChatIn = useNewChatInItems();

  // Ranked every render: the items' runs close over the current page, and a few hundred rows rank in no time.
  const results: RankedItem<PaletteItem>[] =
    mode === 'new-chat-in' ? rankItems(query, newChatIn, ['projects']) : rankItems(query, sourced, query.trim() === '' ? PALETTE_EMPTY_ORDER : PALETTE_GROUP_ORDER);

  const found = selectedId === null ? -1 : results.findIndex((ranked) => ranked.item.id === selectedId);
  const current = found === -1 ? 0 : found;
  const firstId = results[0]?.item.id;
  // Nothing chosen yet: the first row as it is now is the one chosen.
  useEffect(() => {
    if (selectedId === null && firstId !== undefined) setSelectedId(firstId);
  }, [selectedId, firstId]);
  const optionId = (index: number) => `${baseId}-option-${index}`;

  useEffect(() => {
    if (!open || results.length === 0) return;
    const element = document.getElementById(optionId(current));
    if (typeof element?.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' });
  }, [open, current, results.length]);

  const run = (item: PaletteItem) => {
    if (item.mode !== undefined) {
      setCommandPaletteMode(item.mode);
      return;
    }
    returnFocus.current = item.returnFocus === true;
    closeCommandPalette();
    item.run?.();
    // A run to the page already shown (Settings: Appearance on its own page) moves nothing: focus would be lost on the body.
    if (!returnFocus.current) {
      requestAnimationFrame(() => {
        if (document.activeElement === null || document.activeElement === document.body) paletteReturnTarget()?.focus();
      });
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSelectedId(results[(current + step + results.length) % results.length]!.item.id);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[current];
      if (chosen !== undefined) run(chosen.item);
      return;
    }
    if (event.key === 'Backspace' && query === '' && mode !== 'all') {
      event.preventDefault();
      setCommandPaletteMode('all');
    }
  };

  // The groups as they show, each with the results' indices.
  const groups: { group: PaletteGroupId; heading: string; rows: { ranked: RankedItem<PaletteItem>; index: number }[] }[] = [];
  results.forEach((ranked, index) => {
    const last = groups.at(-1);
    if (last !== undefined && last.group === ranked.item.group) {
      last.rows.push({ ranked, index });
      return;
    }
    const group = ranked.item.group;
    const heading = mode === 'new-chat-in' ? PALETTE_GROUP_LABELS.projects : group === 'chats' && query.trim() === '' ? RECENT_CHATS_LABEL : PALETTE_GROUP_LABELS[group];
    groups.push({ group, heading, rows: [{ ranked, index }] });
  });

  return (
    <CommandPaletteSurface
      open={open}
      onOpenChange={(next) => {
        if (!next) closeCommandPalette();
      }}
      title={PALETTE_TITLE}
      data-testid="command-palette"
      data-mode={mode}
      onEscapeKeyDown={(event) => {
        // "New chat in...": Esc goes back to everything first.
        if (mode !== 'all') {
          event.preventDefault();
          setCommandPaletteMode('all');
        }
      }}
      onCloseAutoFocus={(event) => {
        // The palette has no trigger: focus goes back to what had it, unless a run went elsewhere.
        event.preventDefault();
        if (returnFocus.current) paletteReturnTarget()?.focus();
      }}
    >
      <CommandPaletteField
        aria-label={mode === 'new-chat-in' ? NEW_CHAT_IN_PREFIX : PALETTE_TITLE}
        aria-controls={listId}
        aria-expanded={results.length > 0}
        aria-activedescendant={results.length === 0 ? undefined : optionId(current)}
        placeholder={mode === 'new-chat-in' ? NEW_CHAT_IN_PLACEHOLDER : PALETTE_PLACEHOLDER}
        prefix={mode === 'new-chat-in' ? NEW_CHAT_IN_PREFIX : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelectedId(null);
        }}
        onKeyDown={onKeyDown}
        data-testid="command-palette-field"
      />
      {results.length === 0 ? <CommandPaletteEmpty data-testid="command-palette-empty">{nothingMatches(query)}</CommandPaletteEmpty> : null}
      {/* With nothing to list the listbox stays (the field controls it) but is empty and hidden. */}
      <CommandPaletteList id={listId} aria-label="Results" hidden={results.length === 0} data-testid="command-palette-list">
        {groups.map(({ group, heading, rows }) => (
          <CommandPaletteGroup key={group} heading={heading} headingId={`${baseId}-group-${group}`} data-testid={`command-palette-group-${group}`}>
            {rows.map(({ ranked, index }) => (
              <CommandPaletteOption
                key={ranked.item.id}
                id={optionId(index)}
                selected={index === current}
                glyph={<Glyph item={ranked.item} />}
                label={<CommandPaletteMatch text={ranked.item.label} indices={ranked.indices} />}
                context={ranked.item.context}
                keys={appearance.developerMode ? ranked.item.keys : undefined}
                onMouseMove={() => {
                  if (index !== current) setSelectedId(ranked.item.id);
                }}
                onClick={() => run(ranked.item)}
                data-testid="command-palette-option"
                data-id={ranked.item.id}
              />
            ))}
          </CommandPaletteGroup>
        ))}
      </CommandPaletteList>
      <CommandPaletteStatus data-testid="command-palette-status">{results.length === 0 ? nothingMatches(query) : resultCount(results.length)}</CommandPaletteStatus>
    </CommandPaletteSurface>
  );
}
