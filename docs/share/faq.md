# FAQ

## What does it cost?

Ogden Agents itself is free and MIT licensed. The cost is the agent you connect: a Claude subscription or Anthropic API usage for Claude Code, a Google account or Gemini API key for Antigravity, an OpenAI API key for Codex, or an xAI API token for Grok. A local model uses the endpoint you configure. Ogden has no billing of its own. Check the provider's current prices and plan limits.

## Which accounts do I need?

At least one of:

- A **Claude** account on a plan that includes Claude Code, or an **Anthropic API key**. Ogden signs you in from the browser, or keeps the key in your OS keychain.
- A **Google** account or **Gemini API key** for Antigravity.
- An **OpenAI API key** for Codex, or an **xAI API token** for Grok.
- A running **local model endpoint**, with no provider account required.

You do not need an account with Ogden or us. BMad Method needs none either, but its setup downloads files from GitHub.

## Do I need to know the terminal?

To run it today from source, yes: `git`, Node.js and `pnpm start`. Once it is published to npm it is `npx ogden-agents`, and the implemented double-click scripts wrap that command. Desktop builds bundle their runtime. After it starts, everything is in the browser. See [README.md](README.md).

## Windows, Mac or Linux?

All three are supported and tested in CI (macOS, Windows, Linux; Node 24 and 26). Notes from the changelog:

- Antigravity installs for Apple silicon Macs, and 64-bit Intel or AMD Linux and Windows. Other machines are told there is no build.
- On Windows, Antigravity's first answer can take about 17 seconds, and the chat says it is starting.
- This kit's screenshots and demo notes were made on macOS. Windows and Linux paths have been less exercised by us in a live demo.

## Does it work offline?

The app itself runs offline, since it is local. The agents do not: hosted agents need internet to reach their providers. A local model can run offline after setup if its endpoint and tools stay on your computer. Setting up BMad Method, installing an agent and checking an API key also need the network. An offline attempt gives a plain error.

## Is my code sent to Ogden?

No. There is no Ogden server. Your code goes only where the agent you chose sends it (Anthropic, Google, OpenAI, xAI, or your configured model endpoint), as it would in a terminal. See [security-and-privacy.md](security-and-privacy.md).

## What is the Antigravity terms caveat?

Google's Antigravity terms say that using it through apps Google does not make can get your Antigravity and Gemini CLI accounts suspended. Ogden shows a warning on the Antigravity card before you sign in. Use a Gemini API key or skip Antigravity if your account matters to you. Ask your own legal or IT team before using your work account.

## What about xAI (Grok) and Codex?

Both are implemented for chat and attended ticket builds. Codex uses an OpenAI API key only; ChatGPT account sign-in is not offered. Grok uses an xAI API token only and requires a trusted project. Codex unattended builds remain disabled pending real sandbox verification. Grok builds require you to watch.

## Will it change my files?

Only through the agent, and only after your approval in Ask mode. A project with BMad Method off gets nothing written by Ogden. Turning BMad features on and setting it up adds BMad files to the project. Turning a feature off never deletes or edits files.

## Can a teammate use my copy over the network?

No. It listens only on your own computer and is for one person.

## Is it ready for the whole team?

Not yet. It is a pre-release build. Try it on scratch projects first. Check the list of what is not there yet in [README.md](README.md), and ask your security team to read [security-and-privacy.md](security-and-privacy.md).

## Is unattended building available?

Yes, for Claude Code where a supported sandbox is available, with separate worktrees, verification and your approval before merging. Codex, Grok and Antigravity builds currently require you to watch. Local model builds are not offered. See [v1 readiness](../v1-readiness.md) for the real-machine checks still needed.

## Where do I report problems?

In the GitHub repository's issues once you have access, or to the person who shared this with you.

## Can I hire the creator or support the project?

Visit [HarrisonSmith.AI](https://harrisonsmith.ai) for custom apps, AI workflows and integrations. You can also [buy Harrison a coffee on Venmo](https://venmo.com/u/harrismith). Ogden remains free and MIT licensed; neither service purchases nor donations are required.
