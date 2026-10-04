# Phase 0 review — Code Reviewer

Reviewed: `specs/constitution.md` v0.1 · Date: 2026-10-04
Lens: ambiguity, unenforceable rules, missing security controls, CI quality gates.
Severity: CRITICAL / MAJOR / MINOR / SUGGESTION.

## Findings

### CRITICAL
**R0-01 — §6 First-run setup is takeover-prone.** "Setup allowed while no admin exists" means
whoever reaches the endpoint first owns the hub. Combined with LAN exposure or DNS rebinding (see
R0-02), a stranger could create the admin before IT does.
*Fix:* first-run setup accepted **only from a loopback socket address** (not from `Host`/`X-Forwarded-For`)
and only while no user exists; the transaction re-checks "no users" to avoid a race.

**R0-02 — §6 No DNS-rebinding / Host validation for a loopback-bound panel.** A web page on the
operator's PC can rebind its domain to 127.0.0.1 and reach unauthenticated endpoints (setup,
login brute force, health). Cookies would not be sent, but R0-01 makes setup the prize.
*Fix:* reject requests whose `Host` header is not in an allowlist (`localhost`, `127.0.0.1`,
`[::1]` with the configured port, plus configured LAN names/IPs when LAN exposure is on).

### MAJOR
**R0-03 — §6 Sessions and CSRF unspecified.** Cookie auth on HTTP without CSRF rules is a hole.
*Fix:* server-side sessions; cookie `HttpOnly`, `SameSite=Strict`, `Path=/`; new session id on
login; idle timeout (e.g. 12 h, covers a shift) and absolute timeout; logout and password change
revoke sessions; on unsafe methods require `Origin` (or `Referer`) to match the allowed hosts.

**R0-04 — §6 Enrollment token rules incomplete.** Need: ≥ 128 bits of CSPRNG entropy; stored as
SHA-256 hash; constant-time comparison; expiry (default short); max uses; revocable; rate
limited; enrollment payload can only set an allow-listed set of fields; every use audited.

**R0-05 — §5 "No real network in tests" is unenforceable as written.** A rule nobody checks will
be broken by the first lazy test.
*Fix:* (1) lint `no-restricted-imports` for `node:dgram`, `node:net`, `node:child_process`,
`node:dns` outside `apps/server/src/adapters/**`; (2) a Vitest global setup that patches
`dgram.Socket.prototype.send` and `net.connect` to throw on any non-loopback destination.

**R0-06 — §6 Authorization "checked per route" has no test strategy.** One forgotten hook = open
endpoint.
*Fix:* each route declares `auth: 'public' | 'operator' | 'admin' | 'enrollment'` in its route
config; a test enumerates **every registered route** and asserts: no session → 401 unless public;
operator → 403 on admin routes. A route without declared auth fails startup.

**R0-07 — §6 Update integrity is overstated.** A SHA-256 file published in the *same* release
proves the download isn't corrupted; it does not prove who published it. If the GitHub account or
a token is compromised, both files are replaced.
*Fix:* say so explicitly; verify the asset belongs to a non-draft, non-prerelease release of the
configured repo whose tag is valid SemVer greater than the current one; add Authenticode signing
and signature verification as soon as a certificate exists (owner blocker).

**R0-08 — Missing supply-chain rules.** *Fix:* lockfile committed and `npm ci` only; `npm audit
--omit=dev --audit-level=high` fails CI; Dependabot for npm and GitHub Actions; third-party
actions pinned by commit SHA, first-party `actions/*` by major version; secret scanning in CI;
new runtime dependency requires a justification (ADR line).

**R0-09 — PowerShell has no standards or tests.** `prepare-target.ps1` changes NIC and power
settings on hundreds of machines; a bug there is expensive.
*Fix:* PSScriptAnalyzer clean (CI), Pester tests with mocked cmdlets (CI on Windows runner),
`-WhatIf` support, transcript log written on the target.

**R0-10 — §9 DoD misses review and traceability.** *Fix:* add: milestone review passed with no
open CRITICAL/MAJOR; no `TODO` without a task ID; commit body includes `Refs: FR-xxx` when
applicable; new error codes have pt-BR messages.

### MINOR
- **R0-11** §4 "Every I/O has a timeout" — define defaults in plan (HTTP client, probes, DB busy
  timeout) so reviews can check against numbers.
- **R0-12** §2.4 precedence between config file and env is unspecified. Proposal: defaults <
  file < env.
- **R0-13** §5 coverage: state the metrics (lines, branches, functions, statements) and the
  exact globs considered "core", so the CI config can be reviewed against the text.
- **R0-14** §10 add `!` / `BREAKING CHANGE:` for breaking changes and that release notes are
  generated from commits.
- **R0-15** §6 password policy: minimum length (≥ 10), reject the top common passwords, login
  backoff per account and per IP.
- **R0-16** §6 audit log should be append-only through the API (no update/delete routes), with
  configurable retention.
- **R0-17** §6 security headers: CSP `default-src 'self'`, `frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.

### SUGGESTION
- **IMP-014** Route-table authz test (R0-06) as a reusable test helper.
- **IMP-015** Host allowlist + loopback-only setup (R0-01/R0-02) as an early M1 task.
- **IMP-016** Authenticode signing of installer and verification in the updater.
- **IMP-017** Supply-chain gates (R0-08).
- **IMP-018** PSScriptAnalyzer + Pester for PowerShell (R0-09).

## Proposed CI quality gates (every push to `main`, every PR)
1. `npm ci`
2. lint (0 warnings), Prettier check
3. typecheck all workspaces
4. unit + integration tests with coverage thresholds (core ≥ 80%)
5. E2E Playwright (Chromium) against hub in demo/dry-run mode
6. PSScriptAnalyzer + Pester (windows runner)
7. `npm audit --omit=dev --audit-level=high`, secret scan
8. On tag `v*`: all of the above + build installer + SHA-256 + publish Release.
