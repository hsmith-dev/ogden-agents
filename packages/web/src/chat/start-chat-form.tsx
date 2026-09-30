import { ChatCircle } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AGENT_NAME, createChatSession, openWorkspace } from './chat-api';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Text } from '@/ui/typography';

/**
 * Starts a chat in a folder typed by path (story 2.2). A stand-in for Add
 * project, whose folder picker arrives with the workspace switcher (2.5):
 * the same folder always opens the same project (AD-2).
 */
export function StartChatForm() {
  const navigate = useNavigate();
  const [path, setPath] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (starting) return;
    if (path.trim() === '') {
      setError('Enter the path of a folder on this computer.');
      return;
    }
    setStarting(true);
    setError(undefined);
    openWorkspace(path)
      .then((workspace) => createChatSession(workspace.id))
      .then(
        (session) => navigate({ to: '/w/$wsId/s/$sesId', params: { wsId: session.workspaceId, sesId: session.id } }),
        (failure: unknown) => {
          setStarting(false);
          setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't start a chat there. Try again.");
        },
      );
  };

  return (
    <form onSubmit={onSubmit} data-testid="start-chat" className="flex max-w-(--space-chat-column) flex-col gap-2">
      <Field id="project-path" label="Project folder" description={`The full path of a folder on this computer, such as a repo. ${AGENT_NAME} works inside it.`}>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="project-path"
            aria-describedby="project-path-description"
            placeholder="/Users/you/projects/my-app"
            autoComplete="off"
            spellCheck={false}
            className="flex-1"
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
          <Button type="submit" aria-disabled={starting}>
            <ChatCircle aria-hidden />
            {starting ? 'Starting...' : 'Start a chat'}
          </Button>
        </div>
      </Field>
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="start-chat-error">
          {error}
        </Text>
      )}
    </form>
  );
}
