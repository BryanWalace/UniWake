# Phase 1 review — Code Reviewer

Reviewed: `specs/spec.md` v0.1 · Date: 2026-10-04
Lens: ambiguity, testability of each AC, security controls.

## CRITICAL
**R1-01 LAN panel over plain HTTP (FR-006.4).** With LAN exposure on, admin passwords and session
cookies travel in clear text on a college network where students share the segment. Session
hijack = ability to wake/alter everything and change settings.
*Fix:* when the panel is exposed on the LAN, that binding is **HTTPS only**, with a certificate
generated automatically (self-signed) or a PFX uploaded by the admin; cookies get `Secure` on
HTTPS. Loopback can stay HTTP.

**R1-02 Admin script fetched over HTTP and executed elevated (F1-02 in the Fullstack review, if
adopted).** A LAN attacker can MITM the download and get code execution as admin on every PC
the technician prepares.
*Fix:* the command shown in the panel (obtained over loopback, a trusted channel) embeds the
script's SHA-256; the one-liner verifies `Get-FileHash` before running and aborts on mismatch.

## MAJOR
**R1-03 Enrollment token in clear on the LAN (FR-007.2).** A sniffed token allows creating devices
in its room and **moving existing devices (by MAC) into it** for 8 h. Mitigations already exist
(expiry, room scope, revocation, max uses). *Fix:* record the accepted risk in an ADR; add a
dashboard notice listing devices moved by enrollment in the last 24 h; roadmap item for TLS on the
agent listener with a pinned thumbprint.

**R1-04 CSV/formula injection (FR-002.3, FR-006.5).** Hostnames and notes come from targets
(attacker-controlled through enrollment). Exported cells starting with `=`, `+`, `-`, `@`, tab or
CR are executed by Excel. *Fix:* prefix such cells with `'` on export; test it.

**R1-05 Stored XSS surface.** Same untrusted fields render in the panel. React escapes by
default. *Fix:* forbid `dangerouslySetInnerHTML` (lint `react/no-danger` as error); the CSP from
constitution §6.1 is the second layer.

**R1-06 No length limits.** *Fix:* every string field has a max length in the shared Zod schema
(name 64, hostname 253, notes 1000, tag 32, room 64, etc.); enrollment payload limited to 8 KB.

**R1-07 Public health leaks information.** *Fix:* unauthenticated `GET /api/health` returns only
`{status}`; details (version, scheduler, DB) require a session.

**R1-08 FRs without ACs.** FR-005.7, FR-007.5, FR-008.2, FR-008.3, FR-014 (restore), FR-015,
FR-016 have no Given/When/Then. Brief requires ACs for every FR.

**R1-09 Permission matrix incomplete.** Missing rows: log viewer (proposal: admin), health details
(both), backups list/restore (admin), acknowledging morning result (both), LAN exposure (admin).

**R1-10 Restore safety (FR-014).** Restore must take a backup of the current DB first, require
typed confirmation, and be audited.

## MINOR
- **R1-11** AC-001-01 is "[manual + CI smoke]" — split into AC-001-01a (CI: silent install on a
  Windows runner, service running, health 200) and AC-001-01b [manual] (reboot survives).
- **R1-12** AC-004-08 "within 2 s": state that it's measured in E2E (demo mode) from the SSE event.
- **R1-13** NFR-01 "renders without jank" is untestable. Replace with: dashboard with 500 devices
  becomes interactive in < 2 s in Playwright on CI hardware.
- **R1-14** Audit retention unspecified: default 365 days.
- **R1-15** Login rate limiting: specify per-IP limit too (default 20/min) in addition to the
  per-account backoff.
- **R1-16** SR-10: say explicitly that "Sem sala" counts as a room for the "more than one room"
  rule.

## SUGGESTION
- **IMP-023** TLS for the agent listener with thumbprint pinning in the script → roadmap.
