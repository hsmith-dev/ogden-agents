# @ogden-agents/adapters

Implements the core ports for every specific agent, OS, sandbox and tool (`acp-*`, `buildrunner-bmad-loop`, `tickets-v7`, `bmad-catalog`, `sandbox-*`, `vcs-git`, `terminal-pty`, `secrets-keyring`, `notify-*`), so that `packages/core` never names them (architecture AD-1).
