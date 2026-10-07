import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { useWorkspaces } from '@/workspaces/workspace-api';
import { requestTourReplay } from './tour-store';

/**
 * Settings' Replay action (AC4): opens the project the sidebar lists first
 * and starts the guided tour there (`TourController` finishes the job once
 * that project's settings are known). Disabled with no project yet — the
 * tour has nothing to point at without one.
 */
export function ReplayTourSetting() {
  const workspaces = useWorkspaces();
  const navigate = useNavigate();
  const target = workspaces.data?.[0];
  return (
    <Field
      id="replay-tour"
      control="group"
      layout="inline"
      label="Guided tour"
      description={target === undefined ? 'Add a project to replay it.' : 'Shows the tour that pointed out chat, your projects, and permission cards the first time.'}
    >
      <Button
        variant="outline"
        data-testid="replay-tour"
        aria-describedby="replay-tour-description"
        aria-disabled={target === undefined}
        onClick={
          target === undefined
            ? undefined
            : () => {
                requestTourReplay(target.id);
                void navigate({ to: '/w/$wsId', params: { wsId: target.id } });
              }
        }
      >
        Replay guided tour
      </Button>
    </Field>
  );
}
