// @vitest-environment happy-dom
/** Story 11.3: Build this story only on a ready card whose prerequisites are met; Build all ready's words. */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: { children: ReactNode; to: string; params: Record<string, string> }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
const { TicketCard } = await import('../src/planning/ticket-card');

afterEach(() => cleanup());
const row = (fields: Record<string, unknown>) => ({ ref: '1.2', id: 2, epic: 'e', title: 'Second', type: 'story', status: 'ready-for-dev', state: 'backlog', blocked_reason: '', after: [1], ...fields }) as never;

describe('Build this story on a card (story 11.3)', () => {
  it('is on a ready card, named with its ticket', () => {
    render(<TicketCard wsId="ws_1" row={row({})} status={{ kind: 'column', text: 'Ready' } as never} highlighted={false} onBuild={() => {}} />);
    expect(screen.getByRole('button', { name: 'Build this story 1.2' }).textContent).toBe('Build this story');
  });

  it('is not on a card that waits for another ticket, or one that is not ready, or one queued', () => {
    render(<TicketCard wsId="ws_1" row={row({})} status={{ kind: 'waits', text: 'Waits for 1.1' } as never} highlighted={false} onBuild={() => {}} />);
    expect(screen.queryByTestId('ticket-build')).toBeNull();
    cleanup();
    render(<TicketCard wsId="ws_1" row={row({ status: 'draft' })} status={{ kind: 'column', text: 'Draft' } as never} highlighted={false} onBuild={() => {}} />);
    expect(screen.queryByTestId('ticket-build')).toBeNull();
    cleanup();
    render(<TicketCard wsId="ws_1" row={row({})} status={{ kind: 'column', text: 'Ready' } as never} highlighted={false} onBuild={() => {}} queued />);
    expect(screen.queryByTestId('ticket-build')).toBeNull();
  });
});
