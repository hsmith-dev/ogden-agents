import { MAX_SIGN_IN_CODE_LENGTH, type AgentSetupStatus } from '@ogden-agents/shared';
import { ArrowSquareOut, SignIn as SignInIcon } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Notice } from '@/ui/notice';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';
import { useSignIn, type SignIn } from './agent-setup-api';

/**
 * One agent's setup card (DESIGN.md Onboarding agent card; EXPERIENCE.md
 * State Patterns): its name, then "Installed, signed in", "Installed, needs
 * sign-in" or "Not installed", and the one sign-in action. While signing in
 * it says where to finish, offers Cancel, and takes a code the sign-in page
 * may show. Welcome (9.5) reuses it.
 */
export function AgentCard({ agent }: { agent: AgentSetupStatus }) {
  const signIn = useSignIn(agent.agentId);
  const headingId = `agent-${agent.agentId}-name`;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={`agent-card-${agent.agentId}`}
      data-auth={agent.auth}
      data-install={agent.install}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-(--panel-padding)"
    >
      <Text as="h2" variant="heading" id={headingId}>
        {agent.displayName}
      </Text>
      <AgentState agent={agent} signIn={signIn} />
      {signIn.error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="agent-request-error">
          {signIn.error}
        </Text>
      )}
    </section>
  );
}

function AgentState({ agent, signIn }: { agent: AgentSetupStatus; signIn: SignIn }) {
  if (agent.install !== 'installed') {
    return (
      <>
        <StateGlyph state="idle" label="Not installed" data-testid="agent-state" />
        {agent.reason === undefined ? null : <Text variant="caption">{agent.reason}</Text>}
      </>
    );
  }
  const start = () => signIn.start(agent.signInTab);
  switch (agent.auth) {
    case 'signed_in':
      return <StateGlyph state="done" label="Installed, signed in" data-testid="agent-state" />;
    case 'signing_in':
      return <SigningIn agentId={agent.agentId} signIn={signIn} />;
    case 'failed':
      return (
        <>
          <StateGlyph state="idle" label="Installed, needs sign-in" data-testid="agent-state" />
          <Notice variant="blocked" glyphLabel="Sign-in failed" data-testid="agent-sign-in-failed" action={<SignInButton signIn={signIn} onClick={start} label="Try again" />}>
            {agent.reason ?? `${agent.displayName} couldn't finish signing in. Try again.`}
          </Notice>
        </>
      );
    case 'needs_sign_in':
      return (
        <>
          <StateGlyph state="idle" label="Installed, needs sign-in" data-testid="agent-state" />
          {agent.reason === undefined ? null : <Text variant="caption">{agent.reason}</Text>}
          <div className="flex">
            <SignInButton signIn={signIn} onClick={start} label="Sign in with your account" />
          </div>
        </>
      );
  }
}

function SignInButton({ signIn, onClick, label }: { signIn: SignIn; onClick: () => void; label: string }) {
  return (
    <Button aria-disabled={signIn.busy} onClick={signIn.busy ? undefined : onClick}>
      <SignInIcon aria-hidden />
      {signIn.busy ? 'Starting...' : label}
    </Button>
  );
}

function SigningIn({ agentId, signIn }: { agentId: string; signIn: SignIn }) {
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
