# Review — local security (ad hoc)
Verdict: 1 medium, 1 low.
- MEDIUM: launch code lifetime unspecified; a code in a URL that stays valid is equivalent to the plain-token option rejected earlier. Close: codes expire within 60 seconds and are single-use.
- LOW: the launcher finds the server via a port/handshake file; if world-readable on shared machines another user learns the port (the cookie still protects). Close: port file in the user data dir with user-only permissions.
- OK: Host/Origin/cookie gate covers DNS rebinding and cross-site requests; terminal WS inside the gate; secrets redacted from events and logs.
