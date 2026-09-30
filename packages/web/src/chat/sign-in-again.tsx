import { API_ROUTES, apiPath, type AgentAuthState, type AgentSetupStatus, type CoreEvent } from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import { ArrowClockwise, SignIn as SignInIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgents, useSignIn, type SignIn } from '@/agents/agent-setup-api';
import { SigningIn } from '@/agents/signing-in';
import { tabAuth } from '@/auth/tab-token';
import { useEventStream } from '@/events/event-stream';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { Text } from '@/ui/typography';
import { AGENT_ID, AGENT_NAME } from './chat-api';

/** What the notice says when the agent needs a new sign-in (EXPERIENCE.md State Patterns: Sign-in expired). */
export const SIGN_IN_AGAIN = `${AGENT_NAME} needs you to sign in again.`;
export const SIGNED_IN_TRY_AGAIN = 'Signed in. Try again to continue.';
export const API_KEY_REFUSED = `${AGENT_NAME} refused your API key.`;

/**
 * What one Sign in again notice has seen of the agent's sign-in (9.4): the
 * last state, whether a sign-in finished while it was open (`signedIn`), and
 * whether its own **Sign in** started the one in progress (`armed`), so it
 * resends the chat's last message itself once that one finishes (user
 * decision B). Held by the notice alone: a chat the user left, or another
 * chat, never resends by itself.
 */
export interface SignInTracker {
  last: AgentAuthState | undefined;
  armed: boolean;
  signedIn: boolean;
  /** The seq of the newest event this tab had when its Sign in was clicked (review F2). */
  armedAfter?: number | undefined;
}

export const initialTracker: SignInTracker = { last: undefined, armed: false, signedIn: false };

/**
 * The agent's sign-in state changed (or was first seen). `resend` is true at
 * most once per **Sign in** click: when that sign-in reaches `signed_in`.
 * The first state seen is only noted: signed in already is not a sign-in
 * this notice saw finish.
 */
export function observeAuth(tracker: SignInTracker, auth: AgentAuthState | undefined): { tracker: SignInTracker; resend: boolean } {
  if (auth === undefined || auth === tracker.last) return { tracker, resend: false };
  const first = tracker.last === undefined;
  if (auth === 'signed_in') {
    if (first) return { tracker: { ...tracker, last: auth }, resend: false };
    return { tracker: { last: auth, armed: false, signedIn: true }, resend: tracker.armed };
  }
  // Signing in keeps the click armed; a failed or cancelled sign-in, or a sign-out, drops it.
  return { tracker: { last: auth, armed: auth === 'signing_in' && tracker.armed, signedIn: false }, resend: false };
}

/** The user clicked **Sign in** (or Sign in again) on this notice, when the newest event it had was `seq`. */
export const armTracker = (tracker: SignInTracker, seq = 0): SignInTracker => ({ ...tracker, armed: true, signedIn: false, armedAfter: seq });

/**
 * The start request of this notice's Sign in answered (review F1, F2): only
 * `signing_in` keeps it armed. A request that failed (network, 409, a
 * refusal: `request_failed`), or a start that did not begin a sign-in of its
 * own (superseded: `needs_sign_in`, or `failed`), disarms it, so a sign-in
 * finished elsewhere later never resends here.
 */
export const startAnswered = (tracker: SignInTracker, answer: AgentAuthState | 'request_failed'): SignInTracker =>
  answer === 'signing_in' ? tracker : { ...tracker, armed: false };

/**
 * Sign-ins started since this notice armed (review F2): its own click makes
 * one `agent.auth_changed signing_in`; a second one means another tab (or
 * Settings) started a sign-in that replaced one of them, so this notice
 * disarms rather than risk two chats resending on one sign-in.
 */
export function observeSignInStarts(tracker: SignInTracker, events: readonly CoreEvent[], agentId: string): SignInTracker {
  if (!tracker.armed || tracker.armedAfter === undefined) return tracker;
  let starts = 0;
  for (const event of events) {
    if (event.seq > tracker.armedAfter && event.type === 'agent.auth_changed' && event.payload.agentId === agentId && event.payload.state === 'signing_in') starts++;
  }
  return starts >= 2 ? { ...tracker, armed: false } : tracker;
}

/** The seq of the newest event in `events`, or 0. */
const newestSeq = (events: readonly CoreEvent[]) => events.at(-1)?.seq ?? 0;

/** The user clicked **Try again** themselves: nothing is resent by itself afterwards. */
export const disarmTracker = (tracker: SignInTracker): SignInTracker => ({ ...tracker, armed: false });

export interface SignInAgainProps {
  /** The plain reason the session's `error` gave. */
  reason: string | undefined;
  /** Try again is offered (there is a message to resend). */
  canTryAgain: boolean;
  onTryAgain: () => void;
}

/**
 * The chat's error notice when its agent needs a new sign-in (9.4,
 * `errorCode: 'auth_required'`): **Sign in** runs 9.1's sign-in right here
 * (a tab or a link, a pasted code, Cancel), and once it finishes the notice
 * says so and this chat resends its last message by itself, once. Try again
 * stays throughout (not while signing in). A refused API key has no Sign in:
 * the key is changed in Settings: Agents. Mount it with a key per error, so
 * each error starts unarmed.
 */
export function SignInAgain({ reason, canTryAgain, onTryAgain }: SignInAgainProps) {
  const agents = useAgents();
  const agent = agents.data?.find((candidate) => candidate.agentId === AGENT_ID);
  const tracker = useRef(initialTracker);
  const { events } = useEventStream();
  // 9.1's sign-in, unchanged, sent through this tab's token; the notice only
  // reads the start request's outcome (its `state`, never the URL) to disarm.
  const observed = useMemo(() => {
    const startPath = apiPath(API_ROUTES.agentSignIn, { agentId: AGENT_ID });
    const answered = (answer: AgentAuthState | 'request_failed') => (tracker.current = startAnswered(tracker.current, answer));
    return {
      async fetch(path: string, init?: RequestInit): Promise<Response> {
        const isStart = path === startPath && init?.method === 'POST';
        let response: Response;
        try {
          response = await tabAuth.fetch(path, init);
        } catch (error) {
          if (isStart) answered('request_failed');
          throw error;
        }
        if (isStart) {
          if (!response.ok) answered('request_failed');
          else {
            response
              .clone()
              .json()
              .then(
                (body: { state?: AgentAuthState }) => answered(body.state ?? 'request_failed'),
                () => answered('request_failed'),
              );
          }
        }
        return response;
      },
    };
  }, []);
  const signIn = useSignIn(AGENT_ID, observed);
  const [signedIn, setSignedIn] = useState(false);
  const tryAgainRef = useRef(onTryAgain);
  tryAgainRef.current = onTryAgain;

  const auth = agent?.auth;
  useEffect(() => {
    const next = observeAuth(tracker.current, auth);
    tracker.current = next.tracker;
    setSignedIn(next.tracker.signedIn);
    if (next.resend) tryAgainRef.current();
  }, [auth]);

  useEffect(() => {
    tracker.current = observeSignInStarts(tracker.current, events, AGENT_ID);
  }, [events]);

  const startSignIn = () => {
    tracker.current = armTracker(tracker.current, newestSeq(events));
    setSignedIn(false);
    signIn.start(agent?.signInTab);
  };
  const tryAgain = () => {
    tracker.current = disarmTracker(tracker.current);
    onTryAgain();
  };

  return (
    <SignInAgainView
      agent={agent}
      signedIn={signedIn}
      signIn={signIn}
      reason={reason}
      canTryAgain={canTryAgain}
      onSignIn={startSignIn}
      onTryAgain={tryAgain}
    />
  );
}

export interface SignInAgainViewProps {
  /** The agent's setup, from the agents query; `undefined` until it loads. */
  agent: AgentSetupStatus | undefined;
  /** A sign-in finished while the notice was open. */
  signedIn: boolean;
  signIn: SignIn;
  reason: string | undefined;
  canTryAgain: boolean;
  onSignIn: () => void;
  onTryAgain: () => void;
}

/** The notice itself, for each row of the 9.4 matrix. */
export function SignInAgainView({ agent, signedIn, signIn, reason, canTryAgain, onSignIn, onTryAgain }: SignInAgainViewProps) {
  const signingIn = agent?.auth === 'signing_in';
  const apiKey = !signingIn && !signedIn && agent?.auth === 'signed_in' && agent.method === 'api_key';
  const failed = !signingIn && !signedIn && !apiKey && agent?.auth === 'failed';

  const tryAgain = canTryAgain ? (
    <Button variant="outline" onClick={signingIn ? undefined : onTryAgain} aria-disabled={signingIn} data-testid="try-again">
      <ArrowClockwise aria-hidden />
      Try again
    </Button>
  ) : null;
  const signInButton = (label: string) => (
    <Button aria-disabled={signIn.busy} onClick={signIn.busy ? undefined : onSignIn} data-testid="sign-in-again">
      <SignInIcon aria-hidden />
      {signIn.busy ? 'Starting...' : label}
    </Button>
  );

  const kind = signingIn ? 'signing_in' : signedIn ? 'signed_in' : apiKey ? 'api_key' : failed ? 'failed' : 'needs_sign_in';
  const words =
    kind === 'signed_in'
      ? SIGNED_IN_TRY_AGAIN
      : kind === 'api_key'
        ? API_KEY_REFUSED
        : kind === 'failed'
          ? (agent?.reason ?? `${AGENT_NAME} couldn't finish signing in. Try again.`)
          : (reason ?? SIGN_IN_AGAIN);

  return (
    <div className="flex flex-col gap-3" data-testid="sign-in-again-notice" data-sign-in={kind} data-auth={agent?.auth}>
      <Notice
        variant={kind === 'signed_in' ? 'info' : 'blocked'}
        data-testid="session-error"
        data-error-code="auth_required"
        action={
          <span className="flex flex-wrap gap-2">
            {kind === 'needs_sign_in' ? signInButton('Sign in') : kind === 'failed' ? signInButton('Sign in again') : null}
            {tryAgain}
          </span>
        }
      >
        {words}
        {kind === 'api_key' ? (
          <>
            {' '}
            <Link to="/settings/agents" className="text-foreground underline underline-offset-4" data-testid="agent-settings-link">
              Change it in Settings: Agents
            </Link>
          </>
        ) : null}
      </Notice>
      {kind === 'signing_in' ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-(--panel-padding)" data-testid="sign-in-again-signing-in">
          <SigningIn agentId={AGENT_ID} signIn={signIn} />
        </div>
      ) : null}
      {signIn.error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="agent-request-error">
          {signIn.error}
        </Text>
      )}
    </div>
  );
}
