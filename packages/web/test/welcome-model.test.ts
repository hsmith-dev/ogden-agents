import { BMAD_COMING_SOON_REASON, BMAD_PIECES, type AgentSetupStatus, type BmadPieceAvailability } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  advancesOnReady,
  agentReady,
  asksFirstProjectChoice,
  bmadMethodPieces,
  exitTarget,
  firstProjectPieces,
  redirectsToWelcome,
  selectedAgent,
  stepAfterProject,
} from '../src/onboarding/welcome-model';

const agent = (extra: Partial<AgentSetupStatus> = {}): AgentSetupStatus => ({
  agentId: 'claude-code',
  displayName: 'Claude Code',
  install: 'installed',
  version: '2.1.0',
  auth: 'needs_sign_in',
  signInTab: 'page',
  ...extra,
});

describe('Welcome rules', () => {
  it('an agent is ready when installed and signed in, with the account or a key in use', () => {
    expect(agentReady(agent({ auth: 'signed_in', method: 'subscription' }))).toBe(true);
    expect(agentReady(agent({ auth: 'signed_in', method: 'api_key', apiKey: { saved: true, lastFour: 'WXYZ' } }))).toBe(true);
    expect(agentReady(agent({ auth: 'needs_sign_in' }))).toBe(false);
    expect(agentReady(agent({ auth: 'signing_in' }))).toBe(false);
    expect(agentReady(agent({ auth: 'failed' }))).toBe(false);
    expect(agentReady(agent({ install: 'not_installed', auth: 'signed_in' }))).toBe(false);
    expect(agentReady(agent({ install: 'installing', auth: 'signed_in' }))).toBe(false);
    expect(agentReady(undefined)).toBe(false);
  });

  it('the agent step moves on by itself only on the change to ready, never on arrival', () => {
    expect(advancesOnReady(false, true)).toBe(true);
    expect(advancesOnReady(undefined, true)).toBe(false);
    expect(advancesOnReady(true, true)).toBe(false);
    expect(advancesOnReady(false, false)).toBe(false);
    expect(advancesOnReady(true, false)).toBe(false);
  });

  it('the first supported agent is selected', () => {
    expect(selectedAgent(undefined)).toBeUndefined();
    expect(selectedAgent([])).toBeUndefined();
    expect(selectedAgent([agent(), agent({ agentId: 'codex' })])?.agentId).toBe('claude-code');
  });

  it('after a project, the shortcut step only while the server offers it', () => {
    expect(stepAfterProject(true)).toBe('shortcut');
    expect(stepAfterProject(false)).toBe('finish');
    expect(stepAfterProject(undefined)).toBe('finish');
  });

  it('finishing or skipping opens the added project, else Projects', () => {
    expect(exitTarget('ws_1')).toEqual({ to: '/w/$wsId', params: { wsId: 'ws_1' } });
    expect(exitTarget(undefined)).toEqual({ to: '/' });
  });

  it('/ sends a tab to Welcome only once onboarding has loaded as not done', () => {
    expect(redirectsToWelcome({ welcomeCompleted: false })).toBe(true);
    expect(redirectsToWelcome({ welcomeCompleted: true })).toBe(false);
    expect(redirectsToWelcome(undefined)).toBe(false);
  });
});

describe("Welcome's first-project question (story 10.4)", () => {
  const all = (available: readonly string[]): BmadPieceAvailability[] =>
    BMAD_PIECES.map((piece) => (available.includes(piece) ? { piece, available: true } : { piece, available: false, reason: BMAD_COMING_SOON_REASON }));

  it('is asked only with no answer kept and no project, once both are known', () => {
    expect(asksFirstProjectChoice({}, 0)).toBe(true);
    expect(asksFirstProjectChoice({ firstProjectChoice: 'simple_chats' }, 0)).toBe(false);
    expect(asksFirstProjectChoice({}, 1)).toBe(false);
    expect(asksFirstProjectChoice(undefined, 0)).toBe(false);
    expect(asksFirstProjectChoice({}, undefined)).toBe(false);
  });

  it('Simple chats starts the project with every piece off; BMad Method with Planning and Board as far as they ship', () => {
    expect(firstProjectPieces('simple_chats', all(BMAD_PIECES))).toEqual([]);
    expect(firstProjectPieces('bmad_method', all(['planning', 'board']))).toEqual(['planning', 'board']);
    expect(firstProjectPieces('bmad_method', all(['board']))).toEqual(['board']);
    expect(firstProjectPieces('bmad_method', all([]))).toEqual([]);
    expect(firstProjectPieces('bmad_method', undefined)).toEqual([]);
    expect(bmadMethodPieces(all(['builds', 'retrospectives']))).toEqual([]);
  });
});
