import { FROM_AN_ISSUE_LABEL, TRACKER_KIND_LABELS, type IssueContextResponse, type TrackerAccountId } from '@ogden-agents/shared';
import { ListChecks } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Notice } from '@/ui/notice';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { fetchIssueContext, fetchIssues, useTrackerAccounts } from './trackers-api';

/** How long typing settles before a search is sent. */
const SEARCH_SETTLE_MS = 300;

/**
 * From an issue (CAP-35, epic 27, E27-R2): pick a tracker account, see its
 * recent open issues or search them, and pick one. The issue is read again
 * on the server, which answers its context block and the chat's name;
 * `onPicked` starts the chat with them (the block goes into its composer,
 * for the person to read and send). Shown only once an account exists.
 */
export function IssuePicker({ disabled, onPicked }: { disabled?: boolean; onPicked: (picked: IssueContextResponse) => void }) {
  const accounts = useTrackerAccounts();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<TrackerAccountId | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const list = accounts.data ?? [];
  const accountId = chosen ?? list[0]?.id;

  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed), SEARCH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [typed]);
  const issues = useQuery({
    queryKey: ['tracker-issues', accountId, query],
    queryFn: () => fetchIssues(accountId!, query),
    enabled: open && accountId !== undefined,
    retry: false,
  });

  if (list.length === 0) return null;

  const pick = (issueKey: string) => {
    if (accountId === undefined || picking !== undefined) return;
    setPicking(issueKey);
    setError(undefined);
    fetchIssueContext(accountId, issueKey).then(
      (picked) => {
        setPicking(undefined);
        setOpen(false);
        onPicked(picked);
      },
      (failure: unknown) => {
        setPicking(undefined);
        setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't read that issue.");
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" aria-disabled={disabled || undefined} data-testid="start-from-issue">
          <ListChecks aria-hidden />
          {FROM_AN_ISSUE_LABEL}
        </Button>
      </DialogTrigger>
      <DialogContent title="Start a chat from an issue" description="Its details go into the chat’s first message. You can read and change it before you send." data-testid="issue-picker">
        {list.length > 1 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tracker account">
            {list.map((account) => (
              <Button
                key={account.id}
                size="sm"
                variant={account.id === accountId ? 'primary' : 'outline'}
                aria-pressed={account.id === accountId}
                data-testid="issue-picker-account"
                onClick={() => setChosen(account.id)}
              >
                {account.label}
              </Button>
            ))}
          </div>
        ) : null}
        <Label htmlFor="issue-search">Search</Label>
        <Input id="issue-search" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Words from the title or description" data-testid="issue-search" />
        {issues.data === undefined ? (
          issues.isError ? (
            <Notice variant="blocked" role="alert" data-testid="issue-picker-error">
              {issues.error.message}
            </Notice>
          ) : (
            <Skeleton />
          )
        ) : issues.data.length === 0 ? (
          <Text variant="caption" data-testid="issue-picker-empty">
            No open issues {query.trim() === '' ? 'here' : 'match that'}.
          </Text>
        ) : (
          <ul className="flex flex-col gap-1 overflow-y-auto" data-testid="issue-picker-list">
            {issues.data.map((issue) => (
              <li key={issue.key}>
                <Button
                  variant="ghost"
                  className="h-auto w-full flex-col items-start gap-0.5 py-1.5 text-left"
                  aria-busy={picking === issue.key || undefined}
                  data-testid="issue-picker-issue"
                  data-issue-key={issue.key}
                  onClick={() => pick(issue.key)}
                >
                  <span className="text-label">
                    {issue.identifier} {issue.title}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {TRACKER_KIND_LABELS[issue.kind]}
                    {issue.status === null ? '' : ` · ${issue.status}`}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error === undefined ? null : (
          <Notice variant="blocked" role="alert" data-testid="issue-picker-pick-error">
            {error}
          </Notice>
        )}
      </DialogContent>
    </Dialog>
  );
}
