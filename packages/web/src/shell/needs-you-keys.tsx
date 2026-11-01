import { useNavigate } from '@tanstack/react-router';
import { useSidebarData } from './sidebar-data';
import { lastNeedsYouOpened, markNeedsYouOpened, needsYouTarget, nextNeedsYou } from './needs-you-target';
import { useGoKeys } from './use-go-shortcuts';

/**
 * `g y` from anywhere (epic 26, E26-R1): opens the next Needs you row's
 * target, after the one last opened, wrapping to the first. Reads the live
 * list; mounted once per tab in the shell (the sidebar body renders twice).
 */
export function NeedsYouKeys() {
  const { model } = useSidebarData();
  const navigate = useNavigate();
  useGoKeys([
    {
      key: 'y',
      run: () => {
        const next = nextNeedsYou(model.needsYou, lastNeedsYouOpened());
        if (next === undefined) return;
        markNeedsYouOpened(next.id);
        void navigate(needsYouTarget(next));
      },
    },
  ]);
  return null;
}
