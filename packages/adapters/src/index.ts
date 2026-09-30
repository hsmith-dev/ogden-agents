/**
 * Adapters (AD-1): implementations of core ports for specific agents, OSes,
 * sandboxes and tools (`acp-*`, `buildrunner-bmad-loop`, `tickets-v7`,
 * `sandbox-*`, `vcs-git`, ...).
 */
export * from './acp-claude-code/index.js';
export * from './toolchain-uv/index.js';
