# Phase 2 review — Code Reviewer

Reviewed: `specs/plan.md` v0.1 · Date: 2026-10-04
Lens: security of the design, enforceability of rules, CI gates.

## CRITICAL
**R2-01 Update source must not be a runtime setting.** Plan §4/§8 don't say where the repository
`BryanWalace/UniWake` comes from. If it were a DB setting, anyone who gets admin (or SQL write) could
point updates to their own repo and get code execution as SYSTEM.
*Fix:* repository owner/name and API host are **build-time constants**; no setting, no env
override in production builds (allowed only in test builds for the fake release server).

## MAJOR
**R2-02 Process execution rules for a LocalSystem service.** *Fix (add to plan + lint):* all child
processes via one `ProcessRunner` adapter using `execFile`/`spawn` with argument arrays and
`shell: false`; absolute executable paths (`%SystemRoot%\System32\...`); no user-provided text in
arguments except validated IPs/paths; a unit test per call site.

**R2-03 Session tokens.** Plan has `sessions.id_hash`, good. Specify: 32 random bytes, base64url
cookie value, only SHA-256 stored, comparison by hash lookup (no timing leak), cookie name
`uw_session`, `__Host-` prefix not possible on HTTP loopback, so document why.

**R2-04 CSRF on SSE and GETs.** State-changing routes must never be GET (lint/test: route table
asserts no GET handler mutates — enforce by convention + review), and the Origin check applies to
POST/PATCH/PUT/DELETE. SSE is GET read-only: OK.

**R2-05 Runtime dependency justification.** Constitution §6.4 requires justification for runtime
deps. *Fix:* add a table in the plan listing every runtime dependency, why, and the alternative
considered; CI check that `dependencies` in each `package.json` matches the table (simple script).

**R2-06 Certificate/PFX secret.** Where is the PFX password? *Fix:* random password generated at
creation, stored in `%ProgramData%\UniWake\certs\pfx.key` (ACL'd directory), never logged or
returned by the API.

**R2-07 Workflow hardening.** Release job uses `GITHUB_TOKEN` with `contents: write` only; no
`pull_request_target`; third-party actions pinned by SHA; Node runtime zip verified against
`SHASUMS256.txt` (plan has it) **and** the SHASUMS file fetched over HTTPS from nodejs.org.

**R2-08 Audit of settings changes.** Audit entries for `settings.update` record key, old and new
value; secrets (none today) would be redacted. Make the redaction list explicit (empty for now).

## MINOR
- **R2-09** Pagination max page size 200 (except `all=1` compact list).
- **R2-10** `GET /api/logs` returns at most the last 5 MB; download streams the file; both admin.
- **R2-11** The route-table test must run against **both** listeners and assert that the agent
  listener has exactly three routes.
- **R2-12** Coverage globs: include `apps/server/src/domain/**`, `application/**`, `shared/src/**`;
  exclude `application/demo/**` (seed data) — say so explicitly.
- **R2-13** Error catalog: add a unit test that every `ErrorCode` has a non-empty pt-BR message and
  an HTTP status mapping.

## Suggestions
- **IMP-029** `npm run check:deps` script (R2-05).
