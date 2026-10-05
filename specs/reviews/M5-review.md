# M5 review — Code Reviewer

Milestone: **M5 Scheduler** (M5-T01..T09, M5-D, M5-F1..F3) · Date: 2026-10-04
Evidence: `npm run verify` green (≈495 tests + perf pass), Playwright 15/15, full suite 3× stable,
suite now runs in UTC like CI. Property test: next runs over random weekdays, times and zones
(300 runs). DST matrix: New York, Lisbon, historic Brazil.

## Checklist
| Area | Result | Notes |
|---|---|---|
| Spec compliance | ✔ | FR-005.1–.8 and FR-013: AC-005-01..11 and AC-013-01 tested (domain, API with fake clock, web components). |
| Exactly-once (ADR-008) | ✔ | Claim-then-execute on the unique (schedule, planned time) key; persisted last-tick mark that never moves back; racing schedulers, restarts and clock jumps covered; interrupted claims recovered (M5-F1). |
| Security | ✔ | All schedule, exception, run, pause and notice routes are operator-only (route-auth registry); every change audited in its transaction; scheduled wakes act as "agendamento", not as the schedule's author. |
| Reliability | ✔ | A DB error mid-tick retries the same window; scheduled wakes retry the network until the grace window ends; a week offline is logged without flooding the dashboard (M5-F3). |
| Code | ✔ | `domain/schedule.ts` pure; scheduler depends on ports and a `startWake` function, not on HTTP. |
| UI / a11y | ✔ | Weekday checkboxes in a fieldset, target picker as radio + checkbox groups, pause as a red alert banner on every page, morning card as a labelled article. pt-BR throughout. |

## Findings
No CRITICAL or MAJOR findings open.

| ID | Sev | Where | Problem | Fix | Task |
|---|---|---|---|---|---|
| R-M5-01 | MINOR | schedules | SR-10 confirmation happens once, at save. If the target later grows (room gets 80 more machines, or a small target passes the threshold) runs silently wake far more than anyone confirmed. Blocking unattended runs would be worse. | `needsReconfirm` in the schedule DTO; the list asks for review; saving the target confirms the new count. | fixed (M5-R) |
| R-M5-02 | SUGGESTION | `SchedulesPage.tsx` | New schedules default to America/Sao_Paulo in the form instead of the hub's `scheduler.timezone` setting. | Read the setting once the settings API exists (M6). | M6 |
| R-M5-03 | SUGGESTION | `ExceptionsSection.tsx` | Duplicate hidden heading for the section. | Section labelled directly. | fixed (M5-R) |
| R-M5-04 | SUGGESTION | process | A fixture built UTC instants but asserted São Paulo wall time; it passed locally and failed in CI. | Fixtures use local time; `vitest.config` defaults TZ to UTC. | fixed (dc6aca6, e7eaa7f) |
