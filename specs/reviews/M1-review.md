# M1 review — Code Reviewer

Milestone: **M1 Foundation** (M1-T01..T20, M1-D, M1-F1..F3) · Date: 2026-10-04
Scope read: `apps/server/src/**`, `apps/web/src/**`, `packages/shared/src/**`, `scripts/*.ts`,
`eslint.config.js`, `vitest.config.ts`, `.github/workflows/ci.yml`, all tests.
Evidence: `npm run verify` green (146 tests), CI run green on ubuntu + windows, core coverage
98.9% statements / 91.5% branches.

## Checklist
| Area | Result | Notes |
|---|---|---|
| Spec compliance | ✔ | FR-006.1 (AC-006-01/02) met; AC-002-01/03/04 met in shared MAC module. |
| Room/tag scoping server-side | n/a | Starts in M3. |
| Tests meaningful, edge cases | ✔ | Property tests (MAC), fault-injecting fakes, real-socket hub tests, kill -9 durability, break-it probes. |
| No real network in tests | ✔ (after M1-F1) | Guard now covers dgram, net, http and DNS. |
| Coverage ≥ 80% core | ✔ | 98.9 / 91.5 / 98.3 / 99.6. |
| Authz on every endpoint | ✔ | Startup fails on undeclared auth; route-table test on both listeners. |
| Input validation (Zod) | ✔ | All routes so far; field limits in shared schemas. |
| Rate limiting | ⚠ | Login throttling not yet (M6-T01). Loopback-only panel limits exposure. |
| Password hashing | ✔ | argon2id, PHC, rehash on parameter change, timing equalization. |
| Secrets | ✔ | None in repo; logs redact; break-it probe confirms no passwords/tokens in logs or audit. |
| Panel localhost by default | ✔ | 127.0.0.1 + Host allowlist + CSRF Origin check. |
| Reliability | ✔ | Timeouts on requests, WAL+FULL, transactional migrations, graceful shutdown, exit 78. |
| Code quality | ✔ | Strict TS, no `any`, layer boundaries enforced by lint. |
| UI | ✔ | pt-BR, labels, skip link, loading/empty/error components. |

## Findings
No CRITICAL or MAJOR findings remain open (M1-F1/F2 were MAJOR and are fixed).

| ID | Sev | File | Problem | Why it matters | Fix | Task |
|---|---|---|---|---|---|---|
| R-M1-01 | MINOR | `apps/server/src/hub.ts` | If `buildApp` throws (plugin or route registration error), the DB handle and an already-built panel instance are not closed. | Leaked handle locks the DB file on Windows (same class as M1-F2); tests leak. | Close what was opened on failure. | M1-F4 |
| R-M1-02 | MINOR | `adapters/logger.ts`, `main.ts` | `process.exit` runs right after `hub.stop()`; the rotating file stream is asynchronous, so the last lines (e.g. "hub stopped") can be lost. | Shutdown/failure diagnostics disappear exactly when needed. | File logger exposes `close()`; hub awaits it on stop. | M1-F5 |
| R-M1-03 | SUGGESTION | `http/errors.ts` | Framework 4xx (400 bad JSON, 415) all become 422 `VALIDATION_FAILED`. | Consistent with ADR-006; status differs from HTTP purists' expectation. | Keep; documented here. | — |
| R-M1-04 | MINOR | `application/settings/settings-service.ts` | `update` accepts `bootstrap.*` keys (storage `config`) and stores them in the DB, where they have no effect. | Silent misconfiguration once the settings API exists (M6-T05). | Reject config-storage keys until M6-T05 routes them to `config.json`. | M1-F6 |
| R-M1-05 | MINOR | `application/auth/auth-service.ts` | No login throttling yet. | Brute force by local processes. | Already planned. | M6-T01 |
| R-M1-06 | MINOR | `apps/web/src/routes/LoginPage.tsx` | Submit button disabled until both fields have React state; browser password autofill may not fire `change` until the user interacts, leaving the button disabled. | Operator thinks login is broken at 7:00. | Keep the button enabled; validate on submit with a pt-BR message. | M1-F7 |
| R-M1-07 | MINOR | `scripts/check-trace.ts` | Test titles are matched only when the title is on the same line as `it(`; Prettier wraps long calls onto the next line. | False "no test" failures that block commits later. | Match across line breaks. | M1-F8 |
| R-M1-08 | MINOR | `main.ts` | Graceful stop relies on SIGINT/SIGBREAK reaching Node when WinSW stops the service. | Unverified on a real service. | Verify in the Windows installer smoke. | M8-T09 |
