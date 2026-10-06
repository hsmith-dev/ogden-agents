import { z } from 'zod';
import { PaneId, WorkspaceId } from './ids.js';
import { SessionTerminal, TerminalExitFrame, TerminalSizeFrame } from './terminal.js';

/**
 * The terminal pane contract (epic 16, story 16.2; story 16.3 freezes the
 * rest): a pane is one pseudo-terminal the server owns, running one launcher
 * in a project folder, shown by xterm in Developer mode only (E16-R1, R3).
 *
 * What a pane prints and what the user types are the user's content: they
 * travel only as binary frames on the pane socket (`PANE_SOCKET_ROUTE`) and
 * are never evented, stored or logged (AD-6, AD-16). Nothing here names a CLI.
 */

/** Panes a project may have at once (epic 16 assumption: adjustable constants). */
export const MAX_PANES_PER_PROJECT = 8;
/** Panes the whole install may have at once. */
export const MAX_PANES_PER_INSTALL = 16;

/**
 * Where a pane is in its life (E16-R11, spike 16.1 finding 2):
 * - `starting`: the program was started and has printed nothing yet (Windows
 *   ConPTY can hold the first output back; the page offers Restart pane).
 * - `running`: it has printed.
 * - `exited`: the program ended, by itself or by Restart or close.
 * - `stopped` (story 16.7): the pane came back after the server stopped, or Developer mode was
 *   turned off: it is kept as a shape and starts a fresh program when the user presses Start.
 */
export const PaneState = z.enum(['starting', 'running', 'exited', 'stopped']);
export type PaneState = z.infer<typeof PaneState>;

/** The launchers a pane can run. The tracer has only the user's own shell; story 16.5 adds the CLIs as data. */
export const PaneLauncherId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
export type PaneLauncherId = z.infer<typeof PaneLauncherId>;

/**
 * What a pane seems to be doing, a guess (story 16.6; E16-R6): derived in
 * memory from the pane's activity and a launcher's prompt patterns, never from
 * stored output. `working` while it prints, `needs_attention` at a prompt
 * waiting for the user (silence alone never says it), `idle` after it has been
 * quiet, `exited` once its program ended.
 */
export const PaneStatus = z.enum(['working', 'needs_attention', 'idle', 'exited']);
export type PaneStatus = z.infer<typeof PaneStatus>;

/** A pane's or tab's name: plain words with no control or format characters. It is stored and broadcast, so it is never taken from terminal output. */
export const PaneTitle = z.string().min(1).max(80).regex(/^[^\p{Cc}\p{Cf}]+$/u, 'a name has no control characters');

export const Pane = z.object({
  id: PaneId,
  workspaceId: WorkspaceId,
  launcherId: PaneLauncherId,
  /** What the pane is called in the page (plain words). */
  title: PaneTitle,
  state: PaneState,
  /** A guess at what it is doing (story 16.6). Never certain: the page says so. */
  status: PaneStatus.default('working'),
  /** The program's own exit code once `exited`; `null` while it runs or when it was stopped. */
  exitCode: z.number().int().nullable(),
});
export type Pane = z.infer<typeof Pane>;


/**
 * One prompt pattern of a launcher, as data so a change in a CLI's wording
 * needs no code release (E16-R6): a regular expression (source, no flags;
 * matched without case) tried against the last `depth` non empty lines of the
 * pane's screen. A one line question is only a question while it is the
 * last line; a menu spans several (spike 16.1 finding 13).
 */
export const PanePromptPattern = z.object({
  name: z.string().min(1).max(40),
  pattern: z
    .string()
    .min(1)
    .max(300)
    .refine((source) => {
      try {
        new RegExp(source, 'i');
        return true;
      } catch {
        return false;
      }
    }, 'not a valid pattern')
    // A repeated group is the usual way to a runaway match, so none is allowed (a heuristic: the launcher list is the adapters' own data, and a pattern is also cut to short lines when matched).
    .refine((source) => !/(?<!\\)\)[+*{]/.test(source), 'a pattern may not repeat a group'),
  depth: z.number().int().min(1).max(20),
});
export type PanePromptPattern = z.infer<typeof PanePromptPattern>;

/** A program name to look up on the PATH (never a relative path), or an absolute path: `/…`, `~/…`, `C:\…` or a `%LOCALAPPDATA%`, `%APPDATA%`, `%ProgramFiles%`, `%USERPROFILE%` prefix. */
const PaneExecutable = z
  .string()
  .min(1)
  .max(260)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value) && !/(^|[\\/])\.\.([\\/]|$)/.test(value), 'no control characters or ..')
  .refine((value) => /^[A-Za-z0-9._-]{1,64}$/.test(value) || /^(\/|~\/|[A-Za-z]:[\\/]|%(LOCALAPPDATA|APPDATA|ProgramFiles|ProgramFiles\(x86\)|USERPROFILE)%[\\/])/.test(value), 'a program name, or an absolute path');

/** Where to look for a launcher's program, by OS: names looked up on the user's PATH, then fixed install folders (`~` is the user's home; `%NAME%` a Windows variable). Detection never installs. */
export const PaneExecutables = z.object({
  darwin: z.array(PaneExecutable).max(8).default([]),
  linux: z.array(PaneExecutable).max(8).default([]),
  win32: z.array(PaneExecutable).max(8).default([]),
});
export type PaneExecutables = z.infer<typeof PaneExecutables>;

/**
 * A launcher: what a pane runs, as data (story 16.3; E16-R1, R5, R9). Core
 * and shared name no CLI: the adapters hold the list. `args` are the only
 * arguments Ogden ever adds, and never one that skips a permission prompt;
 * the rest is what the user types in the launcher's visible argument field.
 */
export const PaneLauncher = z.object({
  id: PaneLauncherId,
  /** What the page calls it. */
  label: z.string().min(1).max(40),
  /** `shell` is the user's own shell; `cli` is an agent's own program, found by detection. */
  kind: z.enum(['shell', 'cli']),
  executables: PaneExecutables,
  /** The vendor's own install page, shown when the program is not found (Ogden never installs it). */
  installUrl: z.url().refine((url) => url.startsWith('https://'), 'an https link').optional(),
  /** Arguments always passed (none that skip a permission prompt). */
  defaultArgs: z.array(z.string().max(200).regex(/^[A-Za-z0-9._=:/@+-]+$/, 'a plain argument')).max(10).default([]),
  /** The words that say the program waits for the user. */
  promptPatterns: z.array(PanePromptPattern).max(20).default([]),
  /** How the program's own resume is offered for a stopped pane (plain words; `{id}` is its session id), if it has one. */
  resumeHint: z.string().max(200).optional(),
  /** `interactive_only`: never fed, scheduled or driven by Ogden, and left out of any automation (E16-R9). */
  termsNote: z.enum(['interactive_only']).optional(),
  /** `false`: the launcher is offered only when its program is found (a CLI Ogden does not lead with). Default `true`: a missing program shows its install link. */
  showWhenMissing: z.boolean().default(true),
});
export type PaneLauncher = z.infer<typeof PaneLauncher>;

/**
 * What detection found for one launcher (story 16.5; E16-R5). Found by looking
 * on the user's PATH and well known folders and asking the program for its
 * version, with nothing installed and nothing else run. `failed`: it is there
 * but did not answer. `reason` is plain words.
 */
export const PaneDetection = z.object({
  launcherId: PaneLauncherId,
  state: z.enum(['found', 'not_found', 'failed']),
  /** The program's own one line answer to its version request, shortened. */
  version: z.string().max(80).optional(),
  reason: z.string().max(200).optional(),
});
export type PaneDetection = z.infer<typeof PaneDetection>;

/** One launcher as the page shows it: its data and what detection found. A launcher not found and not to be shown is left out. */
export const PaneLauncherStatus = z.object({ launcher: PaneLauncher, detection: PaneDetection });
export type PaneLauncherStatus = z.infer<typeof PaneLauncherStatus>;

/** `GET` or `POST` the launchers (story 16.5): the list with detection; `POST` (the Detect button) looks again. */
export const PaneLaunchersResponse = z.object({ launchers: z.array(PaneLauncherStatus) });
export type PaneLaunchersResponse = z.infer<typeof PaneLaunchersResponse>;

/** The text a user types in a launcher's visible argument field: plain, up to 500 characters, no control characters. */
export const PaneLauncherArgs = z.string().max(500).regex(/^[^\p{Cc}]*$/u, 'no control characters');

/** A tab's split tree (E16-R4): a pane, or two children side by side (`row`) or stacked (`column`) at `ratio` for the first. */
export type PaneLayoutNode = { type: 'pane'; paneId: PaneId } | { type: 'split'; direction: 'row' | 'column'; ratio: number; first: PaneLayoutNode; second: PaneLayoutNode };
export const PaneLayoutNode: z.ZodType<PaneLayoutNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('pane'), paneId: PaneId }),
    z.object({ type: z.literal('split'), direction: z.enum(['row', 'column']), ratio: z.number().min(0.1).max(0.9), first: PaneLayoutNode, second: PaneLayoutNode }),
  ]),
);

/** A project's terminal workspace layout: tabs of split trees of panes. It holds ids, titles and shapes, never output or secrets (E16-R8). */
const PaneTabId = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);
export const PaneLayoutTab = z.object({ id: PaneTabId, title: PaneTitle.refine((title) => title.trim() !== '', 'a name'), root: PaneLayoutNode });
export type PaneLayoutTab = z.infer<typeof PaneLayoutTab>;
/** How many panes a tree holds, and how deep it goes. */
function measure(node: PaneLayoutNode, depth = 1): { leaves: number; depth: number } {
  if (node.type === 'pane') return { leaves: 1, depth };
  const a = measure(node.first, depth + 1);
  const b = measure(node.second, depth + 1);
  return { leaves: a.leaves + b.leaves, depth: Math.max(a.depth, b.depth) };
}
export const PaneLayout = z
  .object({ tabs: z.array(PaneLayoutTab).max(MAX_PANES_PER_PROJECT), activeTabId: PaneTabId.nullable() })
  .refine((layout) => layout.tabs.reduce((sum, tab) => sum + measure(tab.root).leaves, 0) <= MAX_PANES_PER_PROJECT, 'more panes than a project may have')
  .refine((layout) => layout.tabs.every((tab) => measure(tab.root).depth <= 16), 'a layout nested too deep');
export type PaneLayout = z.infer<typeof PaneLayout>;

/**
 * The install's Terminals settings (stories 16.8, 16.9): opt in notifications
 * (off by default, state and pane label only, never terminal text), what the
 * pane environment adds on request (a proxy URL can hold a password; the SSH
 * agent lets a pane use the user's keys), each launcher's visible argument
 * field, and hiding the surface. The caps are constants, not settings.
 */
export const TerminalsSettings = z.object({
  notifyNeedsAttention: z.boolean().default(false),
  notifyExited: z.boolean().default(false),
  /** Launchers whose notifications are on, by launcher id (per launcher opt in). */
  notifyLaunchers: z.array(PaneLauncherId).default([]),
  passProxies: z.boolean().default(false),
  passSshAgent: z.boolean().default(false),
  /** What the user types after a launcher's own arguments, by launcher id. */
  launcherArgs: z.record(PaneLauncherId, PaneLauncherArgs).default({}),
  hidden: z.boolean().default(false),
});
export type TerminalsSettings = z.infer<typeof TerminalsSettings>;

const size = {
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(500),
};

/** Where a new pane goes (story 16.4): in a tab of its own (the default), or split beside (`row`) or under (`column`) a pane of the project. */
export const PanePlacement = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tab') }),
  z.object({ kind: z.literal('split'), paneId: PaneId, direction: z.enum(['row', 'column']) }),
]);
export type PanePlacement = z.infer<typeof PanePlacement>;

/** `POST` panes: the size the viewer's terminal has now, so the program starts at it, and where the pane goes. */
export const OpenPaneRequest = z.object({ ...size, placement: PanePlacement.optional(), launcherId: PaneLauncherId.optional(), args: PaneLauncherArgs.optional() });
export type OpenPaneRequest = z.infer<typeof OpenPaneRequest>;

/** `POST` pane restart: the size to start at. */
export const RestartPaneRequest = z.object({ ...size, /** What the user typed in the launcher's field (a stopped pane is started again with them). */ args: PaneLauncherArgs.optional() });
export type RestartPaneRequest = z.infer<typeof RestartPaneRequest>;

export const PaneResponse = z.object({ pane: Pane });
export type PaneResponse = z.infer<typeof PaneResponse>;

/** `GET` panes: the project's panes, oldest first, and whether a pane can open on this computer now. */
export const PanesResponse = z.object({
  panes: z.array(Pane),
  /** The project's layout: tabs of split trees of these panes (story 16.4). */
  layout: PaneLayout,
  terminal: SessionTerminal,
  limits: z.object({ perProject: z.number().int(), perInstall: z.number().int() }),
});
export type PanesResponse = z.infer<typeof PanesResponse>;

/** `PUT` layout (story 16.4): the arrangement only (ratios, tab names and order, the active tab, which pane sits where); the same panes, each once. */
export const ArrangePanesRequest = z.object({ layout: PaneLayout });
export type ArrangePanesRequest = z.infer<typeof ArrangePanesRequest>;

/** `PATCH` pane (story 16.4): rename it. */
export const RenamePaneRequest = z.object({ title: PaneTitle });
export type RenamePaneRequest = z.infer<typeof RenamePaneRequest>;

/** Server → client on the pane socket: the pane's state now (sent on attach and on every change). */
export const PaneStateFrame = z.object({ type: z.literal('state'), state: PaneState, /** The pane's status guess (story 16.6), sent with every change so its chip needs no refetch. */ status: PaneStatus.optional() });
/**
 * Server → client: what follows is the pane's screen as it is now, not more
 * output: the viewer resets its terminal, then writes the next binary frame
 * (the snapshot, then live output). Sent on attach and after Restart pane.
 */
export const PaneResetFrame = z.object({ type: z.literal('reset') });
/** `exit` here does not close the socket: the pane stays, stopped, and Restart pane starts it again on the same socket. */
export const PaneServerFrame = z.discriminatedUnion('type', [TerminalExitFrame, TerminalSizeFrame, PaneStateFrame, PaneResetFrame]);
export type PaneServerFrame = z.infer<typeof PaneServerFrame>;

/** Close codes of the pane socket, beyond `TERMINAL_CLOSE`'s. */
export const PANE_CLOSE = {
  /** No such pane (the page does not reconnect). */
  notAvailable: 4404,
  /** Developer mode is off (the page does not reconnect; the server refuses every pane route and socket without it). */
  developerModeOff: 4403,
  /** The pane was closed (the page does not reconnect). */
  closed: 4001,
} as const;
