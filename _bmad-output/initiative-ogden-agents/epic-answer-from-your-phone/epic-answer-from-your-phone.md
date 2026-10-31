---
type: epic
title: "v2: Answer what needs you from your phone"
parent: initiative-ogden-agents
covers: [CAP-31, CAP-4, CAP-28]
after: []
assignee: ""
risk: high
---

# v2: Answer what needs you from your phone

## Description

Off by default, the user lets a paired phone see what needs them and answer it: permission cards with allow once or deny, screen prompts with options that apply once, and messages to chats in Ask (spec CAP-31). One HTTPS listener on the one interface the user picks, a name-constrained local CA with its key in the keychain, QR pairing with a match code and a desktop Allow, a route allowlist and body rules in core (AD-34). It is the only change to the loopback-only gate, so it carries its own security review.

## Outcome

A user away from the desk answers an agent's question from their phone and nothing else is possible from it; Flow 4's phone part in EXPERIENCE.md is the signal.

## Requirements

Drafted at inception (2026-10-31, autonomous, awaiting the user's approval). Each line maps to a spec capability in `covers`.

- E23-R1: The device listener: off by default, one HTTPS listener on the chosen interface and a fixed port, closing when the address disappears, Host and Origin checks including the MagicDNS name. (CAP-31; AD-34)
- E23-R2: The certificate: a local CA name-constrained to the listener's address and name with `pathLen:0`, its key in the keychain (refused without one), never in a desktop trust store, short-lived leaves re-issued on a new address, the fingerprint shown on both screens. (CAP-31; AD-34, AD-16)
- E23-R3: Pairing: a single-use QR code of at least 128 bits for 2 minutes plus a match code and a desktop Allow; hashed device tokens with 30-day idle expiry and immediate revoke; throttling. (CAP-31; AD-34)
- E23-R4: The route allowlist with a route-enumeration test, and the body rules in core: chat only to existing Ask chats with no `/` or `!` prefix, never creating a chat, permission answers allow once or deny, screen answers only to single-choice or permission prompts and only once or deny options, through the keystroke gate, never free text, never a shell pane; a queued device message is re-checked at delivery and dropped with a notice if the chat left Ask. (CAP-31, CAP-4, CAP-28; AD-34, AD-30)
- E23-R5: The device event socket carrying only Needs you and allowlisted chats' events, and the phone page per EXPERIENCE.md. (CAP-31; AD-31, AD-34)
- E23-R6: Settings, Phone on the desktop: network pick, pairing, devices, revoke, the closed-listener state. (CAP-31; EXPERIENCE.md)
- E23-R7: An independent security review of the shipped listener with its findings fixed before release; live checks with a real iPhone and Android phone recorded by the user; ships in the v2 release. (CAP-31)

## Done when

1. A fake device paired through the full flow answers a permission card allow once, and an unpaired, revoked or expired device gets only the pairing page (CAP-31).
2. The route-enumeration test fails on any route a device token reaches that the allowlist does not name, and core tests refuse every body rule's violation.
3. The CA cannot sign for any name outside its constraint, its key is never on disk outside the keychain, and turning access off closes the listener.
4. The security review's high and critical findings are fixed and re-checked.
5. The end-to-end suite passes on all three OSes, the user's live checks on a real iPhone and Android phone are recorded, and the epic ships in the v2 release.

## Boundaries

Answering from the same user's paired phone on a network they choose. Not here: internet-facing access, port forwarding, a relay service, a second user (spec Non-goals), the terminal or settings from a phone, push notifications to the phone (a later transport behind NotifierPort).

## References

- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-31, Constraints (127.0.0.1 and the CAP-31 exception, CAP-31 constraint), Non-goals
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-34, AD-15 (CAP-31 note), AD-16, AD-30, AD-31
- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- change — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/change-desktop-agent-harness.md, sections 4.4 and 5
- lessons — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/the-mob-lessons.md (ideas only; the-mob's code is unlicensed and is never copied)
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md
- experience — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components
- reviews — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/reviews/review-cap27-security.md (threat model this epic answers)

## Notes

- Status: drafted autonomously 2026-10-31; awaiting the user's approval of the inception.
- Decision (2026-10-31, user): one interface the user picks, not Tailscale-only; AD-34 adopted.
- Decision (2026-10-31, autonomous): spike 1 first, because whether phones accept a name-constrained private CA decides the certificate story; tracer bullet is entry 2.
- Unknown: how iOS and Android handle installing and trusting a name-constrained local CA, and whether Tailscale's MagicDNS name can be in the constraint; entry 4 waits on spike 1.
- Waits on epic 20 because: the gate, the screen-prompt model and Needs you (20.5, 20.6, 20.9). Waits on epic 9 because: SecretStorePort (9.2). Waits on epic 2 because: the AD-15 security gate and tab tokens (2.1).
- Open question (2026-10-31): three security-review recommendations are not in AD-34 as adopted: bind the listener to the network's identity plus an idle auto-close (H5); prefer `tailscale cert` on a tailnet (H1). Asked of the user at inception; until answered they are deferred.
