# M7 review — Code Reviewer

Milestone: **M7 prepare-target.ps1 and self-enrollment** (M7-T01..T09, M7-D, M7-F1..F3) ·
Date: 2026-10-05
Evidence: `npm run verify` green (≈625 tests + perf), Playwright 21/21 incl. the axe sweep and the
help pages, `npm run test:ps` (PSScriptAnalyzer clean, 28 Pester tests) locally and in the windows
CI job, gitleaks clean on the M7 range.

## Checklist
| Area | Result | Notes |
|---|---|---|
| Spec compliance | ✔ | FR-007.1–.5, FR-010: AC-007-01..15 and AC-010-01/02 tested (API, Pester, web, E2E). FR-007.1 step 5 amended by ADR-028. |
| Security | ✔ | Token shown once, SHA-256 stored, Bearer header checked with the per-IP limit before the body is read; the one-liner pins the SHA-256 of the exact bytes served and aborts on tampering; agent listener has exactly 3 routes; enrollment can set only the FR-007.2 fields; all refusals audited without the token. |
| Safety of tests | ✔ | Pester tests register a fake system where every setter throws unless overridden, and a test fails if a new system function is not faked; the one-liner test mocks the download and `powershell.exe`. Nothing touches the real NIC, registry, firewall or network. |
| Idempotence | ✔ | Second script run changes nothing (AC-007-04); re-enrollment updates (AC-007-06); duplicate test-WoL start returns the running test. |
| Robustness | ✔ | Script steps fail independently (FALHOU, exit 1); enrollment failure exits 2; `-NoRestart` keeps the network up for enrollment; test-WoL survives restarts by ending runs as "cancelado". |
| UI / a11y | ✔ | /preparar, /ajuda and the device diagnostics are in the axe checks; help links from diagnostics and failed jobs. |

## Findings
No CRITICAL or MAJOR findings open.

| ID | Sev | Where | Problem | Fix | Task |
|---|---|---|---|---|---|
| R-M7-01 | MINOR | `UsersPage.tsx` | "as sessões dele foram encerradas" assumes the user's gender. | "as sessões abertas desse usuário foram encerradas". | fixed (M7-R) |
| R-M7-02 | SUGGESTION | one-liner | The pasted command (with the token) stays in the technician's PowerShell history on each target until the token expires (8 h default). Only that admin profile can read it. | Accepted with ADR-013; README (M8-T10) tells technicians to revoke the code when the room is done. | M8-T10 |
| R-M7-03 | SUGGESTION | `/api/enrollment/command` | Operators change `enrollment.hubAddress` (an otherwise admin-only setting) by choosing an address. | Accepted: it only remembers the last choice and is audited as `enrollment.command`. | — |
| R-M7-04 | SUGGESTION | enrollment | A room code edited after the command was copied makes enrollment fail with ENROLL_ROOM_MISMATCH. | The message already says to copy the command again; acceptable. | — |
| R-M7-05 | SUGGESTION | installer | The agent listener (47101) needs an inbound firewall rule on the hub for targets to download the script and enroll. | Installer task. | M8-T03 |
