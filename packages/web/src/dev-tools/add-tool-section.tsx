import type { DevToolStatus } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { addDevTool, DEV_TOOLS_QUERY_KEY } from '@/dev-tools/dev-tools-api';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { PageSection } from '@/ui/page';
import { Text } from '@/ui/typography';

/**
 * Names a tool Ogden doesn't ship (CAP-25: the generic, extensible path —
 * not only the seed four). Stored exactly as the user typed it; the install
 * command they give here is what is later shown back to them, verbatim,
 * for confirmation before it ever runs.
 */
export function AddToolSection() {
  const queryClient = useQueryClient();
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [executable, setExecutable] = useState('');
  const [installCommand, setInstallCommand] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = () => {
    setSaving(true);
    setError(undefined);
    addDevTool({ id, label, executable, installCommand }).then(
      (added) => {
        setSaving(false);
        setId('');
        setLabel('');
        setExecutable('');
        setInstallCommand('');
        queryClient.setQueryData<DevToolStatus[]>(DEV_TOOLS_QUERY_KEY, (current) => [...(current ?? []), added]);
      },
      (failure: unknown) => {
        setSaving(false);
        setError(failure instanceof Error ? failure.message : "That tool couldn't be added. Try again.");
      },
    );
  };

  return (
    <PageSection aria-label="Add a tool">
      <Field id="dev-tool-id" label="Id" description="A short, lowercase name (letters, numbers and dashes only).">
        <Input id="dev-tool-id" value={id} onChange={(event) => setId(event.target.value)} />
      </Field>
      <Field id="dev-tool-label" label="Name">
        <Input id="dev-tool-label" value={label} onChange={(event) => setLabel(event.target.value)} />
      </Field>
      <Field id="dev-tool-executable" label="Program name" description="What Ogden Agents looks for on your PATH, such as terraform.">
        <Input id="dev-tool-executable" value={executable} onChange={(event) => setExecutable(event.target.value)} />
      </Field>
      <Field id="dev-tool-install-command" label="Install command" description="The exact command Ogden Agents will show you and run, only once you confirm it.">
        <Input id="dev-tool-install-command" value={installCommand} onChange={(event) => setInstallCommand(event.target.value)} />
      </Field>
      <div className="flex">
        <Button aria-disabled={saving || id === '' || label === '' || executable === '' || installCommand === ''} onClick={() => (saving ? undefined : submit())} data-testid="add-dev-tool">
          Add a tool
        </Button>
      </div>
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="add-dev-tool-error">
          {error}
        </Text>
      )}
    </PageSection>
  );
}
