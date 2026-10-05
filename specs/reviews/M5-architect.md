# M5 — Architect conformance check (Phase 4 guardian)

Date: 2026-10-04

| Plan item | Status | Note |
|---|---|---|
| Tick ≤ 30 s, claim-then-execute, UTC storage, IANA zones (ADR-008) | ✔ | 15 s tick; last-tick mark in `system_state`; lookback capped at 7 days and at the schedule's creation. |
| DST rules (ADR-008) | ✔ | Non-existent local time → the instant the clocks jump; ambiguous → first occurrence. |
| Missed runs and grace (FR-005.4) | ✔ | Only the most recent occurrence of a schedule may run late; older ones are `perdido`. |
| Pause with auto-resume (FR-005.6) | ✔ | Stored in `system_state`; carried by `/api/dashboard` for the banner; SSE `scheduler` event. |
| Morning result (FR-013) | ✔ | One notice per local day, runs appended; spec now also lists lost runs (last 24 h). |
| Demo seed (FR-015) | ✔ | Two schedules and a past morning result. |
| Error catalog | changed | `TARGET_NOT_FOUND` added (plan §6.6 updated). |
| Test pipeline | changed | Tests run in UTC by default (CI parity). |

No other plan change. M6 may start.
