# NEXT — handoff

Updated: 2026-10-04 · Mode: single-agent orchestrator (`.agents/06-orchestrator.md`)

## Current state
- Phases 0–3 DONE. Phase 4: **M1, M2, M3 DONE**; **M4 in progress** (T01–T09 done).
- `npm run verify` green (386 tests). Playwright E2E 8/8. CI green on ubuntu and windows.
- M4 so far:
  - T01 status state machine · T02 TCP prober · T03/T04 PowerShell ICMP helper (ready-line
    handshake, single request in flight, restarts, unhealthy cooldown) + `ping.exe` fallback +
    `CompositeProber`.
  - T05 `ProbeQueue` (high = wake verification, low = sweeps; `monitor.concurrency`).
  - T06 `MonitorService` (hub-start reset dated at last probe, DNS TTL cache, IP drift, one-tx
    sweep, `device.status`/`counters` events, `stop()` awaits the sweep).
  - T07 SSE `GET /api/events` (`http/sse.ts`, heartbeat 20 s without touching the session,
    `session.expired`, 1 MB buffer cap, `preClose` ends streams).
  - T08 `DashboardService` + `GET /api/dashboard`, `GET /api/uptime`, `domain/tz.ts`,
    `domain/uptime.ts`, nightly rollup 00:10 + catch-up, migration 002 (ADR-027).
  - T09 `SimulatedNetwork` (demo NIC/sender/prober/DNS), demo seed (`application/demo`),
    `UNIWAKE_DEMO_SEED`, `UNIWAKE_DEMO_WAKE_MS`; `npm run dev` runs `--demo`; E2E runs unseeded
    demo with 1–3 s simulated boots.

## Next: M4-T10 — Web dashboard
Then T11 (SSE hook; job drawer off polling), T12 (device detail + uptime), T13 (E2E demo + axe:
AC-004-08/09/15), T14 (Ctrl+K palette, AC-004-17), T15 (E2E AC-009-01), T16 (retention: events,
`packet_log` 30 d, jobs, audit), then M4-D (break-it), M4-R (review), M4 architect note.
Notes:
- Dashboard types live in `packages/shared/src/schemas/dashboard.ts` (`Dashboard`, `Counters`,
  `UptimeSeries`). SSE `counters` carries `{global, rooms}`; other events carry the bus payload.
- E2E for AC-004-08 can lower `monitor.intervalSeconds` to 10 via the settings API (min 10).
- M5-T07 must extend the demo seed with 2 schedules and the morning-result notice.

## Working conventions
- Commit via the verify-gated helper (prettier → `npm run verify` → commit → push → prints last
  CI result). Check that CI line after every push; investigate any failure immediately.
- Write files with the editor tool or node scripts in the scratchpad; avoid shell heredocs with
  backticks. Build BOMs with `String.fromCharCode(0xfeff)`; `String.raw` for regex backslashes.

## Files to read first
`CLAUDE.md`, `specs/tasks.md` (M4), `specs/spec.md` FR-004 + FR-015, `specs/plan.md` §6,
`specs/decisions.md` ADR-019/020/027.
