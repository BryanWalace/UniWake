# M4 review — Code Reviewer

Milestone: **M4 Monitoring hub, realtime, history** (M4-T01..T16, M4-D, M4-F1..F9) · Date: 2026-10-04
Evidence: `npm run verify` green (≈430 unit/integration tests + perf pass), Playwright 15/15 (demo
hub), core coverage ≈96% stmts / ≈88.5% branches, full suite 3× stable (M4-D). Windows-only
contract tests: real PowerShell helper + 10 000-ping loopback soak.

## Checklist
| Area | Result | Notes |
|---|---|---|
| Spec compliance | ✔ | FR-004.1–.7, FR-009 progress, FR-015 demo. AC-004-01..17 and AC-009-01 have tests (domain, API with fakes, web components, E2E). Status from verification counts as a probe (FR-004.1, found while writing AC-004-08). |
| No real network in tests | ✔ | Fake prober/DNS everywhere; real ICMP only to loopback (Windows contract test); the demo hub uses the simulated network and never constructs the UDP sender (constructor-counting mock). |
| Security | ✔ after R-M4-01 | `/api/events`, `/api/dashboard`, `/api/uptime`, `/api/devices/:id/history` are operator-only (route-auth registry). SSE re-validates the session every 20 s without touching it and ends with `session.expired`. Hijacked SSE responses carry the security headers. |
| Reliability | ✔ | One-transaction sweeps that tolerate concurrent deletes (M4-F1); stop is fast (M4-F2); hub-start reset dated at the last probe; ICMP helper ready handshake; retention chunked and never during a wake job. |
| Performance | ✔ after R-M4-05 | 500-device sweep < 30 s simulated (AC-004-06); dashboard/list/counters < 50 ms and room uptime (500 × 180 days) < 150 ms in the perf pass; 500-device dashboard interactive < 2 s in E2E. |
| Code | ✔ | Domain pure (`status`, `tz`, `uptime`); application depends on ports only; adapters isolate PowerShell, `ping.exe`, sockets and the simulated LAN. |
| UI / a11y | ✔ | Counters as toggle buttons, meters with values, combobox palette, live region for job state; axe clean on dashboard, search and device page. pt-BR throughout. |

## Findings
No CRITICAL or MAJOR findings open.

| ID | Sev | Where | Problem | Fix | Task |
|---|---|---|---|---|---|
| R-M4-01 | MAJOR | session + web client | ADR-027 promised that an open dashboard would not defeat the idle timeout, but the dashboard's safety poll, the history polls and every SSE-triggered refetch touched the session: a panel left open on a lab PC stayed logged in forever. | The client marks requests sent after 60 s without input with `X-UniWake-Idle: 1`; the hub does not count them as activity. Test: 12 h of idle polling logs out. | fixed (M4-R) |
| R-M4-02 | MAJOR | realtime | Browsers allow ~6 HTTP/1.1 connections per host; each tab's stream holds one, so 6 panel tabs would stall every API call in all of them. | Hidden tabs close their stream after 30 s and reconnect (with refetch) when shown. | fixed (M4-R) |
| R-M4-03 | MINOR | `monitor-service.ts` | A backwards clock jump during a sweep reported a negative duration. | Clamped at 0. | fixed (M4-R) |
| R-M4-04 | SUGGESTION | `QuickWake.tsx` | The palette fetched devices with an empty query on open. | Query disabled until something is typed. | fixed (M4-R) |
| R-M4-05 | MINOR | `dashboard-service.ts` | A 500-device room over 180 days loaded 90 000 rows into JS (~200 ms blocking the event loop). | Per-day totals aggregated in SQL; per-device rows only for a day with an incomplete rollup. Perf budget 150 ms. | fixed (M4-R) |
| R-M4-06 | MINOR | process | `check:trace` ignored Playwright specs, and the commit helper marked a task done only after verify, so a missing E2E AC surfaced one commit late (red CI on 15d1912). | Trace reads `e2e/*.spec.ts`; the helper marks first and reverts on failure. | fixed (M4-T16) |
| R-M4-07 | MINOR | test infra | Wall-clock budgets inside the 55-worker coverage run were noise-bound; one native worker crash (0xC0000409) in the SSE socket test under load. | Perf budgets moved to `npm run test:perf` (sequential, uninstrumented); SSE responses use `Connection: close`. No recurrence in 9 full runs since; watch. | fixed (M4-T11, M4-T13 fix) |
| R-M4-08 | SUGGESTION | SSE | Events carry no ids, so a reconnect cannot replay what was missed. | By design (ADR-020): every (re)connect refetches. | — |
| R-M4-09 | SUGGESTION | `tcp-prober.ts` | R-M3-04 (extra TCP attempts after a positive answer) re-checked with sweeps: at concurrency 64 × 3 ports the hub holds ≤ 192 sockets briefly. | Acceptable; closed. | — |
