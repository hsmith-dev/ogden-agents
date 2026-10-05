---
id: 8
type: story
title: "Ogden notifies you, with a sound, when something needs you"
parent: none
covers: [CAP-14, CAP-3]
after: []
assignee: ""
refined: false
hitl: false
risk: medium
estimate: ""
---

# Ogden notifies you, with a sound, when something needs you

## Description

When something needs the user while they look elsewhere, Ogden shows a desktop notification and plays a short sound, so a waiting decision does not sit unseen. The things that need the user are the ones the Needs you group already knows, plus a quiet agent's check-in and a chat that needs its agent signed in again. A new Settings page, Notifications, turns this on, chooses the events, and sets the sound. The browser part only: webhooks and build events come later and plug into the same page and the same list of needs.

## Acceptance Criteria

1. **Needs you knows every kind of need**
   **Given** a chat with an open permission request, a chat waiting for the user with no request in view, a working chat whose agent checked in after going quiet, or a chat stopped because its agent must sign in again
   **When** the server's events arrive
   **Then** each shows once in Needs you with its project, chat and kind in plain words, the tab title counts them, and each leaves the list once the chat moves on

2. **Notifications are off until the user turns them on, from Settings**
   **Given** a browser that has not granted Ogden notifications
   **When** the user opens Settings, Notifications
   **Then** the page explains what Ogden will show and asks for the browser's permission only when the user presses the switch; a refusal, or a browser without notifications, leaves the page usable with one plain sentence saying why, and the sound still works on its own

3. **One notification per new need, in one tab**
   **Given** notifications on and one or more Ogden tabs open
   **When** a new need arrives
   **Then** exactly one desktop notification shows for it across all open tabs, never again for the same need, not for needs already there when a tab opened, and not for a kind the user turned off

4. **Only when Ogden is not in front, by default**
   **Given** "Only when Ogden is not the tab you're looking at" on, which is the default
   **When** a new need arrives while some Ogden tab is visible and focused
   **Then** no desktop notification and no sound play; the Needs you count still changes; with the setting off both play

5. **A short sound, under the user's control**
   **Given** sound on
   **When** a notification is due, or the user presses Test sound
   **Then** a short sound bundled with Ogden plays at the chosen volume with no network request; with sound off nothing plays, and Test sound is disabled

6. **Clicking a notification opens the need**
   **Given** a notification on screen
   **When** the user clicks it
   **Then** an Ogden tab comes forward and shows the chat the need is in

7. **Notifications never carry secrets**
   **Given** any need, including a request whose command, path or file holds a secret
   **When** its notification is built
   **Then** its text names only the project, the chat and the kind of need ("Approval needed", "Waiting for your answer", "Agent is quiet", "Sign in needed"), never a command, file, path, key or message text

8. **Settings are remembered in this browser and every tab follows them**
   **Given** the user changes any Notifications setting
   **When** they reload, or look at another Ogden tab in the same browser
   **Then** the new setting holds in both

## Boundaries

- Must not change: the Needs you group's order, its existing rows and their words; the assertive screen reader announcement of a new permission request; the permission card; the server's events.
- No server change, no new event type, no polling: the needs come from the event stream the sidebar already folds.
- No webhooks, email or push service. No build events (epic 5).

## References

- parent — none (standalone story in `backlog/`)
- source — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-14 (notifications) and CAP-3 (sessions and their states)
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md, Settings: Notifications (screen inventory row and Notifications settings), Needs you group, Accessibility Floor
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Needs you group
- status sidebar — _bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-live-status-sidebar-and-needs-you-across-workspaces-plan.md
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1 (NotifierPort and `notify-*` stay the server's webhook transports), AD-15 (gate, CSP)

## Notes

- Decision (user, 2026-10-04, verbatim): "I want to also be able to have notifications so it can notify and make noise when it needs your attention for a decision or approval".
- Decision (from the user's brief, 2026-10-04): browser Notifications API, permission requested only from a user gesture in Settings, Notifications; a short bundled sound with on/off, volume and a test; choose events; "only when Ogden isn't the focused tab" on by default; clicking focuses the tab and opens the chat; one notification per new need across tabs; tab title count; text names project, chat and kind only; sound is never the only signal.
- Decision (from the user's brief, 2026-10-04): epic 11's 11.4 ("needs you + webhooks" for builds) builds on this story rather than duplicating it: a build checkpoint or a blocked run becomes one more kind of need in the same list, and the webhook targets join the same Settings, Notifications page. Epic 11 is not on this story's branch, so the note lives here; add a dated line to 11.4's entry pointing at this story when the two branches meet.
- Assumption: a project trust prompt is not a background need. It appears only as the answer to the user starting a chat (the agent picker says the project is not trusted), so the user is already looking. It gets no notification; if an agent later asks for trust mid-chat, it arrives as a permission request and is covered.
- Assumption: preferences live in this browser (like Appearance), because the browser's permission is per browser too. Defaults: notifications off until granted, sound on at 60 percent, every kind on, only when not focused on.
- Assumption: the sound is a short two-note chime made with the browser's audio engine in code shipped with the app. A data-URL audio file would be blocked by the gate's Content-Security-Policy, and a synthesized sound needs no asset and no network. Browsers play it only after the user has interacted with the page once; that limit is said on the page.
- Assumption: quiet hours are left out; they are not cheap to make clear.
- Assumption: the favicon gets no badge; the app has no favicon today, and the tab title count (2.11) is the badge. The Needs you group is the visual signal beside the sound.
- Medium risk check: a person runs the built app, turns notifications on, and confirms one notification with sound arrives for a permission request while another app is in front, and that clicking it opens the chat.
