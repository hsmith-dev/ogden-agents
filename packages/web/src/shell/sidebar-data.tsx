import type { Session, Workspace } from '@ogden-agents/shared';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { agentNameOf } from '@/chat/chat-api';
import { modelLabel } from '@/chat/model-picker';
import { useChatAgents } from '@/chat/use-chat-agents';
import { useEventStream } from '@/events/event-stream';
import { useAllSessionsStatus, useWorkspaces } from '@/workspaces/workspace-api';
import { useRunsByWorkspace } from './run-needs';
import { buildRunNeeds, buildSidebar, type SidebarModel } from './sidebar-model';

/** How often the relative times and "Earlier" move on. */
const CLOCK_TICK_MS = 60_000;

/** Stands in for a workspace list that has not loaded, so the hooks see one stable value. */
const NO_WORKSPACES: readonly Workspace[] = [];

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
  /** Whether every project's runs have been read once (story 11.4): needs already waiting when the tab opened are recorded, not announced. */
  runsSettled: boolean;
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
  // Each row and Needs you entry names its chat's agent (epic 6, E6-R1).
  const chatAgents = useChatAgents();
  // Blocked runs and runs ready for review join Needs you (story 11.4).
  const { runs: runsByWorkspace, settled: runsSettled } = useRunsByWorkspace(workspaces.data ?? NO_WORKSPACES);
  const model = useMemo(
    () =>
      buildSidebar(
        workspaces.data ?? [],
        sessions,
        store,
        now,
        (agentId) => agentNameOf(chatAgents.data, agentId),
        // Story 11: the chat's model by its agent's name for it, in the row's tooltip.
        (agentId, model) => modelLabel(chatAgents.data?.agents.find((agent) => agent.agentId === (agentId ?? chatAgents.data?.defaultAgentId))?.models, model),
        // An agent with only API key methods (Codex, Grok): its sign in need says the key was rejected.
        (agentId) => {
          const agent = chatAgents.data?.agents.find((each) => each.agentId === (agentId ?? chatAgents.data?.defaultAgentId));
          const methods = agent?.signInMethods ?? [];
          // The name its key goes by (Grok: "xAI API access token"), else plain true.
          return methods.length > 0 && methods.every((method) => method.kind === 'api_key') ? (agent?.apiKeyName ?? true) : false;
        },
        buildRunNeeds(workspaces.data ?? NO_WORKSPACES, runsByWorkspace),
      ),
    [workspaces.data, sessions, store, now, chatAgents.data, runsByWorkspace],
  );
  const value = useMemo(() => ({ model, sessions, loading, unloaded, now, runsSettled }), [model, sessions, loading, unloaded, now, runsSettled]);
  return <SidebarDataContext.Provider value={value}>{children}</SidebarDataContext.Provider>;
}

export function useSidebarData(): SidebarData {
  const context = useContext(SidebarDataContext);
  if (context === null) throw new Error('useSidebarData must be used inside <SidebarDataProvider>');
  return context;
}
