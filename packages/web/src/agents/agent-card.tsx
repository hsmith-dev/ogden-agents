import { MAX_API_KEY_LENGTH, MAX_SIGN_IN_CODE_LENGTH, type AgentSetupStatus } from '@ogden-agents/shared';
import { ArrowSquareOut, Key, SignIn as SignInIcon } from '@phosphor-icons/react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Notice } from '@/ui/notice';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';
import { useApiKey, useSignIn, type ApiKeyActions, type SignIn } from './agent-setup-api';

/**
 * One agent's setup card (DESIGN.md Onboarding agent card; EXPERIENCE.md
 * State Patterns): its name, then "Installed, signed in", "Installed, needs
 * sign-in" or "Not installed", and the one sign-in action. While signing in
 * it says where to finish, offers Cancel, and takes a code the sign-in page
 * may show. Below it, for an agent that can use one, the API key (9.2):
 * **Use an API key instead** (a write-only field), "API key saved …<last
 * 4>", when it is in use, and **Remove key**. Welcome (9.5) reuses it.
 */
export function AgentCard({ agent }: { agent: AgentSetupStatus }) {
  const signIn = useSignIn(agent.agentId);
  const apiKey = useApiKey(agent.agentId);
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
      {agent.install === 'installed' && agent.apiKey !== undefined && agent.auth !== 'signing_in' ? (
        <ApiKeySection agent={agent} saved={agent.apiKey} actions={apiKey} />
      ) : null}
      {apiKey.error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="agent-api-key-error">
          {apiKey.error}
        </Text>
      )}
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

/**
 * The agent's API key: saved (its last 4 characters, whether it is in use,
 * Remove key), or **Use an API key instead**, which opens a write-only
 * password field. The field is cleared after every attempt; the key is
 * never kept in the page. It is not a `<form>` and the field opts out of
 * autofill and password managers, so no browser offers to save the key
 * (Enter still saves).
 */
function ApiKeySection({ agent, saved, actions }: { agent: AgentSetupStatus; saved: NonNullable<AgentSetupStatus['apiKey']>; actions: ApiKeyActions }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const fieldId = `agent-${agent.agentId}-api-key`;

  if (saved.saved) {
    return (
      <div className="flex flex-col gap-2" data-testid="agent-api-key">
        <Text variant="body" data-testid="agent-api-key-saved">
          API key saved …{saved.lastFour}
          {saved.unchecked === true ? ". Ogden Agents couldn't check it with Anthropic." : null}
        </Text>
        {agent.auth === 'signed_in' && agent.method === 'subscription' ? (
          <Text variant="caption" data-testid="agent-api-key-note">
            Signed in with your account. Your API key is used when you're signed out.
          </Text>
        ) : null}
        <div className="flex">
          <Button variant="outline" aria-disabled={actions.busy} onClick={actions.busy ? undefined : actions.remove}>
            Remove key
          </Button>
        </div>
      </div>
    );
  }

  const fromEnvironment =
    saved.fromEnvironment === true ? (
      <Text variant="caption" data-testid="agent-api-key-environment">
        An API key from the environment Ogden Agents started in is used when you're signed out. A key you save here comes first.
      </Text>
    ) : null;

  if (!open) {
    return (
      <div className="flex flex-col gap-2" data-testid="agent-api-key">
        {fromEnvironment}
        <div className="flex">
          <Button variant="ghost" onClick={() => setOpen(true)}>
            <Key aria-hidden />
            Use an API key instead
          </Button>
        </div>
      </div>
    );
  }

  const submit = () => {
    if (value.trim() === '' || actions.busy) return;
    const key = value;
    // Cleared at once, whatever the answer: the key never stays in the page.
    setValue('');
    void actions.save(key).then((ok) => {
      if (ok) setOpen(false);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  };

  return (
    <div className="flex flex-col gap-1" data-testid="agent-api-key">
      {fromEnvironment}
      <Label htmlFor={fieldId}>API key</Label>
      <Text variant="caption" id={`${fieldId}-description`}>
        Kept in this computer's keychain. Ogden Agents checks it with Anthropic first.
      </Text>
      <div className="flex gap-2">
        <Input
          id={fieldId}
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          name="ogden-agents-api-key"
          autoComplete="one-time-code"
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          data-form-type="other"
          spellCheck={false}
          maxLength={MAX_API_KEY_LENGTH}
          aria-describedby={`${fieldId}-description`}
        />
        <Button type="button" variant="secondary" aria-disabled={actions.busy || value.trim() === ''} onClick={submit}>
          {actions.busy ? 'Saving...' : 'Save'}
        </Button>
      </div>
      <div className="flex">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
