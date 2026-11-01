/**
 * Settings, Projects, Editor (AD-39; story 8.10): **Open files in**, a radio
 * group of the editors the server found on this computer, saved on change.
 * The server keeps the choice, so every tab agrees; the default is the
 * first found until one is chosen, and again whenever the chosen one is no
 * longer found. With none found, the one sentence every Open in editor shows.
 */
import {
  API_ROUTES,
  EDITOR_CHOICE_LABEL,
  EDITOR_NONE_FOUND_TEXT,
  EDITOR_SAVE_FAILED_TEXT,
  EDITOR_SETTINGS_INTRO,
  EDITOR_SETTINGS_LABEL,
  editorChosenText,
  EditorsResponse,
  type EditorInfo,
} from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { call, type Auth } from '@/api/http';
import { keepSaved } from '@/api/keep-saved';
import { tabAuth } from '@/auth/tab-token';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Notice } from '@/ui/notice';
import { PageBody, PageSection } from '@/ui/page';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { EDITORS_QUERY_KEY, useEditors } from '@/workbench/open-in-editor';
import { createLatestGate } from '@/workspaces/workspace-settings-api';

/** `PUT /api/v1/editors`: the editor files open in. */
export async function chooseEditor(editorId: string, auth: Auth = tabAuth): Promise<EditorsResponse> {
  const json = await call(auth, API_ROUTES.editors, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ editorId }) }, EDITOR_SAVE_FAILED_TEXT);
  return EditorsResponse.parse(json);
}

export interface EditorChoiceViewProps {
  /** The editors found; `undefined` while loading. */
  editors: readonly EditorInfo[] | undefined;
  /** The editor files open in now. */
  value: string | undefined;
  onChange(editorId: string): void;
  saving: boolean;
  status: { kind: 'saved' | 'error'; text: string } | undefined;
}

export function EditorChoiceView({ editors, value, onChange, saving, status }: EditorChoiceViewProps) {
  return (
    <PageSection title={EDITOR_CHOICE_LABEL} data-testid="editor-settings-section">
      <Text id="editor-settings-description">{EDITOR_SETTINGS_INTRO}</Text>
      {editors === undefined ? (
        <Skeleton />
      ) : editors.length === 0 ? (
        <Text variant="caption" data-testid="editor-settings-none">
          {EDITOR_NONE_FOUND_TEXT}
        </Text>
      ) : (
        <RadioGroup
          aria-label={EDITOR_CHOICE_LABEL}
          aria-describedby="editor-settings-description"
          data-testid="editor-settings-choice"
          value={value ?? ''}
          disabled={saving}
          onValueChange={(next) => {
            if (editors.some((editor) => editor.id === next)) onChange(next);
          }}
        >
          {editors.map((editor) => (
            <RadioGroupOption key={editor.id} id={`editor-${editor.id}`} value={editor.id} data-testid={`editor-option-${editor.id}`} label={editor.name} />
          ))}
        </RadioGroup>
      )}
      <Text variant="caption" role="status" data-testid="editor-settings-status">
        {status?.kind === 'saved' ? status.text : ''}
      </Text>
      {status?.kind === 'error' ? (
        <Notice variant="blocked" role="alert" data-testid="editor-settings-error">
          {status.text}
        </Notice>
      ) : null}
    </PageSection>
  );
}

/** Loads the editors and saves each choice at once. */
export function EditorChoiceSection() {
  const { query, data } = useEditors();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<EditorChoiceViewProps['status']>(undefined);
  const latest = useRef(createLatestGate()).current;

  const onChange = (editorId: string) => {
    const ticket = latest.next();
    setSaving(true);
    setChosen(editorId);
    setStatus(undefined);
    chooseEditor(editorId).then(
      async (saved) => {
        if (!latest.isLatest(ticket)) return;
        await keepSaved(queryClient, EDITORS_QUERY_KEY, saved);
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        const name = saved.editors.find((editor) => editor.id === saved.defaultEditorId)?.name ?? editorId;
        setStatus({ kind: 'saved', text: editorChosenText(name) });
      },
      (failure: unknown) => {
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        setStatus({ kind: 'error', text: failure instanceof Error && failure.message !== '' ? failure.message : EDITOR_SAVE_FAILED_TEXT });
      },
    );
  };

  // A server without the launcher (501) or one that can't look: as none found, with why.
  const loadError = query.isError ? query.error.message : undefined;
  return (
    <EditorChoiceView
      editors={query.isError ? [] : data?.editors}
      value={chosen ?? data?.defaultEditorId ?? undefined}
      onChange={onChange}
      saving={saving}
      status={status ?? (loadError === undefined ? undefined : { kind: 'error', text: loadError })}
    />
  );
}

/** `/settings/editor`. */
export function EditorSettingsPage() {
  return (
    <>
      <WorkspaceHeader title={EDITOR_SETTINGS_LABEL} />
      <PageBody data-testid="editor-settings-page">
        <EditorChoiceSection />
      </PageBody>
    </>
  );
}
