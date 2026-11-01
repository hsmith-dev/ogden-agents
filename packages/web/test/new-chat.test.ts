/**
 * New chat in one step (epic 26, E26-R2): where every way in opens the
 * draft, and the desktop shell's File > New Chat, which dispatches exactly
 * the page's `NEW_CHAT_EVENT` (AD-15: one fixed script, no IPC) on Cmd/Ctrl+N.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NEW_CHAT_EVENT, newChatSearch, newChatTarget } from '../src/chat/new-chat';

const UI_RS = readFileSync(new URL('../../desktop/src-tauri/src/ui.rs', import.meta.url), 'utf8');

describe('the new-chat draft target', () => {
  it('opens the project draft with no search when nothing was picked', () => {
    expect(newChatTarget('ws_1')).toEqual({ to: '/w/$wsId/new', params: { wsId: 'ws_1' }, search: {} });
    expect(newChatTarget('ws_1', { agent: undefined, machine: undefined })).toEqual({ to: '/w/$wsId/new', params: { wsId: 'ws_1' }, search: {} });
  });

  it('carries the picked agent and machine', () => {
    expect(newChatTarget('ws_1', { agent: 'codex', machine: 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W3' })).toEqual({
      to: '/w/$wsId/new',
      params: { wsId: 'ws_1' },
      search: { agent: 'codex', machine: 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W3' },
    });
  });

  it('keeps only string picks from a search', () => {
    expect(newChatSearch({ agent: 'codex', machine: 7, other: 'x' })).toEqual({ agent: 'codex' });
    expect(newChatSearch({ agent: '', machine: ['m'] })).toEqual({});
  });
});

describe('the desktop shell File > New Chat', () => {
  it('evaluates exactly the page event, and nothing else', () => {
    // tests/e2e/new-chat.spec.ts dispatches this same name.
    expect(NEW_CHAT_EVENT).toBe('ogden-agents:new-chat');
    const scripts = [...UI_RS.matchAll(/"(window\.[^"]*)"/g)].map((match) => match[1]);
    expect(scripts).toEqual([`window.dispatchEvent(new Event('${NEW_CHAT_EVENT}'))`]);
    expect(UI_RS.match(/\.eval\(/g)).toHaveLength(1);
    expect(UI_RS).toContain('.eval(NEW_CHAT_SCRIPT)');
  });

  it('binds the menu item to CmdOrCtrl+N', () => {
    expect(UI_RS).toMatch(/MenuItem::with_id\(app, "new_chat", "New Chat", true, Some\("CmdOrCtrl\+N"\)\)/);
    expect(UI_RS).toContain('"new_chat" => new_chat(app)');
  });
});
