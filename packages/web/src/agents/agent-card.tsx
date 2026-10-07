import { MAX_API_KEY_LENGTH, MAX_LINKED_COMMAND_LENGTH, type AgentSetupStatus } from '@ogden-agents/shared';
import { DownloadSimple, Key, SignIn as SignInIcon, SignOut as SignOutIcon, Terminal, Trash } from '@phosphor-icons/react';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Notice } from '@/ui/notice';
import { Progress } from '@/ui/progress';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';
import { cn } from '@/ui/utils';
import {
  useAgentActions,
  useApiKey,
  useInstall,
  useLinkedCommand,
  useSignIn,
  type AgentActions,
  type ApiKeyActions,
  type InstallAction,
  type LinkedCommandActions,
  type SignIn,
} from './agent-setup-api';
import { LocalEndpointsSection } from './local-endpoints';
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
 * Welcome (9.5) reuses it, `selected` (DESIGN.md: the heavier ink border).
 * Epic 6 entry 7: the installed version, the agent's own notes (what
 * Install puts where, what to know before signing in), **Uninstall** and
 * **Sign out** when the agent offers them, and no Install button on a
 * computer it can't be installed on.
 */

/** Who makes the agent, from its setup status (epic 6, entry 6; the 9.2 deferral), or plain words when an older server doesn't say. */
export const providerName = (agent: Pick<AgentSetupStatus, 'provider'>): string => agent.provider ?? "the agent's provider";

/** What Install downloads, as the card says it beside the button. */
const INSTALL_SIZE = { small: 'about 60 MB', large: 'about 250 MB' } as const;
export function AgentCard({ agent, selected = false }: { agent: AgentSetupStatus; selected?: boolean }) {
  const signIn = useSignIn(agent.agentId);
  const apiKey = useApiKey(agent.agentId, undefined, agent.apiKeyName ?? 'API key');
  const install = useInstall(agent.agentId);
  const actions = useAgentActions(agent.agentId);
  const linkedCommand = useLinkedCommand(agent.agentId);
  const headingId = `agent-${agent.agentId}-name`;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={`agent-card-${agent.agentId}`}
      data-auth={agent.auth}
      data-install={agent.install}
      data-selected={selected ? '' : undefined}
      className={cn('flex flex-col gap-3 rounded-lg bg-card p-(--panel-padding)', selected ? 'border-2 border-foreground' : 'border border-border')}
    >
      <Text as="h2" variant="heading" id={headingId}>
        {agent.displayName}
      </Text>
      {agent.install === 'installed' && agent.version !== null ? (
        <Text variant="caption" data-testid="agent-version">
          Version {agent.version}
        </Text>
      ) : null}
      {agent.install === 'installed' ? <AgentState agent={agent} signIn={signIn} actions={actions} /> : <InstallState agent={agent} install={install} />}
      {/* A command the user already installs and manages themselves, in place of this install (epic 12, entry 12): offered whether or not it is installed here, since the point is to skip that install. */}
      {agent.supportsLinkedCommand === true && agent.auth !== 'signing_in' ? <LinkedCommandSection agent={agent} actions={linkedCommand} /> : null}
      {linkedCommand.error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="agent-linked-command-error">
          {linkedCommand.error}
        </Text>
      )}
      {/* The agent's plain-words notices (epic 12, 12.3): known limitations, network use. */}
      {agent.notices === undefined || agent.notices.length === 0 ? null : (
        <ul className="flex flex-col gap-1" data-testid="agent-notices">
          {agent.notices.map((notice) => (
            <li key={notice}>
              <Text variant="caption" data-testid="agent-notice">
                {notice}
              </Text>
            </li>
          ))}
        </ul>
      )}
      {/* An agent that needs no account shows its servers instead of a sign in (epic 14 story 14.4). */}
      {agent.install === 'installed' && agent.noAccount === true ? <LocalEndpointsSection /> : null}
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
      {agent.install === 'installed' && agent.canUninstall === true && agent.auth !== 'signing_in' ? <UninstallSection agent={agent} actions={actions} /> : null}
      {actions.error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="agent-action-error">
          {actions.error}
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
  // Linked (epic 12, entry 12): a chat runs the user's own command, so there is nothing here to install.
  if (agent.linkedCommand !== undefined) {
    return <StateGlyph state="done" label={`Using your own ${agent.displayName} install`} data-testid="agent-state" />;
  }
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
  if (agent.canInstall === false) {
    return (
      <>
        <StateGlyph state="idle" label="Not available on this computer" data-testid="agent-state" />
        <Text variant="caption" data-testid="agent-unavailable">
          {agent.reason ?? `${agent.displayName} isn't available on this computer.`}
        </Text>
      </>
    );
  }
  return (
    <>
      <StateGlyph state="idle" label="Not installed" data-testid="agent-state" />
      {agent.reason === undefined ? null : <Text variant="caption">{agent.reason}</Text>}
      {agent.installNote === undefined ? null : (
        <Text variant="caption" data-testid="agent-install-note">
          {agent.installNote}
        </Text>
      )}
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

function AgentState({ agent, signIn, actions }: { agent: AgentSetupStatus; signIn: SignIn; actions: AgentActions }) {
  const start = () => signIn.start(agent.signInTab);
  // No account and no key (the Local model): ready once installed, and its servers are set up below.
  if (agent.noAccount === true) return <StateGlyph state="done" label="Installed, no account needed" data-testid="agent-state" />;
  // An agent that takes only an API key (Codex; user decision, 2026-10-05) has no sign-in: ready with a key, else it needs one.
  // Its notices (on the card) say why.
  if (agent.apiKeyOnly === true) {
    return agent.auth === 'signed_in' ? (
      <StateGlyph state="done" label={`Installed, using your ${agent.apiKeyName ?? 'API key'}`} data-testid="agent-state" />
    ) : (
      <StateGlyph state="idle" label={`Installed, needs ${agent.apiKeyName === undefined ? 'an API key' : `an ${agent.apiKeyName}`}`} data-testid="agent-state" />
    );
  }
  const note =
    agent.signInNote === undefined ? null : (
      <Text variant="caption" data-testid="agent-sign-in-note">
        {agent.signInNote}
      </Text>
    );
  switch (agent.auth) {
    case 'signed_in':
      return (
        <>
          <StateGlyph state="done" label="Installed, signed in" data-testid="agent-state" />
          {agent.canSignOut === true ? (
            <div className="flex">
              <Button variant="outline" aria-disabled={actions.busy !== undefined} onClick={actions.busy !== undefined ? undefined : actions.signOut}>
                <SignOutIcon aria-hidden />
                {actions.busy === 'sign_out' ? 'Signing out...' : 'Sign out'}
              </Button>
            </div>
          ) : null}
        </>
      );
    case 'signing_in':
      return <SigningIn agentId={agent.agentId} signIn={signIn} takesCode={agent.signInTakesCode !== false} />;
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
          {note}
          <div className="flex">
            <SignInButton signIn={signIn} onClick={start} label="Sign in with your account" />
          </div>
        </>
      );
  }
}

/**
 * **Uninstall** (epic 6 entry 7), with the agent's note on what it keeps,
 * asked once more before it runs.
 */
function UninstallSection({ agent, actions }: { agent: AgentSetupStatus; actions: AgentActions }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-col gap-2" data-testid="agent-uninstall">
      {agent.installNote === undefined ? null : (
        <Text variant="caption" data-testid="agent-install-note">
          {agent.installNote}
        </Text>
      )}
      {asking ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Uninstall ${agent.displayName}?`}>
          <Text variant="body">Uninstall {agent.displayName}?</Text>
          <Button
            variant="outline"
            aria-disabled={actions.busy !== undefined}
            onClick={
              actions.busy !== undefined
                ? undefined
                : () => {
                    setAsking(false);
                    actions.uninstall();
                  }
            }
          >
            Uninstall
          </Button>
          <Button variant="ghost" onClick={() => setAsking(false)}>
            Keep it
          </Button>
        </div>
      ) : (
        <div className="flex">
          <Button variant="ghost" aria-disabled={actions.busy !== undefined} onClick={actions.busy !== undefined ? undefined : () => setAsking(true)}>
            <Trash aria-hidden />
            {actions.busy === 'uninstall' ? 'Uninstalling...' : 'Uninstall'}
          </Button>
        </div>
      )}
    </div>
  );
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
          {agent.apiKeyName ?? 'API key'} saved …{saved.lastFour}
          {saved.unchecked === true ? `. Ogden Agents couldn't check it with ${providerName(agent)}.` : null}
        </Text>
        {agent.apiKeyOnly !== true && agent.auth === 'signed_in' && agent.method === 'subscription' ? (
          <Text variant="caption" data-testid="agent-api-key-note">
            Signed in with your account. Your API key is used when you're signed out.
          </Text>
        ) : null}
        <div className="flex">
          <Button variant="outline" aria-disabled={actions.busy} onClick={actions.busy ? undefined : actions.remove}>
            Remove {agent.apiKeyOnly === true && agent.apiKeyName !== undefined ? 'token' : 'key'}
          </Button>
        </div>
      </div>
    );
  }

  const fromEnvironment =
    saved.fromEnvironment === true ? (
      <Text variant="caption" data-testid="agent-api-key-environment">
        {agent.apiKeyOnly === true
          ? `${agent.apiKeyName === undefined ? 'An API key' : `An ${agent.apiKeyName}`} from the environment Ogden Agents started in is used by ${agent.displayName}. One you save here comes first.`
          : "An API key from the environment Ogden Agents started in is used when you're signed out. A key you save here comes first."}
      </Text>
    ) : null;

  if (!open) {
    return (
      <div className="flex flex-col gap-2" data-testid="agent-api-key">
        {fromEnvironment}
        <div className="flex">
          <Button variant="ghost" onClick={() => setOpen(true)}>
            <Key aria-hidden />
            {agent.apiKeyOnly === true ? `Add ${agent.apiKeyName === undefined ? 'an API key' : `an ${agent.apiKeyName}`}` : 'Use an API key instead'}
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
      <Label htmlFor={fieldId}>{agent.apiKeyName ?? 'API key'}</Label>
      <Text variant="caption" id={`${fieldId}-description`}>
        Kept in this computer's keychain. Ogden Agents checks it with {providerName(agent)} first.
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

/**
 * A command the user already installs and manages themselves, in place of
 * this agent's own managed install (epic 12, entry 12): linked (the command
 * line, **Use Ogden Agents' install instead**), or **Link a command you
 * already manage**, which opens a field for the command line. Mirrors
 * {@link ApiKeySection}'s three-state pattern. Offered whether or not this
 * install is in place, since linking is meant to skip it.
 */
function LinkedCommandSection({ agent, actions }: { agent: AgentSetupStatus; actions: LinkedCommandActions }) {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState('');
  const fieldId = `agent-${agent.agentId}-linked-command`;

  if (agent.linkedCommand !== undefined) {
    return (
      <div className="flex flex-col gap-2" data-testid="agent-linked-command">
        <Text variant="body" data-testid="agent-linked-command-saved">
          Using your own command: {agent.linkedCommand.command}
        </Text>
        <div className="flex">
          <Button variant="outline" aria-disabled={actions.busy} onClick={actions.busy ? undefined : actions.remove}>
            Use Ogden Agents' install instead
          </Button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="flex" data-testid="agent-linked-command">
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Terminal aria-hidden />
          Link a command you already manage
        </Button>
      </div>
    );
  }

  const submit = () => {
    const value = command.trim();
    if (value === '' || actions.busy) return;
    void actions.save({ command: value }).then((ok) => {
      if (ok) {
        setOpen(false);
        setCommand('');
      }
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  };

  return (
    <div className="flex flex-col gap-1" data-testid="agent-linked-command">
      <Label htmlFor={fieldId}>Command to run</Label>
      <Text variant="caption" id={`${fieldId}-description`}>
        A command you already install and manage yourself (for example <code>{agent.displayName.toLowerCase()}-acp</code>), in place of {agent.displayName} here.
      </Text>
      <div className="flex gap-2">
        <Input
          id={fieldId}
          type="text"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          maxLength={MAX_LINKED_COMMAND_LENGTH}
          aria-describedby={`${fieldId}-description`}
        />
        <Button type="button" variant="secondary" aria-disabled={actions.busy || command.trim() === ''} onClick={submit}>
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
