import { MAX_SIGN_IN_CODE_LENGTH } from '@ogden-agents/shared';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';
import type { SignIn } from './agent-setup-api';

/**
 * A sign-in in progress (9.1): where to finish it, a link when this tab
 * didn't open the page, a field for a code the page may show, and Cancel.
 * Shared by the agent card and a chat's Sign in again notice (9.4).
 */
export function SigningIn({ agentId, signIn }: { agentId: string; signIn: SignIn }) {
  const [code, setCode] = useState('');
  const codeId = `agent-${agentId}-sign-in-code`;
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() === '' || signIn.busy) return;
    void signIn.sendCode(code.trim()).then((sent) => {
      if (sent) setCode('');
    });
  };
  return (
    <>
      <StateGlyph state="working" label="Signing in" data-testid="agent-state" />
      <Text variant="body" aria-live="polite">
        Finish signing in in the tab that just opened.
      </Text>
      {signIn.link === undefined ? null : (
        <Text variant="caption">
          No tab opened?{' '}
          <a href={signIn.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-foreground underline underline-offset-4" data-testid="agent-sign-in-link">
            Open the sign-in page
            <ArrowSquareOut aria-hidden />
          </a>
        </Text>
      )}
      <form onSubmit={send} className="flex flex-col gap-1">
        <Label htmlFor={codeId}>Paste the code</Label>
        <Text variant="caption" id={`${codeId}-description`}>
          Only if the sign-in page shows you a code.
        </Text>
        <div className="flex gap-2">
          <Input
            id={codeId}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_SIGN_IN_CODE_LENGTH}
            aria-describedby={`${codeId}-description`}
          />
          <Button type="submit" variant="secondary" aria-disabled={signIn.busy || code.trim() === ''}>
            Send
          </Button>
        </div>
      </form>
      <div className="flex">
        <Button variant="outline" aria-disabled={signIn.busy} onClick={signIn.busy ? undefined : signIn.cancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}
