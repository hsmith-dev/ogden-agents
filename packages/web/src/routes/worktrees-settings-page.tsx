import {
  WORKTREE_PUT_AWAY_NOT_KEPT_TEXT,
  WORKTREE_RETENTION_FIELD_LABEL,
  WORKTREE_RETENTION_MAX,
  WORKTREE_RETENTION_MIN,
  worktreeRetentionLabel,
  WORKTREES_SETTINGS_DESCRIPTION,
  WORKTREES_SETTINGS_TITLE,
} from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { NumberSetting } from '@/planning/build-limit-fields';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Notice } from '@/ui/notice';
import { PageBody, PageSection } from '@/ui/page';
import { Text } from '@/ui/typography';
import { saveWorktreeRetention, useWorktreeRetention, worktreeRetentionQueryKey } from '@/worktrees/worktree-retention';

/**
 * `/settings/worktrees` (epic 27, 27.6; CAP-35): Settings, Projects,
 * Worktrees. The install's one cap over every project's chat worktrees:
 * beyond it the oldest idle chat's copy is put away with its uncommitted
 * changes saved, and Restore brings it back. Said plainly what a put-away
 * copy doesn't keep.
 */
export function WorktreesSettingsPage() {
  const queryClient = useQueryClient();
  const retention = useWorktreeRetention();
  return (
    <>
      <WorkspaceHeader title={WORKTREES_SETTINGS_TITLE} />
      <PageBody data-testid="worktrees-settings-page">
        {retention.data === undefined ? (
          retention.isError ? (
            <Notice variant="blocked" role="alert" data-testid="worktree-retention-error">
              {retention.error instanceof Error ? retention.error.message : "Ogden Agents couldn't load the worktree setting."}
            </Notice>
          ) : null
        ) : (
          <PageSection aria-label={WORKTREES_SETTINGS_TITLE} data-testid="worktree-retention">
            <NumberSetting
              id="worktree-retention-keep"
              label={WORKTREE_RETENTION_FIELD_LABEL}
              description={`${worktreeRetentionLabel(retention.data.keep)} now. ${WORKTREES_SETTINGS_DESCRIPTION}`}
              value={retention.data.keep}
              bounds={{ min: WORKTREE_RETENTION_MIN, max: WORKTREE_RETENTION_MAX }}
              save={async (keep) => {
                const saved = await saveWorktreeRetention(keep);
                queryClient.setQueryData(worktreeRetentionQueryKey, saved);
              }}
            />
            <Text variant="caption" data-testid="worktree-retention-not-kept">
              {WORKTREE_PUT_AWAY_NOT_KEPT_TEXT}
            </Text>
          </PageSection>
        )}
      </PageBody>
    </>
  );
}
