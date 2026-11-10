import { MAX_TRACKER_LABEL, MAX_TRACKER_TOKEN, TRACKER_KIND_LABELS, type TrackerAccount, type TrackerKind } from '@ogden-agents/shared';
import { Plus } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Notice } from '@/ui/notice';
import { PageBody, PageSection } from '@/ui/page';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { addTrackerAccount, removeTrackerAccount, TRACKER_ACCOUNTS_QUERY_KEY, useTrackerAccounts } from './trackers-api';

/** What each tracker's scope field asks for, and the token it needs. */
const SCOPE_COPY: Readonly<Record<TrackerKind, { label: string; placeholder: string; hint: string }>> = {
  github: {
    label: 'Repository',
    placeholder: 'owner/name',
    hint: 'A fine-grained token with read access to this repository’s issues. It is kept in your keychain and sent only to GitHub.',
  },
  linear: {
    label: 'Team key (optional)',
    placeholder: 'ENG',
    hint: 'A personal API key from Linear’s settings. Leave the team empty for every team. It is kept in your keychain and sent only to Linear.',
  },
};

/**
 * Issue tracker accounts (CAP-35, epic 27): GitHub repositories and Linear
 * workspaces a chat can start from, in any project, git or not. Adding one
 * tests its token first; removing one deletes its token from the keychain.
 */
export function TrackersSection() {
  const query = useTrackerAccounts();
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: TRACKER_ACCOUNTS_QUERY_KEY });
  return (
    <PageBody data-testid="trackers-settings-page">
      <PageSection aria-label="Issue trackers" data-state={query.data === undefined ? (query.isError ? 'error' : 'loading') : 'ready'}>
        <Text variant="caption">Start a chat from an issue in GitHub or Linear. Its title, description and link go into the chat&rsquo;s first message, which you see before you send it.</Text>
        {query.data === undefined ? (
          query.isError ? (
            <Notice variant="blocked" action={<Button variant="primary" onClick={() => void query.refetch()}>Try again</Button>}>
              {query.error.message}
            </Notice>
          ) : (
            <>
              <Skeleton />
              <span role="status" className="sr-only">
                Reading your tracker accounts
              </span>
            </>
          )
        ) : query.data.length === 0 ? (
          <Text variant="caption" data-testid="trackers-empty">
            No accounts added yet.
          </Text>
        ) : (
          query.data.map((account) => <TrackerAccountRow key={account.id} account={account} onRemoved={refresh} />)
        )}
      </PageSection>
      <AddTrackerForm onAdded={refresh} />
    </PageBody>
  );
}

function TrackerAccountRow({ account, onRemoved }: { account: TrackerAccount; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const remove = () => {
    if (removing) return;
    setRemoving(true);
    setError(undefined);
    removeTrackerAccount(account.id).then(onRemoved, (failure: unknown) => {
      setRemoving(false);
      setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't remove that account.");
    });
  };
  return (
    <div data-testid="tracker-account-row" data-account-id={account.id} className="flex flex-col gap-2 rounded-md border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Text variant="label">{account.label}</Text>
          <Text variant="caption">
            {TRACKER_KIND_LABELS[account.kind]}
            {account.scope === null ? '' : ` · ${account.scope}`}
          </Text>
        </div>
        <Button variant="ghost" size="sm" disabled={removing} data-testid="tracker-account-remove" onClick={remove}>
          {removing ? 'Removing…' : 'Remove'}
        </Button>
      </div>
      {error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="tracker-account-error">
          {error}
        </Notice>
      )}
    </div>
  );
}

function AddTrackerForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TrackerKind>('github');
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const copy = SCOPE_COPY[kind];
  const canAdd = !busy && label.trim() !== '' && token.trim() !== '' && (kind !== 'github' || scope.trim() !== '');

  const submit = async () => {
    if (!canAdd) return;
    setBusy(true);
    setError(undefined);
    try {
      await addTrackerAccount({ kind, label: label.trim(), token: token.trim(), scope: scope.trim() === '' ? null : scope.trim() });
      setOpen(false);
      setLabel('');
      setScope('');
      setToken('');
      onAdded();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That account couldn't be added.");
    } finally {
      setBusy(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submit();
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)} data-testid="tracker-add">
        <Plus aria-hidden />
        Add a tracker account
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="tracker-form">
      <RadioGroup aria-label="Tracker" value={kind} onValueChange={(value) => setKind(value as TrackerKind)} data-testid="tracker-kind">
        {(['github', 'linear'] as const).map((each) => (
          <RadioGroupOption key={each} id={`tracker-kind-${each}`} value={each} label={TRACKER_KIND_LABELS[each]} data-testid={`tracker-kind-${each}`} />
        ))}
      </RadioGroup>
      <Label htmlFor="tracker-label">Name</Label>
      <Input id="tracker-label" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={MAX_TRACKER_LABEL} onKeyDown={onKeyDown} data-testid="tracker-label" />
      <Label htmlFor="tracker-scope">{copy.label}</Label>
      <Input id="tracker-scope" value={scope} onChange={(event) => setScope(event.target.value)} placeholder={copy.placeholder} spellCheck={false} autoCapitalize="none" onKeyDown={onKeyDown} data-testid="tracker-scope" />
      <Label htmlFor="tracker-token">Token</Label>
      <Input id="tracker-token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} maxLength={MAX_TRACKER_TOKEN} onKeyDown={onKeyDown} data-testid="tracker-token" />
      <Text variant="caption">{copy.hint}</Text>
      <div className="flex items-center gap-2">
        <Button type="button" variant="primary" disabled={!canAdd} onClick={() => void submit()} data-testid="tracker-submit">
          {busy ? 'Testing…' : 'Test and add'}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="tracker-form-error">
          {error}
        </Notice>
      )}
    </div>
  );
}
