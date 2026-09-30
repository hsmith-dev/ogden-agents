import { MAX_API_KEY_LENGTH, type AgentSetupStatus } from '@ogden-agents/shared';
import { DownloadSimple, Key, SignIn as SignInIcon } from '@phosphor-icons/react';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Notice } from '@/ui/notice';
import { Progress } from '@/ui/progress';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';
import { useApiKey, useInstall, useSignIn, type ApiKeyActions, type InstallAction, type SignIn } from './agent-setup-api';
import { SigningIn } from './signing-in';

/**
 * One agent's setup card (DESIGN.md Onboarding agent card; EXPERIENCE.md
 * State Patterns): its name, then "Installed, signed in", "Installed, needs
 * sign-in" or "Not installed", and the one sign-in action. While signing in
 * it says where to finish, offers Cancel, and takes a code the sign-in page
 * may show. Below it, for an agent that can use one, the API key (9.2):
 * **Use an API key instead** (a write-only field), "API key saved …<last
 * 4>", when it is in use, and **Remove key**. Not installed (9.3), it
 * offers **Install** with the download's size beside it, then shows the
 * install's progress, and a failure's plain reason with **Try again**.
 * Welcome (9.5) reuses it.
 */

/** What Install downloads, as the card says it beside the button. */
const INSTALL_SIZE = { small: 'about 60 MB', large: 'about 250 MB' } as const;
export function AgentCard({ agent }: { agent: AgentSetupStatus }) {
  const signIn = useSignIn(agent.agentId);
  const apiKey = useApiKey(agent.agentId);
  const install = useInstall(agent.agentId);
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
      {agent.install === 'installed' ? <AgentState agent={agent} signIn={signIn} /> : <InstallState agent={agent} install={install} />}
      {agent.install === 'installed' && agent.apiKey !== undefined && agent.auth !== 'signing_in' ? (
        <ApiKeySection agent={agent} saved={agent.apiKey} actions={apiKey} />
      ) : null}
      {apiKey.error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="agent-api-key-error">
          {apiKey.error}
        </Text>
      )}
      {install.error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="agent-install-error">
          {install.error}
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

/** Not installed, installing, or a failed install (9.3). */
function InstallState({ agent, install }: { agent: AgentSetupStatus; install: InstallAction }) {
  if (agent.install === 'installing') {
    const progress = agent.progress;
    const label = progress?.step ?? `Installing ${agent.displayName}`;
    return (
      <>
        <StateGlyph state="working" label={`Installing ${agent.displayName}`} data-testid="agent-state" />
        <Progress aria-label={label} data-testid="agent-install-progress" value={progress?.percent ?? null} />
        <Text variant="caption" aria-live="polite">
          {progress === undefined || progress.percent === null ? `${label}...` : `${label}: ${Math.round(progress.percent)}%`}
        </Text>
      </>
    );
  }
  if (agent.install === 'failed') {
    return (
      <>
        <StateGlyph state="idle" label="Not installed" data-testid="agent-state" />
        <Notice variant="blocked" glyphLabel="Install failed" data-testid="agent-install-failed" action={<InstallButton install={install} label="Try again" />}>
          {agent.reason ?? `${agent.displayName} couldn't be installed. Try again.`}
        </Notice>
      </>
    );
  }
  return (
    <>
      <StateGlyph state="idle" label="Not installed" data-testid="agent-state" />
      {agent.reason === undefined ? null : <Text variant="caption">{agent.reason}</Text>}
      <div className="flex items-center gap-3">
        <InstallButton install={install} label="Install" />
        {agent.installSize === undefined ? null : (
          <Text variant="caption" data-testid="agent-install-size">
            {INSTALL_SIZE[agent.installSize]}
          </Text>
        )}
      </div>
    </>
  );
}

function InstallButton({ install, label }: { install: InstallAction; label: string }) {
  return (
    <Button aria-disabled={install.busy} onClick={install.busy ? undefined : install.start}>
      <DownloadSimple aria-hidden />
      {install.busy ? 'Starting...' : label}
    </Button>
  );
}

function AgentState({ agent, signIn }: { agent: AgentSetupStatus; signIn: SignIn }) {
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
