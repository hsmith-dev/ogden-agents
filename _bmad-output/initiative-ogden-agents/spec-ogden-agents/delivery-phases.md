# Delivery phases

Each phase is usable on its own.

| # | Phase | Capabilities | Standalone value |
|---|---|---|---|
| 1 | `npx` install, local server, security gate, UI foundation (epic 1); ACP chat with Claude Code in workspaces, permission cards, per-tab token (epic 2); first-run onboarding and sign-in (epic 9) | CAP-1, CAP-3, CAP-4, CAP-16, CAP-17 | A modern local web UI for your own coding agent, with persistent sessions |
| 2 | Terminal toggle | CAP-5 | Advanced users on the same session |
| 3 | BMAD integration and v7 board (bmad-method-ui as reference) | CAP-2, CAP-6, CAP-7, CAP-18 | Guided planning and a live board over the ticket tree |
| 4 | Unattended builds through the forked bmad-loop (running one named ticket; epics 5 and 11), with the sandbox rules from `agent-matrix.md` | CAP-8, CAP-9, CAP-10, CAP-12, CAP-14 | Autonomous building with verification, run-time limits, and approval |
| 5 | Every BMAD-supported agent, and retrospectives | CAP-15, CAP-13 | Agent choice across chat and builds; the learning loop |
| v2 | Markdown viewing, code-change review, and a VS Code extension (epic 8) | beyond v1 | A developer reads plans and reviews agent changes in the app or in VS Code |

No open question blocks phase 1. In phase 2, confirm which ACP adapters map to a resumable CLI session. Fork BMAD-METHOD and bmad-loop before phase 3.
