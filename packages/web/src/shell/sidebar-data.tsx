import type { Session } from '@ogden-agents/shared';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useEventStream } from '@/events/event-stream';
import { useAllSessionsStatus, useWorkspaces } from '@/workspaces/workspace-api';
import { buildSidebar, type SidebarModel } from './sidebar-model';

/** How often the relative times and "Earlier" move on. */
const CLOCK_TICK_MS = 60_000;

export interface SidebarData {
  model: SidebarModel;
  /** Every session with its live state (Quit counts the busy ones). */
  sessions: readonly Session[];
  /** Whether the workspace list has not loaded yet. */
  loading: boolean;
  /** The workspaces whose session list has not loaded. */
  unloaded: ReadonlySet<string>;
  /** The current time, moving on once a minute. */
  now: number;
}

const SidebarDataContext = createContext<SidebarData | null>(null);

/**
 * The sidebar's data, built once for the shell: every workspace, its sessions
 * with their live states, and Needs you from each workspace's event window.
 * The sidebar column, its sheet copy, Quit and the live announcer all read
 * this one model.
 */
export function SidebarDataProvider({ children }: { children: ReactNode }) {
  const workspaces = useWorkspaces();
  const { sessions, unloaded, loading } = useAllSessionsStatus();
  const { store } = useEventStream();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const model = useMemo(() => buildSidebar(workspaces.data ?? [], sessions, store, now), [workspaces.data, sessions, store, now]);
  const value = useMemo(() => ({ model, sessions, loading, unloaded, now }), [model, sessions, loading, unloaded, now]);
  return <SidebarDataContext.Provider value={value}>{children}</SidebarDataContext.Provider>;
}

export function useSidebarData(): SidebarData {
  const context = useContext(SidebarDataContext);
  if (context === null) throw new Error('useSidebarData must be used inside <SidebarDataProvider>');
  return context;
}
