import {
  applyBmadPieceChoice,
  BMAD_OFF_TEXT,
  BMAD_ON_TEXT,
  BMAD_PIECE_INFO,
  BMAD_PIECES,
  BMAD_PIECES_LIST_LABEL,
  BMAD_SAVE_FAILED_TEXT,
  BMAD_SECTION_INTRO,
  BMAD_SECTION_TITLE,
  BMAD_USE_DESCRIPTION,
  BMAD_USE_LABEL,
  bmadMainSwitchPieces,
  bmadNeedsUnavailableText,
  bmadPieceNeeds,
  bmadPiecesRunProjectScripts,
  canonicalBmadPieces,
  SCRIPT_TRUST_FAILED,
  describeBmadPieceChange,
  WORKSPACE_SETTINGS_BMAD_ANCHOR,
  type BmadPiece,
} from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Field } from '@/ui/field';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { Switch } from '@/ui/switch';
import { Text } from '@/ui/typography';
import { canTurnOnBmadPiece, ComingSoonBadge } from '@/workspaces/bmad-piece-choice';
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

export function BmadMethodView({ pieces, availability, saving, status, error, onToggle, onUseBmad, offerSlot, defaultSlot }: BmadMethodViewProps) {
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
      {error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="bmad-error">
          {error}
        </Notice>
      )}
    </PageSection>
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
    setSaving(true);
    setChosen(choice.pieces);
    setStatus(undefined);
    setError(undefined);
    updateBmadPieces(wsId, choice.pieces).then(
      (saved) => {
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        lastSaved.current = sameKey(saved.bmadPieces);
        queryClient.setQueryData(['workspace-settings', wsId], saved);
        setStatus(choice.status === undefined ? undefined : { text: choice.status, key: sameKey(saved.bmadPieces) });
      },
      (failure: unknown) => {
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        setError(failure instanceof Error && failure.message !== '' ? failure.message : BMAD_SAVE_FAILED_TEXT);
      },
    );
  };

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
      (trusted) => {
        setTrusting(false);
        setAwaitingTrust(undefined);
        queryClient.setQueryData(['workspace-settings', wsId], trusted);
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
