# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub's private vulnerability reporting: open the [Security tab](https://github.com/hsmith-dev/ogden-agents/security/advisories/new) of this repository and choose **Report a vulnerability**. Only the maintainer can see the report. If that button is missing, open a public issue that says only "I have a security report, please enable private reporting" and share no details in it.

Helpful to include: the version (Settings > About), your operating system, the steps to reproduce, and what an attacker could do. Please do not include real API keys or tokens.

This is a small open source project run by one person, so there is no guaranteed response time. Reports are read and answered as soon as possible, and a fix is released with a note in [CHANGELOG.md](CHANGELOG.md). Please give a reasonable time to fix a problem before sharing it publicly.

## Supported versions

There is no stable release yet. Only the latest commit on `main` and the latest GitHub release (when one exists) get fixes.

## How Ogden Agents is meant to be safe

Ogden Agents is for one user on one computer. The details, with the file or decision each claim comes from, are in [docs/share/security-and-privacy.md](docs/share/security-and-privacy.md) and the README's [Security](README.md#security) section. In short:

- **Local only (decision AD-15).** The server listens only on `127.0.0.1`. It answers only requests addressed to `127.0.0.1` or `localhost`, which blocks DNS rebinding. A browser tab gets a random token by opening a one-time launch link, and every request must carry that token and come from the app's own page (an `Origin` check). Other web pages and other local servers are kept out.
- **Secrets stay masked and contained (decision AD-16).** API keys are stored in your operating system keychain, shown only as the last four characters, and handed only to the one agent that needs them. Every other process Ogden starts gets a short allowlist of environment variables with no keys. Known secret shapes are masked in logs and in chat output.
- **No telemetry found.** We searched the source for telemetry and analytics code and found none. The few places that make outbound requests (downloads you ask for, key checks, and an optional update check that can be switched off) are listed in the security and privacy page above.
- **Not audited.** It has not had an outside security audit. One user per install is the design, so do not run it on a shared login.

## Out of scope

Reports that need an attacker who already controls your account or your computer, or that rely on you turning on Developer mode and choosing Skip all, are not vulnerabilities in Ogden Agents. A coding agent can do what you allow it to do.
