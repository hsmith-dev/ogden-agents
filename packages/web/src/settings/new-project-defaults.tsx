import {
  API_ROUTES,
  applyBmadPieceChoice,
  BMAD_METHOD_COMING_SOON_SENTENCE,
  BMAD_METHOD_SENTENCE,
  BMAD_PIECE_INFO,
  BMAD_PIECES,
  describeBmadPieceChange,
  FIRST_PROJECT_CHOICE_LABELS,
  NEW_PROJECTS_LOAD_FAILED,
  NEW_PROJECTS_MODE_LABEL,
  NEW_PROJECTS_PIECES_LABEL,
  NEW_PROJECTS_SAVE_FALLBACK,
  NEW_PROJECTS_SAVED_TEXT,
  NEW_PROJECTS_SETTINGS_INTRO,
  NEW_PROJECTS_SETTINGS_LABEL,
  NewProjectDefaultsResponse,
  SIMPLE_CHATS_SENTENCE,
  type BmadPiece,
  type BmadPieceAvailability,
  type NewProjectDefaults,
} from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { call, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { bmadMethodPieces } from '@/onboarding/welcome-model';
import { CheckboxOption } from '@/ui/checkbox';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { Text } from '@/ui/typography';
import { canTurnOnBmadPiece, ComingSoonBadge } from '@/workspaces/bmad-piece-choice';
import { createLatestGate, useBmadPieces } from '@/workspaces/workspace-settings-api';

/**
 * Settings → New projects (story 10.4): the app-wide default a newly added
 * project starts with, Simple chats or BMad Method with chosen features. The
 * server keeps it and applies it when a project is added (so every tab
 * agrees); projects that already exist are never changed by it.
 */

export const NEW_PROJECT_DEFAULTS_QUERY_KEY = ['new-project-defaults'] as const;

/** `GET /api/v1/settings/new-projects`. */
export async function fetchNewProjectDefaults(auth: Auth = tabAuth): Promise<NewProjectDefaults> {
  const json = await call(auth, API_ROUTES.newProjectDefaults, {}, NEW_PROJECTS_LOAD_FAILED);
  return NewProjectDefaultsResponse.parse(json).defaults;
}

/** `PATCH /api/v1/settings/new-projects`: the pieces new projects start with. */
export async function updateNewProjectDefaults(bmadPieces: readonly BmadPiece[], auth: Auth = tabAuth): Promise<NewProjectDefaults> {
  const json = await call(
    auth,
    API_ROUTES.newProjectDefaults,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bmadPieces }) },
    NEW_PROJECTS_SAVE_FALLBACK,
  );
  return NewProjectDefaultsResponse.parse(json).defaults;
}

export function useNewProjectDefaults() {
  return useQuery({ queryKey: NEW_PROJECT_DEFAULTS_QUERY_KEY, queryFn: () => fetchNewProjectDefaults(), retry: false });
}

type Mode = 'simple_chats' | 'bmad_method';

/** Whether turning `piece` on would turn on only pieces this install ships (it and what it needs). */
export function canTurnOn(current: readonly BmadPiece[], piece: BmadPiece, availability: readonly BmadPieceAvailability[] | undefined): boolean {
  return canTurnOnBmadPiece(current, piece, availability === undefined ? undefined : (each) => availability.some((entry) => entry.piece === each && entry.available));
}

export interface NewProjectDefaultsViewProps {
  /** The kept default's pieces; `undefined` while loading. */
  pieces: readonly BmadPiece[] | undefined;
  /** What this install ships; `undefined` while loading (nothing can be turned on then). */
  availability: readonly BmadPieceAvailability[] | undefined;
  /** BMad Method chosen with no feature on yet (kept here only: an empty default is Simple). */
  mode: Mode | undefined;
  onModeChange(mode: Mode): void;
  onChange(pieces: BmadPiece[], note: string | undefined): void;
  saving: boolean;
  status: { kind: 'saved' | 'error'; text: string } | undefined;
}

/** Simple chats or BMad Method as radios; under BMad Method each feature as a checkbox, a coming-soon one greyed. */
export function NewProjectDefaultsView({ pieces, availability, mode, onModeChange, onChange, saving, status }: NewProjectDefaultsViewProps) {
  const offered = bmadMethodPieces(availability).length > 0;
  const shown: Mode | undefined = pieces === undefined ? undefined : pieces.length > 0 ? 'bmad_method' : (mode ?? 'simple_chats');
  return (
    <PageSection title={NEW_PROJECTS_SETTINGS_LABEL} data-testid="new-projects-section">
      <Text id="new-projects-description">{NEW_PROJECTS_SETTINGS_INTRO}</Text>
      {pieces === undefined || shown === undefined ? null : (
        <>
          <RadioGroup
            aria-label={NEW_PROJECTS_MODE_LABEL}
            aria-describedby="new-projects-description"
            data-testid="new-projects-mode"
            value={shown}
            disabled={saving}
            onValueChange={(next) => {
              if (next === 'simple_chats' || next === 'bmad_method') onModeChange(next);
            }}
          >
            <RadioGroupOption id="new-projects-simple_chats" value="simple_chats" data-testid="new-projects-simple_chats" label={FIRST_PROJECT_CHOICE_LABELS.simple_chats} description={SIMPLE_CHATS_SENTENCE} />
            <RadioGroupOption
              id="new-projects-bmad_method"
              value="bmad_method"
              data-testid="new-projects-bmad_method"
              label={FIRST_PROJECT_CHOICE_LABELS.bmad_method}
              disabled={!offered && shown !== 'bmad_method'}
              description={
                offered || availability === undefined ? (
                  BMAD_METHOD_SENTENCE
                ) : (
                  <>
                    {BMAD_METHOD_COMING_SOON_SENTENCE}
                    <ComingSoonBadge testId="new-projects-bmad-coming-soon" />
                  </>
                )
              }
            />
          </RadioGroup>
          {shown === 'bmad_method' ? (
            <div role="group" aria-label={NEW_PROJECTS_PIECES_LABEL} className="flex flex-col gap-1 pl-6" data-testid="new-projects-pieces">
              {BMAD_PIECES.map((piece) => {
                const on = pieces.includes(piece);
                const available = availability?.find((entry) => entry.piece === piece)?.available;
                return (
                  <CheckboxOption
                    key={piece}
                    id={`new-projects-${piece}`}
                    data-testid={`new-projects-${piece}`}
                    label={BMAD_PIECE_INFO[piece].label}
                    description={
                      available !== false ? (
                        BMAD_PIECE_INFO[piece].sentence
                      ) : (
                        <>
                          {BMAD_PIECE_INFO[piece].sentence}
                          <ComingSoonBadge testId={`new-projects-${piece}-coming-soon`} />
                        </>
                      )
                    }
                    checked={on}
                    // Turning a feature on needs it (and what it needs) shipped; turning one off is always allowed.
                    disabled={saving || (!on && !canTurnOn(pieces, piece, availability))}
                    onCheckedChange={(checked) => {
                      const change = applyBmadPieceChoice(pieces, piece, checked === true);
                      onChange(change.pieces, describeBmadPieceChange(change));
                    }}
                  />
                );
              })}
            </div>
          ) : null}
        </>
      )}
      <Text variant="caption" role="status" data-testid="new-projects-status">
        {status?.kind === 'saved' ? status.text : ''}
      </Text>
      {status?.kind === 'error' ? (
        <Notice variant="blocked" role="alert" data-testid="new-projects-error">
          {status.text}
        </Notice>
      ) : null}
    </PageSection>
  );
}

/** Loads the default and saves each change at once. */
export function NewProjectDefaultsSection() {
  const defaults = useNewProjectDefaults();
  const availability = useBmadPieces();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode | undefined>(undefined);
  const [chosen, setChosen] = useState<BmadPiece[] | undefined>(undefined);
  const [status, setStatus] = useState<NewProjectDefaultsViewProps['status']>(undefined);
  const latest = useRef(createLatestGate()).current;

  const save = (pieces: BmadPiece[], note: string | undefined, onFailure?: () => void) => {
    const ticket = latest.next();
    setSaving(true);
    setChosen(pieces);
    setStatus(undefined);
    updateNewProjectDefaults(pieces).then(
      (saved) => {
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        queryClient.setQueryData(NEW_PROJECT_DEFAULTS_QUERY_KEY, saved);
        setStatus({ kind: 'saved', text: note === undefined ? NEW_PROJECTS_SAVED_TEXT : `${note} ${NEW_PROJECTS_SAVED_TEXT}` });
      },
      (failure: unknown) => {
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        onFailure?.();
        setStatus({ kind: 'error', text: failure instanceof Error ? failure.message : `${NEW_PROJECTS_SAVE_FALLBACK}. Try again.` });
      },
    );
  };

  const onModeChange = (next: Mode) => {
    const previous = mode;
    setMode(next);
    // Simple chats: every feature off. BMad Method: Planning and Board, as far as this install ships them.
    // A failed save shows the option that is still kept.
    save(next === 'simple_chats' ? [] : bmadMethodPieces(availability.data), undefined, () => setMode(previous));
  };

  /** A feature turned on or off: BMad Method stays shown, even with its last feature off (an empty default is then kept as Simple). */
  const onPiecesChange = (pieces: BmadPiece[], note: string | undefined) => {
    setMode('bmad_method');
    save(pieces, note);
  };

  const loadError = defaults.error instanceof Error ? defaults.error.message : availability.error instanceof Error ? availability.error.message : undefined;
  return (
    <NewProjectDefaultsView
      pieces={chosen ?? defaults.data?.bmadPieces}
      availability={availability.data}
      mode={mode}
      onModeChange={onModeChange}
      onChange={onPiecesChange}
      saving={saving}
      status={status ?? (loadError === undefined ? undefined : { kind: 'error', text: loadError })}
    />
  );
}
