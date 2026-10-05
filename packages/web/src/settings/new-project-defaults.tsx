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
  type PermissionMode,
  PERMISSION_MODE_LABELS,
} from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useAppearance } from '@/appearance/appearance-provider';
import { keepSaved } from '@/api/keep-saved';
import { call, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { DefaultAgentView, type DefaultAgentViewProps } from '@/chat/default-agent-view';
import { projectDefaultAgent, useChatAgents } from '@/chat/use-chat-agents';
import { bmadMethodPieces } from '@/onboarding/welcome-model';
import { DefaultPermissionModeView, SKIP_ALL_NEW_PROJECTS_WARNING, type DefaultPermissionModeViewProps } from '@/permissions/default-permission-mode';
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

/**
 * `PATCH /api/v1/settings/new-projects`: the agent new projects get as their
 * default (epic 6, entry 6: Welcome's agent choice, or this page).
 */
export async function updateNewProjectsAgent(defaultAgentId: string, auth: Auth = tabAuth): Promise<NewProjectDefaults> {
  const json = await call(
    auth,
    API_ROUTES.newProjectDefaults,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ defaultAgentId }) },
    "The default agent couldn't be saved",
  );
  return NewProjectDefaultsResponse.parse(json).defaults;
}

/**
 * `PATCH /api/v1/settings/new-projects`: the mode new projects' chats start
 * in (default permission mode); Skip all carries `confirm` and needs
 * Developer mode, checked by the server.
 */
export async function updateNewProjectsPermissionMode(defaultPermissionMode: PermissionMode, confirm: boolean, auth: Auth = tabAuth): Promise<NewProjectDefaults> {
  const json = await call(
    auth,
    API_ROUTES.newProjectDefaults,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ defaultPermissionMode, ...(confirm ? { confirm: true } : {}) }) },
    "The default permission mode couldn't be saved",
  );
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
      async (saved) => {
        if (!latest.isLatest(ticket)) return;
        // A read still on its way (the page's mount refetch, say) would show the old default (story 4.13).
        await keepSaved(queryClient, NEW_PROJECT_DEFAULTS_QUERY_KEY, saved);
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
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

/**
 * The agent new projects get as their default (epic 6, entry 6), shown only
 * while the install has more than one: saved at once; projects that exist
 * already keep theirs.
 */
export function NewProjectsAgentSection() {
  const chatAgents = useChatAgents();
  const defaults = useNewProjectDefaults();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<DefaultAgentViewProps['status']>(undefined);
  const latest = useRef(createLatestGate()).current;
  const list = chatAgents.data;
  if (list === undefined) return null;

  const onChange = (agentId: string) => {
    const ticket = latest.next();
    setSaving(true);
    setChosen(agentId);
    setStatus(undefined);
    updateNewProjectsAgent(agentId).then(
      async (saved) => {
        if (!latest.isLatest(ticket)) return;
        await keepSaved(queryClient, NEW_PROJECT_DEFAULTS_QUERY_KEY, saved);
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        const name = list.agents.find((agent) => agent.agentId === projectDefaultAgent(list, saved.defaultAgentId))?.displayName ?? agentId;
        setStatus({ kind: 'saved', text: `Saved: new projects start with ${name}.` });
      },
      (failure: unknown) => {
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        setStatus({ kind: 'error', text: failure instanceof Error ? failure.message : "The default agent couldn't be saved. Try again." });
      },
    );
  };

  const value = chosen ?? (defaults.data === undefined ? undefined : projectDefaultAgent(list, defaults.data.defaultAgentId));
  return (
    <DefaultAgentView
      agents={list.agents}
      value={value}
      onChange={onChange}
      saving={saving}
      status={status ?? (defaults.error instanceof Error ? { kind: 'error', text: defaults.error.message } : undefined)}
      testId="new-projects-agent"
      description="The agent a new project's chats start with. Projects you already have keep theirs."
    />
  );
}

/**
 * The mode new projects' chats start in (default permission mode): saved at
 * once; projects that exist already keep theirs. Skip all, after its red
 * warning, still needs each new project's own confirmation.
 */
export function NewProjectsPermissionModeSection() {
  const defaults = useNewProjectDefaults();
  const { appearance } = useAppearance();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [chosen, setChosen] = useState<PermissionMode | undefined>(undefined);
  const [status, setStatus] = useState<DefaultPermissionModeViewProps['status']>(undefined);
  const latest = useRef(createLatestGate()).current;

  const onChange = (mode: PermissionMode, confirmed: boolean) => {
    const ticket = latest.next();
    setSaving(true);
    setChosen(mode);
    setStatus(undefined);
    updateNewProjectsPermissionMode(mode, confirmed).then(
      async (saved) => {
        if (!latest.isLatest(ticket)) return;
        await keepSaved(queryClient, NEW_PROJECT_DEFAULTS_QUERY_KEY, saved);
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        setStatus({ kind: 'saved', text: `Saved: new projects' chats start in ${PERMISSION_MODE_LABELS[saved.defaultPermissionMode ?? 'ask']}.` });
      },
      (failure: unknown) => {
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        setStatus({ kind: 'error', text: failure instanceof Error ? failure.message : "The default permission mode couldn't be saved. Try again." });
      },
    );
  };

  return (
    <DefaultPermissionModeView
      value={chosen ?? (defaults.data === undefined ? undefined : (defaults.data.defaultPermissionMode ?? 'ask'))}
      developerMode={appearance.developerMode}
      onChange={onChange}
      saving={saving}
      status={status ?? (defaults.error instanceof Error ? { kind: 'error', text: defaults.error.message } : undefined)}
      testId="new-projects-mode-default"
      title="New chats start in"
      description="The permission mode a new project's chats start in. Projects you already have keep theirs. Skip all still asks you to confirm it once in each new project."
      confirmTitle="Start new projects' chats in Skip all?"
      confirmWarning={SKIP_ALL_NEW_PROJECTS_WARNING}
    />
  );
}
