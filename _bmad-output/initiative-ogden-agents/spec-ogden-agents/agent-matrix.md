# Agent matrix (researched 2026-09-29; re-verify when building each adapter)

| Agent | Chat via ACP | Builds (bmad-loop profile) | Native sandbox | Unattended on native Windows |
|---|---|---|---|---|
| Claude Code | Yes (Claude Agent ACP) | Yes | macOS (Seatbelt), Linux and WSL2 (bubblewrap) | Docker if installed, otherwise attended or another agent |
| Codex CLI | Yes (ACP adapter) | Yes | macOS, Linux, Windows (native since 2026-03) | Yes |
| Gemini CLI | Yes (native) | Yes | Verify | Verify |
| GitHub Copilot CLI | Yes (preview) | Yes | Verify | Verify |
| Antigravity | No (not in the ACP registry) | Yes | Verify | Verify |

## How the UI uses it

- **Permission cards (CAP-4):** ACP `session/request_permission`.
- **Resume (CAP-3):** ACP `session/load` where the agent advertises `loadSession`. Otherwise Ogden Agents reopens from its stored transcript as a new session.
- **Terminal toggle (CAP-5):** only where the ACP session maps to the agent CLI's own resumable session.
- **Unattended builds:** the sandbox decision runs in this order:
  1. the agent's native sandbox on this OS;
  2. Docker, if it is already installed;
  3. otherwise, unattended mode is off for that agent, and the UI offers another agent, installing Docker, or attended mode.

  Unattended runs never go unsandboxed.
- **Sign-in (CAP-16):** each agent's own login flow, triggered from the UI (ACP `authenticate`, or the CLI's login in a hidden PTY), or an API key.
