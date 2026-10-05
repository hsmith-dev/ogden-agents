import {
  applyBmadPieceChoice,
  BMAD_CAPABILITY_REDUCED_TEXT,
  BMAD_OFF_TEXT,
  BMAD_ON_TEXT,
  BMAD_PIECE_INFO,
  BMAD_PIECES,
  BMAD_PIECES_LIST_LABEL,
  BMAD_SAVE_FAILED_TEXT,
  BMAD_SECTION_INTRO,
  BMAD_SECTION_TITLE,
  BMAD_SETUP_CHECKING_TEXT,
  BMAD_SETUP_OWED_UPGRADE_TEXT,
  BMAD_SETUP_UNUSABLE_TEXT,
  BMAD_USE_DESCRIPTION,
  BMAD_USE_LABEL,
  bmadMainSwitchPieces,
  bmadNeedsUnavailableText,
  bmadPieceNeeds,
  bmadPiecesRunProjectScripts,
  bmadSetupCurrentText,
  bmadUpdateAvailableText,
  canonicalBmadPieces,
  SCRIPT_TRUST_FAILED,
  describeBmadPieceChange,
  WORKSPACE_SETTINGS_BMAD_ANCHOR,
  type BmadPiece,
  type BmadSetupStatus,
} from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { keepSaved } from '@/api/keep-saved';
import { useBmadSetupStatus } from '@/planning/bmad-setup-api';
import { BmadSetupView, useBmadSetup, type BmadSetupMode, type BmadSetupPhase } from '@/planning/bmad-setup-panel';
import { ReducedModeNoticeView, UpgradeButton, UpgradeConfirmDialog } from '@/planning/reduced-mode-notice';
import { Field } from '@/ui/field';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { Switch } from '@/ui/switch';
import { Text } from '@/ui/typography';
import { canTurnOnBmadPiece, ComingSoonBadge } from '@/workspaces/bmad-piece-choice';
import { fetchBmadDetection } from '@/workspaces/bmad-detection-api';
import { ScriptTrustDialog } from '@/workspaces/script-trust-dialog';
import { createLatestGate, trustProjectScripts, updateBmadPieces, useBmadPieces, useWorkspaceSettings } from '@/workspaces/workspace-settings-api';

/**
 * Workspace settings' BMad Method section (story 10.5; CAP-19, AD-22) at
 * `#bmad-method`: a main switch "Use BMad Method in this project", derived
 * (on while any piece is on, never stored), then the four pieces, each with
 * its label, sentence and switch. The shared dependency rule
 * (`applyBmadPieceChoice`) decides what else a choice changes, and one
 * status line says so. A piece this install doesn't ship is greyed, marked
 * Coming soon and can't be turned on; one already on can always be turned
 * off. The section only asks the server; core's guard and availability
 * checks decide (AD-22). Every text comes from `@ogden-agents/shared`.
 *
 * Story 4.2: turning on a piece that runs the project's own BMad Method
 * scripts (a piece's switch, or the main switch) in a project not yet
 * trusted opens the trust dialog first; Allow trusts the project, then
 * saves the choice; Cancel changes nothing.
 *
 * Story 4.3: with Planning or Board on, a status line says where BMad
 * Method's setup stands in the project (`GET …/bmad/setup`): set up with
 * its version, an update, an unfinished setup, what couldn't be read, or
 * Set up. A save that turns on the first of Planning and Board in a project
 * without `_bmad/` starts the setup, and its progress shows here.
 *
 * Entry 4.11: under the status line, one reduced-mode notice per capability
 * the pieces that are on need and the project lacks (the status's
 * `missingCapabilities`), with one Upgrade this project; an unfinished setup
 * in a project with `_bmad/` offers Upgrade this project too (Set up refuses
 * it). Upgrade confirms first, then shows the same progress here.
 */

/** Which pieces this install ships: `true` available, `false` coming soon. */
export type BmadAvailability = Readonly<Record<BmadPiece, boolean>>;

export interface BmadMethodViewProps {
  /** The pieces on (the stored ones, or the choice being saved); `undefined` while loading. */
  pieces: readonly BmadPiece[] | undefined;
  /** What this install ships; `undefined` while loading (nothing can be turned on yet). */
  availability: BmadAvailability | undefined;
  /** A save is in flight. */
  saving: boolean;
  /** The polite status line: what else the last choice changed, or that BMad is on or off. */
  status: string | undefined;
  /** Why a change wasn't saved, or the settings couldn't load. */
  error: string | undefined;
  onToggle: (piece: BmadPiece, on: boolean) => void;
  onUseBmad: (on: boolean) => void;
  /**
   * Rendered above the main switch: story 10.7's note that the repo already
   * has BMad Method files (`workspaces/bmad-settings-slots.tsx`). No wrapper
   * when `undefined`.
   */
  offerSlot?: ReactNode;
  /**
   * Rendered above the main switch: story 10.7's line naming the app-wide
   * default for new projects, with a link to Settings → New projects. No
   * wrapper when `undefined`.
   */
  defaultSlot?: ReactNode;
  /** Rendered below the pieces: story 4.3's setup status line. No wrapper when `undefined`. */
  setupSlot?: ReactNode;
}

/** The needs of `piece` this install doesn't ship and that are not already on (turning it on would be refused). */
function missingNeeds(piece: BmadPiece, pieces: readonly BmadPiece[], availability: BmadAvailability): BmadPiece[] {
  return bmadPieceNeeds(piece).filter((need) => !availability[need] && !pieces.includes(need));
}

/** Whether `piece` may be turned on now: it and what it still needs ship. */
function canTurnOn(piece: BmadPiece, pieces: readonly BmadPiece[], availability: BmadAvailability | undefined): boolean {
  return canTurnOnBmadPiece(pieces, piece, availability === undefined ? undefined : (each) => availability[each]);
}

const HEADING_ID = `${WORKSPACE_SETTINGS_BMAD_ANCHOR}-heading`;

export function BmadMethodView({ pieces, availability, saving, status, error, onToggle, onUseBmad, offerSlot, defaultSlot, setupSlot }: BmadMethodViewProps) {
  const anyOn = pieces !== undefined && pieces.length > 0;
  const mainTarget = availability === undefined ? [] : bmadMainSwitchPieces(BMAD_PIECES.filter((piece) => availability[piece]));
  const mainComingSoon = availability !== undefined && mainTarget.length === 0 && !anyOn;
  return (
    // The heading is a child, not PageSection's title, so the anchor can focus it.
    <PageSection id={WORKSPACE_SETTINGS_BMAD_ANCHOR} aria-labelledby={HEADING_ID} data-testid="bmad-section">
      <h2 id={HEADING_ID} tabIndex={-1} className="m-0 text-heading text-foreground">
        {BMAD_SECTION_TITLE}
      </h2>
      <Text>{BMAD_SECTION_INTRO}</Text>
      {offerSlot === undefined ? null : <div data-testid="bmad-offer-slot">{offerSlot}</div>}
      {defaultSlot === undefined ? null : <div data-testid="bmad-default-slot">{defaultSlot}</div>}
      {pieces === undefined ? null : (
        <div className="flex flex-col gap-2" aria-busy={saving}>
          <Field
            id="bmad-use"
            layout="inline"
            label={BMAD_USE_LABEL}
            className={mainComingSoon ? '[&_label]:text-muted-foreground' : undefined}
            description={
              <>
                {BMAD_USE_DESCRIPTION}
                {mainComingSoon ? <ComingSoonBadge testId="bmad-use-coming-soon" /> : null}
              </>
            }
          >
            <Switch
              id="bmad-use"
              data-testid="bmad-use"
              aria-describedby="bmad-use-description"
              checked={anyOn}
              // Turning BMad off is always allowed (once no save is in flight); on needs something to turn on.
              disabled={saving || (!anyOn && mainTarget.length === 0)}
              onCheckedChange={onUseBmad}
            />
          </Field>
          <ul className="m-0 ml-6 flex list-none flex-col gap-2 p-0" aria-label={BMAD_PIECES_LIST_LABEL} data-testid="bmad-pieces">
            {BMAD_PIECES.map((piece) => {
              const info = BMAD_PIECE_INFO[piece];
              const on = pieces.includes(piece);
              const unavailable = availability !== undefined && !availability[piece];
              const missing = availability === undefined || unavailable ? [] : missingNeeds(piece, pieces, availability);
              const greyed = unavailable || missing.length > 0;
              const id = `bmad-${piece}`;
              return (
                <li key={piece} data-state={on ? 'on' : 'off'} data-available={availability === undefined ? undefined : String(!unavailable)}>
                  <Field
                    id={id}
                    layout="inline"
                    label={info.label}
                    className={greyed ? '[&_label]:text-muted-foreground' : undefined}
                    description={
                      <>
                        {info.sentence}
                        {unavailable ? <ComingSoonBadge testId={`${id}-coming-soon`} /> : null}
                        {missing.length > 0 ? (
                          <>
                            {' '}
                            <span data-testid={`${id}-needs`}>{bmadNeedsUnavailableText(missing)}</span>
                          </>
                        ) : null}
                      </>
                    }
                  >
                    <Switch
                      id={id}
                      data-testid={id}
                      aria-describedby={`${id}-description`}
                      checked={on}
                      // One save at a time, so the server can't end on an older choice. Turning a piece on
                      // needs it and what it needs shipped; turning one off is always allowed (AD-22).
                      disabled={saving || (!on && !canTurnOn(piece, pieces, availability))}
                      onCheckedChange={(next) => onToggle(piece, next)}
                    />
                  </Field>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <Text variant="caption" role="status" data-testid="bmad-status">
        {status ?? ''}
      </Text>
      {setupSlot === undefined ? null : <div data-testid="bmad-setup-slot">{setupSlot}</div>}
      {error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="bmad-error">
          {error}
        </Notice>
      )}
    </PageSection>
  );
}

/** The pieces BMad Method's setup serves (story 4.3). */
const SETUP_PIECES: readonly BmadPiece[] = ['planning', 'board'];
const servesSetup = (pieces: readonly BmadPiece[]) => pieces.some((piece) => SETUP_PIECES.includes(piece));

/** The status line's sentence for a setup status (story 4.3); `undefined` for `not_set_up` (the panel says it). */
export function bmadSetupStatusText(status: BmadSetupStatus): string | undefined {
  switch (status.state) {
    case 'current':
      return status.installedVersion === null ? undefined : bmadSetupCurrentText(status.installedVersion);
    case 'update_available':
      return bmadUpdateAvailableText(status.installedVersion ?? '', status.bundledVersion);
    case 'setup_owed':
      // `setup_owed` means `_bmad/` is there, so Set up would be refused: Upgrade finishes it (entry 4.11).
      return BMAD_SETUP_OWED_UPGRADE_TEXT;
    case 'unusable':
      return BMAD_SETUP_UNUSABLE_TEXT;
    case 'not_set_up':
      return undefined;
  }
}

export interface BmadSetupStatusViewProps {
  /** The project's setup status; `undefined` while it loads. */
  status: BmadSetupStatus | undefined;
  /** Why the status couldn't be loaded. */
  loadError: string | undefined;
  /** The setup in this tab's view: its phase, steps and reason. */
  phase: BmadSetupPhase;
  steps: Parameters<typeof BmadSetupView>[0]['steps'];
  reason: string | undefined;
  onSetUp: () => void;
  /** What this view last started: Set up, or an upgrade (entry 4.11). Default `setup`. */
  mode?: BmadSetupMode;
  /** Asks for Upgrade this project (the caller confirms first; entry 4.11). Without it no Upgrade shows. */
  onUpgrade?: () => void;
  /** The latest run's completed status (an upgrade's done line shows only when it lacks nothing). */
  completed?: BmadSetupStatus | undefined;
  /** Where the Upgrade button is kept, so the confirmation can give focus back to it. */
  upgradeRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * Story 4.3's status line: a setup's progress while one runs (or just ended,
 * in this view), else the fetched status; a refused Set up (a 409, say) says
 * why under it (review Q4).
 */
export function BmadSetupStatusView({ status, loadError, phase, steps, reason, onSetUp, mode = 'setup', onUpgrade, completed, upgradeRef }: BmadSetupStatusViewProps) {
  const run = <BmadSetupView mode={mode} phase={phase} steps={steps} reason={reason} completed={completed} onSetUp={onSetUp} />;
  // A run in progress, and a failed Set up (with its own Set up again), replace the line; a finished run or a
  // failed upgrade sits above the status line and its notices, whose Upgrade is the retry (entry 4.11).
  if (phase === 'running' || phase === 'starting' || (phase === 'failed' && mode === 'setup')) return run;
  const above = phase === 'idle' ? null : run;
  if (status?.state === 'not_set_up') {
    return (
      <>
        {above}
        <BmadSetupView phase="idle" steps={[]} reason={phase === 'idle' ? reason : undefined} onSetUp={onSetUp} />
      </>
    );
  }
  const refused =
    reason === undefined || phase !== 'idle' ? null : (
      <Text variant="caption" role="alert" data-testid="bmad-setup-error">
        {reason}
      </Text>
    );
  if (status === undefined) {
    return (
      <>
        {above}
        <Text variant="caption" role={loadError === undefined ? 'status' : 'alert'} data-testid="bmad-setup-status" data-state="loading">
          {loadError ?? BMAD_SETUP_CHECKING_TEXT}
        </Text>
        {refused}
      </>
    );
  }
  return (
    <>
      {above}
      <div className="flex flex-col gap-1" data-testid="bmad-setup-status" data-state={status.state}>
        <Text variant="caption">{bmadSetupStatusText(status)}</Text>
        {status.state === 'unusable' && status.problems.length > 0 ? (
          <ul className="m-0 pl-5 text-caption text-muted-foreground" data-testid="bmad-setup-problems">
            {status.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
        {onUpgrade === undefined ? null : <SettingsUpgrade status={status} onUpgrade={onUpgrade} buttonRef={upgradeRef} />}
        {refused}
      </div>
    </>
  );
}

/**
 * Entry 4.11's part of the status line: a notice per missing capability with
 * one Upgrade this project, or, for an unfinished setup with nothing
 * missing, Upgrade this project alone (the project has `_bmad/`, so Set up
 * would be refused).
 */
function SettingsUpgrade({ status, onUpgrade, buttonRef }: { status: BmadSetupStatus; onUpgrade: () => void; buttonRef?: RefObject<HTMLButtonElement | null> | undefined }) {
  const texts = (status.missingCapabilities ?? []).map((capability) => BMAD_CAPABILITY_REDUCED_TEXT[capability]);
  if (texts.length > 0) {
    return (
      <div className="mt-2">
        <ReducedModeNoticeView texts={texts} busy={false} onUpgrade={onUpgrade} buttonRef={buttonRef} />
      </div>
    );
  }
  if (status.state !== 'setup_owed') return null;
  return (
    <div className="mt-2 flex">
      <UpgradeButton busy={false} onUpgrade={onUpgrade} buttonRef={buttonRef} />
    </div>
  );
}

/** What one choice asks for, and the status line once it is saved. */
export interface BmadChoice {
  pieces: BmadPiece[];
  status: string | undefined;
}

/**
 * A piece's switch: the shared rule, then the note on what else changed,
 * with the on line when BMad was off before, and the off line when nothing
 * is left on.
 */
export function bmadToggleChoice(current: readonly BmadPiece[], piece: BmadPiece, on: boolean): BmadChoice {
  const change = applyBmadPieceChoice(current, piece, on);
  const note = describeBmadPieceChange(change);
  const turnedOn = current.length === 0 && change.pieces.length > 0 ? BMAD_ON_TEXT : undefined;
  const off = change.pieces.length === 0 ? BMAD_OFF_TEXT : undefined;
  const status = [turnedOn, note, off].filter((text) => text !== undefined).join(' ');
  return { pieces: change.pieces, status: status === '' ? undefined : status };
}

/** The main switch: on adds the preselected pieces this install ships; off turns every piece off. */
export function bmadUseChoice(current: readonly BmadPiece[], on: boolean, available: readonly BmadPiece[]): BmadChoice {
  if (!on) return { pieces: [], status: BMAD_OFF_TEXT };
  return { pieces: canonicalBmadPieces([...current, ...bmadMainSwitchPieces(available)]), status: BMAD_ON_TEXT };
}

const sameKey = (pieces: readonly BmadPiece[]) => canonicalBmadPieces(pieces).join(',');

/** Whether `choice` turns on a piece that runs the project's scripts which `current` doesn't have on (story 4.2). */
export function choiceNeedsScriptTrust(current: readonly BmadPiece[], choice: BmadChoice): boolean {
  return bmadPiecesRunProjectScripts(choice.pieces.filter((piece) => !current.includes(piece)));
}

/**
 * Loads the pieces and what the install ships, saves each choice at once
 * through `PATCH settings` (optimistic, reverted on refusal), and scrolls to
 * and focuses the heading once when the page was opened at `#bmad-method`.
 * Other tabs follow `workspace.settings_changed` through
 * `useWorkspaceSettings`; a status line shows only while the stored pieces
 * are the ones it was about.
 */
export function BmadMethodSection({ wsId, offerSlot, defaultSlot }: { wsId: string; offerSlot?: ReactNode; defaultSlot?: ReactNode }) {
  const settings = useWorkspaceSettings(wsId);
  const shipped = useBmadPieces();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [chosen, setChosen] = useState<BmadPiece[] | undefined>(undefined);
  const [status, setStatus] = useState<{ text: string; key: string } | undefined>(undefined);
  const latest = useRef(createLatestGate()).current;
  // BMad Method's setup (story 4.3): its progress from the events, and the status while Planning or Board is on.
  const setup = useBmadSetup(wsId);
  const setupShown = settings.data !== undefined && servesSetup(settings.data.bmadPieces);
  const setupStatus = useBmadSetupStatus(wsId, setupShown);
  /** The pieces this tab's last save produced, as a key. */
  const lastSaved = useRef<string | undefined>(undefined);

  const stored = settings.data?.bmadPieces;
  const storedKey = stored === undefined ? undefined : sameKey(stored);
  // Another tab changed the pieces: this tab's status line and refusal are about an older state, so they go for good.
  useEffect(() => {
    if (storedKey === undefined || storedKey === lastSaved.current) return;
    setStatus(undefined);
    setError(undefined);
  }, [storedKey]);
  const pieces = chosen ?? stored;
  const availability: BmadAvailability | undefined =
    shipped.data === undefined ? undefined : (Object.fromEntries(shipped.data.map((entry) => [entry.piece, entry.available])) as BmadAvailability);

  const save = (choice: BmadChoice) => {
    const ticket = latest.next();
    const before = settings.data?.bmadPieces ?? [];
    setSaving(true);
    setChosen(choice.pieces);
    setStatus(undefined);
    setError(undefined);
    updateBmadPieces(wsId, choice.pieces).then(
      async (saved) => {
        if (!latest.isLatest(ticket)) return;
        await keepSaved(queryClient, ['workspace-settings', wsId], saved);
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        lastSaved.current = sameKey(saved.bmadPieces);
        setStatus(choice.status === undefined ? undefined : { text: choice.status, key: sameKey(saved.bmadPieces) });
        // The first of Planning and Board turned on, in a project without `_bmad/`: set BMad Method up (story 4.3).
        if (!servesSetup(before) && servesSetup(saved.bmadPieces)) {
          fetchBmadDetection(wsId).then(
            (detection) => {
              if (!detection.hasBmad) setup.start();
            },
            () => {
              // Unknown: the status line offers Set up.
            },
          );
        }
      },
      (failure: unknown) => {
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        setError(failure instanceof Error && failure.message !== '' ? failure.message : BMAD_SAVE_FAILED_TEXT);
      },
    );
  };

  // Upgrade this project's confirmation (entry 4.11), and the button it gives focus back to.
  const [confirmingUpgrade, setConfirmingUpgrade] = useState(false);
  const upgradeButton = useRef<HTMLButtonElement | null>(null);
  // The status before the latest run: a run this tab didn't start is an upgrade when `_bmad/` was there.
  const stateBefore = useRef<BmadSetupStatus['state'] | undefined>(undefined);
  if (setup.phase === 'idle' && setupStatus.data !== undefined) stateBefore.current = setupStatus.data.state;
  const runMode: BmadSetupMode = setup.ownRun ? setup.mode : stateBefore.current !== undefined && stateBefore.current !== 'not_set_up' ? 'upgrade' : 'setup';
  // The choice waiting on the trust dialog (story 4.2), and the dialog's own state.
  const [awaitingTrust, setAwaitingTrust] = useState<BmadChoice | undefined>(undefined);
  const [trusting, setTrusting] = useState(false);
  const [trustError, setTrustError] = useState<string | undefined>(undefined);
  /** Saves `choice`, asking for the project's trust first when it turns on a script-running piece in a project not yet trusted. */
  const choose = (current: readonly BmadPiece[], choice: BmadChoice) => {
    if (settings.data?.bmadScriptsTrusted !== true && choiceNeedsScriptTrust(current, choice)) {
      setTrustError(undefined);
      setAwaitingTrust(choice);
      return;
    }
    save(choice);
  };
  const allowScripts = () => {
    const choice = awaitingTrust;
    if (choice === undefined || trusting) return;
    setTrusting(true);
    setTrustError(undefined);
    trustProjectScripts(wsId).then(
      async (trusted) => {
        await keepSaved(queryClient, ['workspace-settings', wsId], trusted);
        setTrusting(false);
        setAwaitingTrust(undefined);
        save(choice);
      },
      (failure: unknown) => {
        setTrusting(false);
        setTrustError(failure instanceof Error && failure.message !== '' ? failure.message : SCRIPT_TRUST_FAILED);
      },
    );
  };

  const onToggle = (piece: BmadPiece, on: boolean) => {
    if (pieces !== undefined) choose(pieces, bmadToggleChoice(pieces, piece, on));
  };
  const onUseBmad = (on: boolean) => {
    if (pieces === undefined) return;
    choose(pieces, bmadUseChoice(pieces, on, availability === undefined ? [] : BMAD_PIECES.filter((piece) => availability[piece])));
  };

  // Arriving at #bmad-method (on load or by an in-app link): once the settings load, bring the
  // section into view and focus its heading, once per arrival.
  const hash = useRouterState({ select: (router) => router.location.hash.replace(/^#/, '') });
  const loaded = stored !== undefined;
  const anchored = useRef(false);
  useEffect(() => {
    if (hash !== WORKSPACE_SETTINGS_BMAD_ANCHOR) {
      anchored.current = false;
      return;
    }
    if (!loaded || anchored.current) return;
    anchored.current = true;
    const heading = document.getElementById(HEADING_ID);
    heading?.scrollIntoView?.({ block: 'start' });
    heading?.focus({ preventScroll: true });
  }, [loaded, hash]);

  const loadError = settings.error instanceof Error ? settings.error.message : shipped.error instanceof Error ? shipped.error.message : undefined;
  // A status line is about the pieces it saved: a change from another tab clears it (above).
  const statusText = status !== undefined && chosen === undefined && storedKey === status.key ? status.text : undefined;
  return (
    <>
      <BmadMethodView
        pieces={pieces}
        availability={availability}
        saving={saving || awaitingTrust !== undefined}
        status={statusText}
        error={error ?? loadError}
        onToggle={onToggle}
        onUseBmad={onUseBmad}
        offerSlot={offerSlot}
        defaultSlot={defaultSlot}
        setupSlot={
          setupShown || setup.phase !== 'idle' ? (
            <BmadSetupStatusView
              status={setupStatus.data}
              loadError={setupStatus.error instanceof Error ? setupStatus.error.message : undefined}
              phase={setup.phase}
              steps={setup.steps}
              reason={setup.reason}
              // Set up, or its retry: in a project that now has `_bmad/`, that is Upgrade (Set up would be refused).
              onSetUp={() => (setupStatus.data !== undefined && setupStatus.data.state !== 'not_set_up' ? setConfirmingUpgrade(true) : setup.start())}
              mode={runMode}
              onUpgrade={() => setConfirmingUpgrade(true)}
              completed={setup.completed}
              upgradeRef={upgradeButton}
            />
          ) : undefined
        }
      />
      <UpgradeConfirmDialog
        open={confirmingUpgrade}
        returnFocus={upgradeButton}
        onCancel={() => setConfirmingUpgrade(false)}
        onConfirm={() => {
          setConfirmingUpgrade(false);
          setup.start(true);
        }}
      />
      <ScriptTrustDialog
        open={awaitingTrust !== undefined}
        busy={trusting}
        error={trustError}
        onAllow={allowScripts}
        onCancel={() => {
          setAwaitingTrust(undefined);
          setTrustError(undefined);
        }}
      />
    </>
  );
}
