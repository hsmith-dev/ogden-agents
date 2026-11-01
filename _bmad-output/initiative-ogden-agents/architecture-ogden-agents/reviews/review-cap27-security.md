# Security review: AD-30, AD-31, AD-32, AD-34, AD-35 (CAP-27 to CAP-33 pass, proposed)

**Scope:** the proposed AD-30 (keystroke gate), AD-31 (screen prompts), AD-32 (discovery and take-over), AD-34 (paired-device listener) and AD-35 (plan-limit readings via `statusLine`), read against the adopted AD-15 (security gate) and AD-16 (secrets), the CAP-31 constraints in the spec, and the code as it stands: `packages/server/src/gate.ts`, `API_ROUTES` in `packages/shared/src/api.ts`, `PERMISSION_DECISIONS` in `packages/shared/src/events-common.ts`, and the Claude Code adapter (`constants.ts`, `terminal-command.ts`, `claude-guards.ts`). AD-33 is reviewed only where it uses AD-30 job tokens. The spine was not edited.

**Threat model:** one user and one install. Attackers considered: a hostile device on the same Wi-Fi or tailnet; someone who photographs or shoulder-surfs the pairing QR; someone holding the user's unlocked or stolen phone; a malicious web page in any browser on the desktop or the phone (including DNS rebinding); someone who gets a copy of the data directory (backup, sync folder, malware running as the user); hostile content the agent reads, such as a repo file, a web page or a tool result, that shapes what the agent prints (prompt injection); and an XSS in the web UI.

**Verdict: needs-fixes.** AD-30's single choke point, AD-31's `unreadable`-never-absent rule, AD-32's read-only discovery and AD-34's per-device Bearer tokens with an enumerated allowlist are the right shapes, and they build on AD-15 instead of beside it. Two gaps break CAP-31's own constraints as written. First, **chat send** from a phone in an Auto or Skip all chat is remote command execution. Second, the **permission-card and screen-prompt answers** a phone may send include options whose effect is a persistent rule or a mode raise. Both need a rule change before AD-34 is adopted. The local CA, how a spoofed prompt is told apart from a real one, and keystrokes reaching a bare shell are high and need concrete rules. The rest are tightening.

---

## Critical

### C1. Phone "chat send" is command execution in Auto, Skip all and manager chats

**Where:** AD-34 route allowlist ("chat send and read"); spec CAP-31 constraint ("no route that can run a command ... is reachable with a phone token").

**Problem:** `sessionMessages` (`POST { text }`) hands text to the agent. In Ogden's Auto, Claude Code runs in its `auto` permission mode (`ACP_MODE_IDS.auto = 'auto'`, `terminal-command.ts` `--permission-mode auto`), where the CLI's classifier, not a card, approves most Bash calls. In Skip all (`bypassPermissions`) nothing asks except the protected-path ask rules. So a phone token, or anyone holding the phone, can type "run `curl … | sh`" and it runs with no card on the desktop. The phone can't *raise* the mode, but it can *use* a mode the desktop already raised, which has the same effect. The same holds for:
- A manager or orchestration chat (CAP-22), whose reply can dispatch workers or runs.
- Messages starting with `/` (slash commands the agent advertises, some of which change agent config, add directories or touch MCP) or `!` (shell passthrough in CLIs that support it).
- A screen prompt's free-text answer (`kind: text`, `freeText` options) in a pane whose CLI runs in its own auto or yolo mode. That answer becomes model input exactly like chat send.

**Rule change (AD-34):**
- A device-origin `POST sessionMessages` is accepted only when the session is `kind: chat`, its current mode is **Ask**, and it is not a manager or orchestration session. Otherwise 409 `device_requires_ask`, with nothing queued. The phone may offer "Switch to Ask and send". Lowering the mode is allowed, and it appends `session.permission_mode_changed` with the device as origin.
- The check runs at send time, in core, in the same transaction as the enqueue. The desktop raising the mode afterwards puts any still-queued device-origin message back to wait for a desktop confirmation.
- Device-origin text whose first non-blank character is `/` or `!` is refused with 400 `device_command_text`. The phone cannot invoke slash commands or shell passthrough.
- The queue routes (`sessionQueuedMessage`, `sessionQueuedMessageSendNow`), `sessionDriver`, `sessionPermissionMode` (except a lowering to Ask) and `sessionModel` are **not** on the allowlist. Say so by name.
- Free-text screen-prompt answers from a device follow the same Ask condition for the pane. Where the pane's CLI mode is unknown, only choice options are offered on the phone.
- Spec CAP-31: add "chat messages from a phone reach only chats in Ask".

### C2. Phone answers can pick options that write a persistent rule or raise a mode

**Where:** AD-34 ("permission-card answers, screen-prompt answers"); AD-31 option model `{ label, checked, freeText }`.

**Problem:** `PermissionDecisionRequest.decision` accepts `allow_always`, which core stores as a workspace permission rule (`events-common.ts`). That is a settings change reachable with a phone token, which CAP-31 forbids. Agent-side options carry the same risk:
- Claude Code's ExitPlanMode request offers "Yes, and auto-accept edits" and, while bypass is permitted (AD-15 note: sessions start with bypass permitted), may offer a bypass option. Both raise the mode through a card answer.
- In CLI panes, "Yes, and don't ask again for …" writes the CLI's own `settings.local.json`.

AD-31's option shape has no field for an option's *effect*, so neither the gate nor the allowlist test can tell these options apart.

**Rule change (AD-31 and AD-34):**
- Every option gets `effect: once | deny | persistent | mode_change | unknown`. ACP options come from the ACP option kind plus a per-adapter map. Screen options come from the `screen-prompts-<cli>` data, with `unknown` as the default.
- A device-origin answer may choose only `once` or `deny`. Anything else is refused with 403 `device_not_allowed`. The phone card doesn't show the option and says "More choices on your computer".
- `POST sessionPermission` with `allow_always` from a device token is 403. The architecture test adds a case for it. The route-enumeration test is not enough, because the route is allowed and the payload is not.

---

## High

### H1. The local CA can MITM the phone unless it is name-constrained and its key is protected; installing it can itself be MITM'd

**Where:** AD-34 ("a certificate from a local certificate authority Ogden creates in the data directory").

**Problem:**
1. The phone only trusts the listener once the user installs Ogden's CA as a trusted root. On iOS that means a configuration profile plus "Enable full trust"; on Android, a user CA. An unconstrained CA whose private key sits as a file in the data directory lets anyone who copies it (backup, cloud-synced folder, malware running as the user) issue certificates for **any** host, such as `bank.com` or `accounts.google.com`, that the phone will accept. The phone is then exposed on every network, not only Ogden's.
2. The CA certificate reaches the phone over the same network the attacker may control. If the phone fetches it from the listener over plain HTTP, or over HTTPS the user clicks through, a hostile device on the Wi-Fi can substitute its own unconstrained CA. The user then installs the attacker's root.
3. If the user ignores the warning instead of installing the CA, every device token travels over TLS the phone never validated. An ARP-spoofing device on the Wi-Fi reads it.

**Rule change (AD-34):**
- The CA certificate is X.509 v3 with `basicConstraints CA:TRUE, pathLen:0` and a **critical** `nameConstraints` extension that permits only the listener's exact IP (`/32`, or `/128` for IPv6) and its one DNS name if any (for example the tailnet's `*.ts.net` machine name), and excludes everything else. The leaf certificate is `serverAuth` only, with that SAN only. Validity: CA no more than 1 year, leaf no more than 90 days.
- The CA private key is stored through `SecretStorePort` (AD-16: keychain, refused with a plain reason where no keychain exists). It is never a plain file in the data directory. Alternative: generate it, sign the leaf, and discard it, re-pairing when the address changes. Pick one in the AD.
- Ogden **never** adds anything to the desktop's OS trust store or any browser's store. The desktop doesn't need to trust this certificate.
- CA delivery: the desktop shows the CA's SHA-256 fingerprint next to the QR, and the phone's install steps tell the user to compare it with the one the phone shows before trusting. The pairing page refuses to exchange a code until it is loaded over the trusted certificate. In practice: the QR's pairing URL is HTTPS, and the CA download is a separate first step. Write down plainly that a user who clicks through a certificate warning is not protected.
- On a tailnet, prefer a publicly trusted certificate from `tailscale cert` when it's available. Then no CA is installed at all. Document this as the recommended path.
- Turning phone access off, or revoking the last device, tells the user how to remove the CA profile from the phone.

### H2. Screen output crafted to look like a different prompt (AD-31 spoofing)

**Where:** AD-31 (`promptId` and `signature` over `screenLines`); AD-30 `expect`.

**Problem:** what is on screen is partly the agent's output, and the agent's output is partly shaped by whatever it read. A malicious README or tool result can make the agent print text that looks like a CLI prompt, for example "Allow read of docs/? 1. Yes 2. No", above or around the real one, which might be "Run `rm -rf ~`? 1. Yes 2. No". If the parser matches the first prompt-shaped block, the card and the phone show the fake question, while the keys `1⏎` answer the real one. The signature check doesn't help: it proves the screen didn't *change*, not that the right region was read. ANSI tricks make it worse: text hidden by foreground equal to background, or cursor moves that overwrite cells.

**Rule change (AD-31):**
- Parse from the terminal emulator's rendered cell grid, never the byte stream. Treat text with invisible styling (fg equal to bg, conceal, zero-width characters) as not present for matching, but include it in the signature.
- A prompt must be anchored by the CLI's own structure in `screen-prompts-<cli>` data: its frame or box characters, its position at the bottom of the screen, and the **cursor inside the option list or input**. Prompt-shaped text above the anchor is ignored. More than one candidate, or a candidate not containing the cursor, makes the result `unreadable`.
- The card, on desktop and phone, shows the **verbatim rendered region** the signature covers, monospace and as plain text, alongside the parsed choices. For `kind: permission` it shows the command or path text from that region in full, never only a parsed one-line question.
- AD-30: the consent token is bound at mint time to `{ target, action, promptId, signature, optionIndex }` as the client displayed them. The client sends back the signature it showed, and the gate compares that, not merely "the screen still matches what the server last parsed".
- A fixture class `spoof/` in each CLI's corpus (fake prompt in output above a real one, hidden text, cursor-overwrite) must parse as either the real prompt or `unreadable`, and that is enforced by the fixture test.
- ACP permission cards, same idea: the phone card shows the tool kind and the raw input (command, paths) from the request, not only the agent-supplied title, which the agent controls.

### H3. Keystrokes reaching a bare shell or a different program

**Where:** AD-30 `expect` (target state plus signature); epic 16 panes.

**Problem:** a pane is a PTY. If the agent CLI exits, crashes or is suspended (an `interrupt`, or a double ^C in some CLIs), the pane's foreground process may become the user's shell, or a pager or editor the agent launched. A screen that still parses as a `text` prompt, or a crafted one, then turns a phone's free-text answer, or `y⏎`, into a shell command. That makes the pane a terminal, which CAP-31 says is never reachable remotely.

**Rule change (AD-30):**
- For `answer` and `instruct`, `expect` also requires that the PTY's **foreground process group leader is the agent process Ogden started**, checked by the gate just before writing (`tcgetpgrp` on Unix; the ConPTY client process on Windows). Otherwise `keys_refused` with reason `foreground_changed`.
- Answer text is encoded by the adapter: control characters (U+0000 to U+001F except one final submit, U+007F, ESC sequences) are stripped or refused, the length is capped (for example 2,000 characters), and text is sent as bracketed paste where the CLI supports it, so an embedded newline can't submit early.
- `instruct` and `step` from a device are refused, as for Copilot. AD-30's per-agent table states that a device-origin consent permits only `answer` (C2 effects) and `interrupt`.

### H4. A stolen or shoulder-surfed QR pairs the attacker's device

**Where:** AD-34 pairing ("single-use code (QR), valid 2 minutes, which the phone exchanges once").

**Problem:** within the 2 minutes, anyone on the same network who photographs the QR, or sees it in a screen share, recording or screenshot, can redeem it first. Single use only means the real phone then fails, and the user may simply press "show a new code".

**Rule change (AD-34):**
- The pairing code is at least 128 random bits (the QR carries it, so there's no usability reason to make it short). It is compared in constant time and stored only as a hash, like the device token.
- A redeemed code does not activate the token by itself. The phone and the desktop both show a short match code (4 to 6 digits derived from the exchange) and the device name and user-agent. The device token is accepted only after the user clicks **Allow** on the desktop. Until then the device gets 401 `device_pending`.
- The QR is hidden as soon as it is redeemed or expires. The pairing window allows one redemption, and failed attempts beyond a small number close the window.
- Each pairing appends a `device.paired` event (device id, name, address, never the token) and shows a desktop notice.

### H5. The listener can end up on an untrusted network

**Where:** AD-34 ("on the one interface address the user picks").

**Problem:** home-network addresses such as `192.168.1.23` are reused everywhere. A laptop that moves to a café or hotel Wi-Fi and gets the same address, or a DHCP lease that later lands on another network, re-exposes the listener and its pairing page on a hostile network. The rule also doesn't forbid the user picking `0.0.0.0` or `::`.

**Rule change (AD-34):**
- Only a concrete unicast address of an interface that is up can be chosen. Wildcard, loopback and link-local addresses are refused.
- The listener is bound to the **address plus the network's identity** recorded at enable time: the interface name, and for Wi-Fi the SSID/BSSID or gateway MAC; for Tailscale the `tailscale0`/utun interface. When the identity changes or the address disappears, the listener closes, a notice says why, and the user must re-enable it. It never rebinds on its own.
- It auto-closes after a set idle time (default 12 hours with no device request, editable).

---

## Medium

### M1. Consent tokens: what they protect, replay, and XSS

**Where:** AD-30 Consent.

**Problem:**
- As written, consent tokens are "minted by an authenticated POST route" and then used. If the token is returned to the browser and sent back, it becomes one more bearer secret in client memory. Any XSS has the tab token anyway, so a returned token adds nothing against XSS, yet it can be replayed within 60 seconds from wherever it leaked.
- "A refused send does not spend it": combined with binding only to target and action, this lets a racing actor retry until a *different* prompt appears that matches.
- "Any authenticated POST route" is not enforceable.

**Rule change (AD-30):**
- The consent token never leaves the server. The route handling the user's action mints it and passes it to `gate.send` in the same request. No API returns one. The architecture test fails if a response schema contains a consent field.
- Binding as in H2: `{ principal (tab or device id), target, action, promptId, signature, optionIndex }`. A refusal for `signature_mismatch` or `foreground_changed` spends the token. Only a busy refusal (one send per target) leaves it unspent.
- The mint routes are a named list in `packages/shared` (for example `screenPromptAnswer`, `paneInterrupt`, `sessionRotate`), and a test fails when anything else imports the minter.
- State the limit plainly: consent tokens stop **server-side** code paths (timers, model output, manager replies) from typing. They do not stop a compromised client. Against XSS the defense is AD-15's CSP plus a new rule: agent-controlled strings (screen regions, option labels, card titles, transcript text) are rendered only as text. No `dangerouslySetInnerHTML`, no raw HTML in markdown, and no `javascript:` or `data:` links. A lint or architecture check enforces it.
- The device listener serves a **separate, minimal phone bundle** (the attention list, cards and chat) rather than the full SPA, so a bug in any other screen isn't reachable under a device token.

### M2. Discovered transcripts contain secrets (AD-32)

**Where:** AD-32 ("transcript reference"; "Adapters read only session and transcript files, never a file their descriptor names as holding a credential").

**Problem:** transcripts routinely hold secrets the user pasted, `cat .env` output, tokens in tool results and env dumps. The rule correctly avoids credential files but says nothing about where transcript **content** goes. If any of it reaches the append-only event log (AD-5), it sits in SQLite forever. Also, a denylist of credential files is weaker than an allowlist: a symlink planted inside `~/.claude/projects/` can point at `~/.ssh/id_ed25519`, and a client-supplied "transcript reference" that is a path is an arbitrary-file-read route.

**Rule change (AD-32):**
- Discovery reads only an allowlist of globs per adapter (for example `~/.claude/projects/*/*.jsonl`, `~/.codex/sessions/**/rollout-*.jsonl`). Each file's `realpath` must stay under that root and be a regular file, and the size is capped.
- The transcript reference is an opaque server-side id, never a path from the client.
- Transcript content never enters the event log or the database. `discovered.*` events carry only metadata. Content is served on demand by one read route, `Cache-Control: no-store`, passed through AD-16's redaction patterns (provider key formats, `Authorization:` and `Bearer` values, `KEY=`/`TOKEN=`/`SECRET=` assignments) before it leaves the server. That route is **not** on the device allowlist, and discovered sessions don't appear on the phone.
- Take over always starts the new Ogden chat or pane in **Ask**, whatever mode the outside session ran in. The resumed context may carry injected instructions, and Ask means the first tool call is a card. Take over is not on the device allowlist.

### M3. The `statusLine` command as a code-execution and forgery vector (AD-35)

**Where:** AD-35 (a `statusLine` command passed through `--settings`).

**Problem:** Claude Code runs the `statusLine` command through a shell on every status refresh. Three ways this goes wrong:
- If the command names a script in a location the agent can write (the data directory, the repo, `/tmp`), an agent in Auto or Skip all, or a prompt-injected one, can rewrite it. Every later pane, **including Ask panes**, then runs the agent's code outside any card.
- If the script reports back to the server with a credential (the launcher token, a tab token, a new token in the env), the agent can read that credential from its own environment or the script and call the API.
- The `--settings` JSON appears on the process command line (`ps`), so nothing secret can go in it.

**Rule change (AD-35):**
- The command is a fixed, Ogden-built string: an absolute path to the Node binary Ogden runs plus an absolute path to a script **inside the installed app package** (read-only to the agent's sandbox, and added to the protected paths for Auto's ask rules). It interpolates no user, repo or agent data and is shell-quoted by the adapter.
- The script gets no token. It writes one JSON file to a per-pane directory Ogden created (mode 0700), or prints nothing. The server reads that file with a Zod schema, a size cap (for example 16 KB) and no prototype-bearing parse.
- Readings are untrusted (the agent can forge them). They already only feed suggestions, so this is fine. State it so no later epic gates anything on them.
- Merge `statusLine` into the same `--settings` object as the ask rules (`claudeGuardSettings`) and change nothing else in the user's settings.

### M4. Stolen or unlocked phone

**Where:** AD-34 (device token lifetime unspecified).

**Problem:** the device token lives in the phone browser's storage indefinitely. Whoever holds the unlocked phone has the allowlist for as long as the token lasts, and the API responses (card contents can include commands, paths and diff hunks) may be cached by the browser.

**Rule change (AD-34):**
- Device tokens expire after 14 days unused (idle) and after 90 days at most (absolute). Re-pairing renews them.
- Every device-listener response is `Cache-Control: no-store`, and the phone bundle registers no service worker that caches API responses.
- Every device-origin action appends its event with the device id (AD-30 already carries the origin), and the desktop's device list shows the last action, not only last seen.
- Revoke also closes that device's open event stream at once.
- Optional, later: WebAuthn on the phone as a second factor. Note it needs a DNS name, not an IP, as the relying-party ID.

### M5. The device event stream is undefined

**Where:** AD-34 allowlist (names routes, not the event socket); AD-5 `/ws` carries every install-wide event.

**Problem:** the attention list needs live updates. If the device reaches `/ws` it gets every event, including settings, discovered sessions, run output, Jira and remote-machine events. That reads far beyond "what needs them".

**Rule change (AD-34):** the device listener gets its own stream, `/ws-device` with subprotocol auth as in AD-15. It is a core-built **projection**: attention items, the cards and prompts addressed to the user, and chat messages for sessions the phone can read. Every other event type is excluded by an allowlist of event types in `packages/shared`, and a test fails on an event type that is neither allowed nor explicitly excluded. `/ws`, the terminal socket and the pane socket answer 403 on the device listener.

---

## Low

### L1. DNS rebinding and malicious pages against the device listener

A page in any browser can address the listener directly (`https://192.168.1.23:<port>`) without rebinding, so its Host header matches. AD-34's checks still hold, because Bearer tokens are never sent automatically and non-GET requests need a matching Origin. **Rule tightening:**
- Host must equal exactly `<chosen address>:<port>` (or the one DNS name), never `localhost` or `127.0.0.1`. The loopback gate must refuse the device address.
- The pairing exchange requires `Origin: https://<chosen address>:<port>`.
- No CORS headers are ever sent, and Private Network Access preflights get no `Access-Control-Allow-Private-Network`.
- The CSP's `connect-src` names the `https`/`wss` origin of the listener.
- Make these extensions of `createGate` (a second instance with its own allowed host and token store), not a second middleware, so AD-15's single gate stays single.

### L2. Logging

Add to AD-16/AD-34 explicitly: pairing codes, the QR payload, device tokens, consent tokens and the CA key are never logged. `Authorization` is already redacted. The consent origin recorded in `pane.keys_sent` comes from the authenticated principal, never from a client-supplied field.

### L3. Spec wording vs the feature

CAP-31 says no phone route "can run a command", yet approving an agent's Bash permission card from the phone is exactly that, and it is the point of the feature. Reword: "a phone can approve a single tool call the agent proposed, shown in full on its card, and nothing else that runs a command". Without the rewording, C1's line will be argued from both sides in every story.

### L4. AD-33 job tokens

A rotation job token is bound to the job id and a hash of its scripted step list. It can't be minted from a device token. It is cancelled by any user keystroke on that pane's terminal socket and by Stop, and it expires when the job ends or after a fixed ceiling (for example 5 minutes), whichever comes first.

### L5. Tailnet reach

On a tailnet, every node the user's ACLs allow can reach the listener, including machines shared in from other tailnets. The Host check, pairing confirmation (H4) and Bearer tokens cover this. Document that the user should restrict the port in their Tailscale ACLs, and that port forwarding is unsupported (already stated).

---

## Summary of rule changes by AD

| AD | Changes |
| --- | --- |
| AD-30 | Consent never leaves the server; bound to principal, promptId, signature and option; a mismatch spends it; named mint routes; foreground-process check; answer text encoding; device origin permits only `answer` and `interrupt` (C1, C2, H2, H3, M1, L4) |
| AD-31 | Option `effect`; parse from the cell grid, anchored at the cursor; ambiguity gives `unreadable`; card shows the verbatim region; `spoof/` fixtures (C2, H2) |
| AD-32 | Glob allowlist with realpath; opaque ids; content never in the log or DB; redacted, no-store read route not on the device list; Take over starts in Ask (M2) |
| AD-34 | Ask-only chat send, no `/` or `!`, named non-allowlisted routes; once/deny-only answers; name-constrained CA with the key in the keychain, never in OS stores, fingerprint check; 128-bit code plus desktop Allow with match code; network-identity bind and idle close; token expiry and no-store; device event projection; Host/Origin tightening (C1, C2, H1, H4, H5, M4, M5, L1) |
| AD-35 | Fixed command to a read-only bundled script; no token; file drop with schema and size cap; readings untrusted (M3) |
| Spec CAP-31 | "Chat messages from a phone reach only chats in Ask"; reword "run a command" (C1, L3) |
