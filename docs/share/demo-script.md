# Live demo script

Two versions: 5 minutes (the safe core) and 15 minutes (adds BMad Planning and the Board, and a second agent). Both use the **real Claude Code**. Ogden has test hooks for a fake agent, but they work only for automated test runs on a temp data folder and are not a supported demo mode, so do not use them in front of people.

Screenshots in `screenshots/` show what each step should look like (they come from a fake agent with demo data).

## Before you start (10 minutes, the day before)

1. Run the build (see [README.md](README.md), "How to run it today"). Confirm `pnpm start` opens the app.
2. Complete Welcome once: Claude Code installed and signed in (Settings > Agents shows "Installed, signed in").
3. Make a **scratch project**: a new empty folder, or a throwaway copy of a small repo. Never demo on a real work repo.
4. Add it with **Add project** in the sidebar and check that **Start a chat** appears.
5. For the 15-minute version: also have one scratch folder where you can turn on BMad Method. The first setup downloads BMad Method from GitHub, so do it once beforehand, on the network you will present on.
6. Test notifications once (Settings > Notifications) so your browser has permission.
7. Close other tabs, zoom the browser to 125 percent, and pick light or dark theme to match the room (Settings > Appearance).

## 5-minute demo

Goal: show it is a normal browser app, it asks before acting, and it is safe.

**0:00 Frame it (30 seconds).**
Say: "This is a local app. Everything runs on my laptop, in my browser. It wraps Claude Code so you do not need a terminal."
Point at the green "Running on this computer" at the bottom of the sidebar. (screenshots/03-chat-permission-light-desktop.png)

**0:30 A project with no chats (30 seconds).**
Click the empty project in the sidebar. The page says "No conversations yet." Click **Start a chat**. (screenshots/02-empty-project-light-desktop.png)
Say: "One project per folder. Chats start in Ask mode, the safest one. You can see it top right."

**1:00 Ask for something readable (1 minute).**
Type: "Look at this folder and tell me what is in it, as a short list with a table of the main files." Press Enter.
Say: "The reply streams in and renders as formatted text. It can read files without asking, depending on the project's caution level."

**2:00 The permission card (1.5 minutes).**
Type: "Create a file called hello.md that says what this folder is for, then run ls to show it."
When the card appears, stop talking and read it aloud: what it wants to do, and where. (screenshots/03-chat-permission-light-desktop.png)
Say: "Nothing runs until I click. Allow once lets this one go. Always allow remembers it for this project only. Deny can carry a reason back to the agent."
Click **Allow once**. Show the tool-call row and the result.

**3:30 Where you are across projects (45 seconds).**
Open the sidebar. Say: "If another chat needs me, it appears under Needs you, with a count in the tab title and a desktop notification." (screenshots/04-sidebar-projects-light-desktop.png)

**4:15 Safety recap and questions (45 seconds).**
Say: "Local only, per-tab token, asks before acting, protected files like .git and .claude always ask, no telemetry in the code. There is a one-page security note for anyone who wants to check." Hand out [security-and-privacy.md](security-and-privacy.md).

## 15-minute demo

Do the 5-minute demo's first four steps in about 6 minutes, then:

**6:00 Settings and agents (1.5 minutes).**
Open **Settings** at the bottom of the sidebar, then **Agents**. (screenshots/05-settings-agents-light-desktop.png)
Say: "Claude Code is installed and signed in here, from the browser. Your login stays with the agent. If I use an API key instead, it goes in the operating system keychain."
Optional: show Antigravity's card. Read its terms warning aloud; do not sign in during a demo unless you mean to (see [faq.md](faq.md)).

**7:30 Permission modes (1.5 minutes).**
In a chat, open the **Ask** picker in the header. Say: "Ask is every request. Auto lets Claude's own auto mode approve safe actions and still asks about the rest. Skip all is only offered when Developer mode is on, and asks for confirmation."
Do not switch to Skip all live.

**9:00 Turn on BMad Method (3 minutes).**
Open the scratch project's settings (the gear next to the project name). Find the **BMad Method** section. (screenshots/07-bmad-settings-light-desktop.png)
Say: "A project is plain chats until I turn this on. Turning it off never deletes files."
Switch on **Planning** and **Board**. When it asks you to trust the project's BMad scripts, read the prompt, and click Allow. Say: "It runs scripts from the project, so it asks once, and asks again if they change."
Open the **Plan** tab. (screenshots/08-plan-light-desktop.png) Say: "These are the planning steps in plain words." Type a small idea into "Your idea", for example "A one-page website for a pottery class", and Start. Show the planning chat and let it run for a minute.
Open the **Board** tab. (screenshots/09-board-light-desktop.png) Say: "Tickets by status. When the agent writes a ticket's status, the card moves within seconds." It will be empty until a planning session has produced tickets; use the Board screenshot if time is short.

**12:00 Switching agents (1.5 minutes, optional).**
Open the chat header menu and choose **Continue with another agent** (needs a second agent installed). Read the preview aloud and point out the provider name. Cancel. Say: "This is exactly what would be sent, and I can edit it first."

**13:30 From planning to reviewed work (1 minute).**
Open BMad settings again. Show Unattended builds and Retrospectives. Say: "Tickets can build in separate worktrees, then wait for verification and my approval before merging. Claude Code can run unattended where a supported sandbox is available; Codex, Grok and Antigravity currently need me watching. Retrospectives help carry lessons into the next build." Do not start a build unless the scratch project and agent are prepared. Explain that npm v1 publication and real-machine evidence remain tracked in [v1 readiness](../v1-readiness.md).

**14:15 Questions (45 seconds).**

## If something breaks

| What you see | What to do |
| --- | --- |
| The page says "Open Ogden Agents" or a blank tab | Tokens are per tab. Use **New tab** in the sidebar footer, or run `pnpm start` again to get a fresh link. |
| The app does not open | Check the terminal for the one-time link (valid 60 seconds) and open it. Run `pnpm start` again. |
| Claude Code asks you to sign in | Click **Sign in** in the chat's error, or go to Settings > Agents. Have your account ready before the demo. |
| A reply hangs | Click **Stop**, then send again. A quiet agent also gets a check-in line with Stop. |
| BMad setup fails or cannot download | You are offline or GitHub is blocked. Say so, and show the Plan and Board screenshots instead. |
| Notifications do not appear | Skip them and point at the Needs you list and the tab title count. |
| Anything else | Quit Ogden Agents from the sidebar, run `pnpm start`, and continue from the screenshots in this folder. Never improvise by approving something you have not read. |

Always keep `screenshots/` open in another window as the fallback.

## Regenerating the screenshots

The screenshots come from a Playwright run against a built Ogden Agents on a temp data folder, with the fake ACP agent, an in-memory key store, a stub BMad source and stub tickets. It touches no real agent, keychain or network, and uses the server's test hooks only inside a test run, as `testHooksAllowed` requires.

```sh
pnpm build
pnpm exec playwright test --config tests/share-screenshots/playwright.config.ts
```

It writes `docs/share/screenshots/<NN>-<screen>-<light|dark>-<desktop|phone>.png` (desktop is 1440x900, phone is 390x844). The spec is `tests/share-screenshots/share-screenshots.spec.ts`; it is not part of `pnpm e2e` or CI.
