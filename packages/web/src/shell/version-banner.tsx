import { ArrowClockwise } from '@phosphor-icons/react';
import { useServerVersion } from '@/events/event-stream';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { BUILD_VERSION } from '@/version';

/**
 * AD-20: when the running server's version differs from the version this page
 * was built as, a non-blocking banner asks for a reload.
 */
export function VersionBanner({ buildVersion = BUILD_VERSION }: { buildVersion?: string | undefined }) {
  const serverVersion = useServerVersion();
  if (buildVersion === undefined || serverVersion === undefined || serverVersion === buildVersion) return null;
  return (
    <Banner
      data-testid="version-banner"
      action={
        <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
          <ArrowClockwise aria-hidden />
          Reload
        </Button>
      }
    >
      Ogden Agents was updated.
    </Banner>
  );
}
