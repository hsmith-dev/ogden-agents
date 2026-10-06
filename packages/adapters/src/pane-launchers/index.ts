/**
 * The launcher list as data (epic 16, stories 16.3, 16.5): what a terminal
 * pane can run. Core and shared name no program; this is the one place that
 * does. Each CLI is found by detection and never installed by Ogden; the user
 * signs in inside the CLI, so Ogden never sees or stores its credentials.
 * Executable names and install places come from each vendor's public docs
 * (spike 16.1) and are confirmed by the user's own live checks. Every
 * launcher passes `PaneLauncher`.
 */
import { PaneLauncher, type PanePromptPattern } from '@ogden-agents/shared';

export * from './detect.js';

/**
 * Conservative prompt patterns every CLI launcher starts with (spike 16.1
 * finding 13): a question that ends in (y/n), "press enter", a numbered menu
 * whose first choice is yes, and a "do you want to proceed" question. Status
 * is a guess; the real wording is the user's live check, and each launcher
 * can have its own once it is known. Data, so a change needs no code release.
 */
export const CLI_PROMPT_PATTERNS: readonly PanePromptPattern[] = [
  { name: 'yes-no', pattern: '\\((y/n|Y/n|y/N)\\)|\\[(y/n|Y/n|y/N)\\]', depth: 1 },
  { name: 'press-enter', pattern: 'press (enter|return) to continue', depth: 1 },
  { name: 'menu-yes', pattern: '[❯>]\\s*1\\.\\s*yes', depth: 4 },
  // On the last line only: older text above an answered question is not a question any more. A menu under it is the `menu-yes` pattern.
  { name: 'proceed', pattern: 'do you want to (proceed|continue|allow|make this edit)', depth: 1 },
];

const cli = (data: Record<string, unknown>) => PaneLauncher.parse({ kind: 'cli', promptPatterns: CLI_PROMPT_PATTERNS, ...data });

/** The user's own shell: found at spawn by absolute path (`defaultPaneShell`), so it lists no executable. */
export const SHELL_LAUNCHER: PaneLauncher = PaneLauncher.parse({ id: 'shell', label: 'Shell', kind: 'shell', executables: {} });

export const CLAUDE_CODE_LAUNCHER = cli({
  id: 'claude-code',
  label: 'Claude Code',
  executables: {
    darwin: ['claude', '~/.local/bin/claude', '~/.claude/local/claude', '~/.npm-global/bin/claude', '/opt/homebrew/bin/claude', '/usr/local/bin/claude'],
    linux: ['claude', '~/.local/bin/claude', '~/.claude/local/claude', '~/.npm-global/bin/claude', '/usr/local/bin/claude'],
    win32: ['claude', '%USERPROFILE%\\.local\\bin\\claude.exe', '%APPDATA%\\npm\\claude.cmd'],
  },
  installUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
  resumeHint: 'Run claude --resume to pick up an earlier session.',
});

export const CODEX_LAUNCHER = cli({
  id: 'codex',
  label: 'Codex',
  executables: {
    darwin: ['codex', '~/.npm-global/bin/codex', '/opt/homebrew/bin/codex', '/usr/local/bin/codex'],
    linux: ['codex', '~/.npm-global/bin/codex', '/usr/local/bin/codex'],
    win32: ['codex', '%APPDATA%\\npm\\codex.cmd'],
  },
  installUrl: 'https://github.com/openai/codex',
  resumeHint: 'Run codex resume to pick up an earlier session.',
});

export const GROK_LAUNCHER = cli({
  id: 'grok',
  label: 'Grok',
  executables: {
    darwin: ['grok', '~/.local/bin/grok', '~/.grok/bin/grok', '~/.npm-global/bin/grok', '/opt/homebrew/bin/grok'],
    linux: ['grok', '~/.local/bin/grok', '~/.grok/bin/grok', '~/.npm-global/bin/grok'],
    win32: ['grok', '%USERPROFILE%\\.grok\\bin\\grok.exe', '%APPDATA%\\npm\\grok.cmd'],
  },
  installUrl: 'https://x.ai/cli',
  resumeHint: 'Run grok --resume to pick up an earlier session.',
});

export const ANTIGRAVITY_LAUNCHER = cli({
  id: 'antigravity',
  label: 'Antigravity',
  executables: {
    darwin: ['agy', '~/.local/bin/agy', '/usr/local/bin/agy'],
    linux: ['agy', '~/.local/bin/agy', '/usr/local/bin/agy'],
    win32: ['agy', '%LOCALAPPDATA%\\agy\\bin\\agy.exe'],
  },
  installUrl: 'https://antigravity.google',
});

/** Only when it is already installed: Google's consumer plans moved to Antigravity (spike 16.1), so a missing Gemini is not offered. */
export const GEMINI_LAUNCHER = cli({
  id: 'gemini',
  label: 'Gemini',
  executables: {
    darwin: ['gemini', '~/.npm-global/bin/gemini', '/opt/homebrew/bin/gemini', '/usr/local/bin/gemini'],
    linux: ['gemini', '~/.npm-global/bin/gemini', '/usr/local/bin/gemini'],
    win32: ['gemini', '%APPDATA%\\npm\\gemini.cmd'],
  },
  installUrl: 'https://github.com/google-gemini/gemini-cli',
  showWhenMissing: false,
});

/** Interactive only (E16-R9): never fed by Ogden, never started on a schedule or by another agent, and left out of any automation. */
export const COPILOT_LAUNCHER = cli({
  id: 'copilot',
  label: 'Copilot',
  executables: {
    darwin: ['copilot', '~/.npm-global/bin/copilot', '/opt/homebrew/bin/copilot', '/usr/local/bin/copilot'],
    linux: ['copilot', '~/.npm-global/bin/copilot', '/usr/local/bin/copilot'],
    win32: ['copilot', '%APPDATA%\\npm\\copilot.cmd', '%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\copilot.exe'],
  },
  installUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli',
  termsNote: 'interactive_only',
});

/** Every launcher, in the order the page offers them. */
export const PANE_LAUNCHERS: readonly PaneLauncher[] = [SHELL_LAUNCHER, CLAUDE_CODE_LAUNCHER, CODEX_LAUNCHER, GROK_LAUNCHER, ANTIGRAVITY_LAUNCHER, COPILOT_LAUNCHER, GEMINI_LAUNCHER];
