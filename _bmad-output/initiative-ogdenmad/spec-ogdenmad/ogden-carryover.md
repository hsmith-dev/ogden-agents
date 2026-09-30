# Ogden carryover

OgdenMad is a new build. No Ogden code is carried over, but these concepts and lessons from `ogden-aiagents` are.

## Concepts to rebuild

| Ogden concept | Reference in ogden-aiagents | OgdenMad capability |
|---|---|---|
| Run history | `backend/app/db.py` | CAP-9 |
| Scheduler with a concurrency limit | `backend/app/scheduler.py` | CAP-8 (via bmad-loop) |
| Diff, commit, and file viewer | `backend/app/workspace_viewer.py` | CAP-12 |
| HITL review branch with Approve & Merge | the `task/<id>` branches | CAP-12 |
| Notifications (webhook, Slack, Discord, SMTP) | `backend/app/notifications.py` | CAP-14 |
| Browser-first setup for non-technical users | README "Build an AI team from the frontend" | CAP-1, CAP-2, CAP-6 |

## Lessons

- Prompted rules get skipped, so enforce them with tool refusals and checks in code (commit `b5af7c3`).
- Isolated engineers produce incoherent code unless every run sees what already exists. BMAD's spec and architecture documents are the fix at the start of the process, and `depends_on`/prerequisites enforce order.
- jsdom never evaluates media queries, so responsive layout needs a real browser check (Ogden's Playwright suite).

## Not carried

Multi-tenancy, RBAC, billing and Stripe, Streamlit, AutoGen personas and GroupChat, the MCP registry, memory/RAG, the semantic cache, cross-project tickets, Ollama VRAM control.
