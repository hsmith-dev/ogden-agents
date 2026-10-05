import { Text } from '@/ui/typography';
import { updateSteps, type Available } from '@/updates/update-model';
import type { UpdateNoticeResponse } from '@ogden-agents/shared';

/** "To update, run `npx ogden-agents@latest` in a terminal." and its GitHub Releases variants (story 13.14). */
export function UpdateHowTo({ notice, available }: { notice: Pick<UpdateNoticeResponse, 'installMethod'>; available: Available }) {
  const { lead, code, tail } = updateSteps(notice, available);
  return (
    <>
      {lead}
      {code === null ? null : (
        <>
          {' '}
          <Text as="code" variant="mono">{code}</Text>
        </>
      )}
      {tail === '' ? null : tail.startsWith('.') ? tail : ` ${tail}`}
    </>
  );
}
