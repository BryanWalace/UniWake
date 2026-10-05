# M6 review — Code Reviewer

Milestone: **M6 Auth completion, roles, audit, settings, health, backups** (M6-T01..T12, M6-D,
M6-F1..F4) · Date: 2026-10-05
Evidence: `npm run verify` green (≈560 tests + perf pass), Playwright 18/18 incl. the axe sweep,
full suite 3× stable. Windows-only contract tests: real certificate generation (opt-in) and
read-only host checks.

## Checklist
| Area | Result | Notes |
|---|---|---|
| Spec compliance | ✔ | FR-006.2–.5, FR-011, FR-012, FR-014, FR-016: AC-006-03..08, AC-011-01, AC-012-01..03, AC-014-01/02, AC-016-01/02 tested (API, adapters with fixtures, web, E2E). |
| Permission matrix | ✔ | Every panel route's declared level is derived from the FR-006.2 matrix in a test; admin areas (users, settings, network, logs, backups) refuse operators. |
| Authentication | ✔ | Password policy (length + common/sequence/name rules), per-account backoff and per-IP limit, password change and resets end other sessions, the last admin is protected, idle timeout honoured by background requests (M4-R). |
| Transport | ✔ | LAN access is HTTPS-only on its own listener with Secure cookies; a broken LAN setup leaves the local panel working (M6-F1). No private key in the repository: tests make throwaway certificates. |
| Data safety | ✔ | Online VACUUM INTO backups, retention, pre-migration and pre-restore copies, restore by typed date, swap before the database opens, failures reported (M6-F4). |
| Observability | ✔ | Health page with pt-BR next steps; log viewer reads redacted logs; audit viewer/export with neutralized CSV. |
| UI / a11y | ✔ | Generated settings form, axe sweep on every main page and dialogs. |

## Findings
No CRITICAL or MAJOR findings open.

| ID | Sev | Where | Problem | Fix | Task |
|---|---|---|---|---|---|
| R-M6-01 | MINOR | `ScheduleFormDialog.tsx` | New schedules still defaulted to America/Sao_Paulo (R-M5-02); operators cannot read the hub setting. | The form offers "Fuso do UniWake (padrão)" and omits the zone; the server applies `scheduler.timezone`. | fixed (M6-R) |
| R-M6-02 | MINOR | `auth-service.ts` | Failed logins for unknown users stored the typed user name; people sometimes type their password there. | Values that cannot be user names are recorded as "(nome inválido)". | fixed (M6-R) |
| R-M6-03 | SUGGESTION | `settings-admin.ts` | Bootstrap keys are written to config.json inside the DB transaction; a later failure in the same save would roll back the DB but not the file. | The file is written last; the window is tiny. Accepted. | — |
| R-M6-04 | SUGGESTION | restore | In `npm run dev` (tsx watch), exit code 75 does not restart the hub. | Documented in the README for developers (M8). | M8 |
