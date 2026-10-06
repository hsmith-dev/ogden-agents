export { createApp, type AppOptions, type ServerControl, type ServerInfo } from './app.js';
export { bmadPieceRoutes, guardedRouteKeys, SHIPPED_BMAD_PIECES, type BmadPieceHandler, type BmadPieceRoutes, type BmadPieceScope } from './bmad-pieces.js';
export { createLogger, redact, type Logger } from './log.js';
export {
  AGENT_ENV_KEYS,
  agentEnvironment,
  agentKeysOf,
  CLAUDE_ACP_PATH_ENV,
  countBusySessions,
  DEFAULT_PORT,
  HOST,
  SECRET_STORE_ENV,
  start,
  SUBSCRIPTION_MAX_AGE_MS,
  testSecretStore,
  type PortFile,
  type RunningServer,
  type StartOptions,
  type StopReason,
} from './start.js';
export { createGate, contentSecurityPolicy, launchUrl, type GateOptions } from './gate.js';
export { createLaunchCodes, createTabTokens, type TabTokens } from './auth.js';
export { acquireInstanceLock, isPidAlive, LOCK_FILE, ServerAlreadyRunningError } from './instance-lock.js';
export {
  createLauncherToken,
  LAUNCHER_PREFIX,
  LAUNCHER_TOKEN_FILE,
  LAUNCHER_TOKEN_HEADER,
  readLauncherToken,
} from './launcher-token.js';
// Toolchain types for callers that stub the uv install (tests).
export { ToolchainError, type DetectedToolStatus, type ToolchainPort, type ToolProgress } from '@ogden-agents/core';
// Agent port types for callers that stub the agent (tests).
export { AgentError, type AgentEvent, type AgentPort, type AgentSession } from '@ogden-agents/core';
// Setup, secret and shortcut port types for callers that stub them (tests; story 2.3).
export type { AgentSetupPort, AppShortcutPort, SecretStorePort } from '@ogden-agents/core';
// The project's tickets (story 4.1): the e2e suite passes a stub store.
export { TicketsUnavailableError, type TicketStorePort } from '@ogden-agents/core';
// The Claude Code ACP adapter, so tests can run the fake ACP agent as a second agent (epic 6, `extraAgents`).
export { createClaudeCodeAgent } from '@ogden-agents/adapters';
// The shared ACP client (epic 12, 12.3): tests register a generic agent that fixes its mode at start through it.
export { createAcpAgent, slashSkillInvocation } from '@ogden-agents/adapters';
export type { AgentDescriptor, RegisteredAgent } from '@ogden-agents/core';
// How an agent is registered (6.3): its descriptor, chat port and optional setup port; tests register fake agents this way.
export { agentHomeDir, type AgentWiring } from './agent-wiring.js';
export { createMemoryAgentSetup } from '@ogden-agents/adapters';
// Antigravity's adapters (epic 6 entry 5), so tests run the fake agent's Antigravity personality through them.
export { ANTIGRAVITY_AGENT_ID, createAntigravityAgent, createAntigravitySetup, currentPlatform as antigravityPlatform, pinnedServer as pinnedAntigravityServer } from '@ogden-agents/adapters';
export type { AntigravityPins } from '@ogden-agents/adapters';
export type { AntigravityPorts } from './antigravity-wiring.js';
export { CODEX_AGENT_ID, createCodexAgent, createCodexSetup, installedCodex } from '@ogden-agents/adapters';
export type { CodexPorts } from './codex-wiring.js';
export { createGrokAgent, createGrokSetup, GROK_AGENT_ID, installedGrok } from '@ogden-agents/adapters';
export type { GrokPorts } from './grok-wiring.js';
export { createLocalAgent, createLocalSetup, LOCAL_AGENT_ID } from '@ogden-agents/adapters';
export type { LocalChatTarget, LocalChatTargetSource, LocalPorts } from './local-wiring.js';
// The in-memory secret store, so tests never touch the real OS keychain (story 9.2).
export { createMemorySecretStore } from '@ogden-agents/adapters';
// BMad Method's catalog (story 4.3): the e2e suite keeps the real read-only parts and stubs setup, so no uv runs.
export { createBmadCatalog } from '@ogden-agents/adapters';
export type { BmadCatalogPort } from '@ogden-agents/core';
// The Claude Code install's runner and pins, for tests that install a local fixture (story 9.3).
export { spawnNpm, type AdapterPins, type NpmRunInput, type NpmRunner } from '@ogden-agents/adapters';
// The pinned upstream BMad Method (story 4.14): the in-memory stub the e2e suite passes, so no test downloads it.
export { createMemoryBmadSource, type MemoryBmadSource } from '@ogden-agents/adapters';
// The in-memory ticket store (story 4.9): the e2e suite drives the board's columns and its live `ticket.changed` with it.
export { createMemoryTicketStore, type MemoryTicketStore } from '@ogden-agents/adapters';
export type { BmadSourcePort } from '@ogden-agents/core';
// The in-memory BMad Method catalog (story 4.6): the e2e suite's Plan home renders from it (labels, groups, entry action).
export { createMemoryBmadCatalog } from '@ogden-agents/adapters';
// The fake manager (epic 15, 15.3): tests pass it as `manager` so Orchestrate runs with no model.
export { createMemoryManager } from '@ogden-agents/adapters';
